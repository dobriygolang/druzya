// Package app — bulk-categorise action в TaskBoard header
// «Auto-recategorise all uncategorised». Server-streaming RPC: для каждой
// eligible task UC зовёт categoriser, апдейтит kind, пушит event обратно.
//
// Eligibility:
//   • status ∈ {todo, in_progress, in_review} (active board surface).
//   • manual_kind_override = false (юзер не зафиксировал явно).
//
// Caller (port) делает за нас:
//   • Auth gate (user_id from context).
//   • Stream wiring (connect.ServerStream[BulkAutoCategoriseEvent]).
//   • Throttle (rate-limit на одну batch concurrent per user).
//
// Latency: categoriser ~1-2s per task; для 50-task batch ≈ 60-100s wall.
// Clients shows progress «X / N» pill пока stream идёт.

package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// BulkAutoCategoriseEvent — one progress packet emitted to the stream.
// Mirrors pb.BulkAutoCategoriseEvent but kept domain-clean (ports layer
// maps to wire type).
type BulkAutoCategoriseEvent struct {
	TaskID     uuid.UUID
	Kind       domain.TaskKind
	Reasoning  string
	Confidence float32
	Processed  int
	Total      int
	Done       bool
}

// BulkAutoCategorise — UC. Streams progress via emit callback. nil-safe
// when Categoriser unwired (returns NotImplemented-ish error).
type BulkAutoCategorise struct {
	Tasks       domain.TaskRepo
	Categoriser *CategoriseTask
	CursorBus   domain.CursorEventBus // optional, fan-out to SSE clients too
	Cache       TasksListCache        // optional, invalidate after bulk write
	Log         *slog.Logger
	// MaxBatch — defensive cap; default 50. Bigger batches risk timeouts
	// (categoriser ~2s/item → 50 = 100s wall, still within client patience).
	MaxBatch int
	// PerItemTimeout — per-categorise call timeout. Default 8s (matches
	// Categoriser.Timeout default). Slow LLM call doesn't block whole batch.
	PerItemTimeout time.Duration
}

// BulkAutoCategoriseInput — explicit task_ids OR auto-pick eligible.
type BulkAutoCategoriseInput struct {
	UserID  uuid.UUID
	TaskIDs []uuid.UUID // empty = auto-pick from ListAutoCategorisable
}

// Do executes the use case. `emit` is called once per processed task
// with the categorisation result; a final emit fires with Done=true.
// Errors from individual categoriser calls don't abort the batch —
// caller sees each as a no-op event (Kind unchanged).
func (uc *BulkAutoCategorise) Do(
	ctx context.Context,
	in BulkAutoCategoriseInput,
	emit func(BulkAutoCategoriseEvent) error,
) error {
	if uc.Categoriser == nil {
		return fmt.Errorf("hone.BulkAutoCategorise: %w", domain.ErrInvalidInput)
	}
	maxBatch := uc.MaxBatch
	if maxBatch <= 0 {
		maxBatch = 50
	}

	// Resolve target set.
	var targets []domain.Task
	if len(in.TaskIDs) > 0 {
		// Fetch + filter to user-owned + non-overridden tasks.
		for _, id := range in.TaskIDs {
			if len(targets) >= maxBatch {
				break
			}
			t, err := uc.Tasks.Get(ctx, in.UserID, id)
			if err != nil {
				continue // skip missing / cross-user
			}
			if t.ManualKindOverride {
				continue // respect user choice
			}
			targets = append(targets, t)
		}
	} else {
		ts, err := uc.Tasks.ListAutoCategorisable(ctx, in.UserID, maxBatch)
		if err != nil {
			return fmt.Errorf("hone.BulkAutoCategorise: list: %w", err)
		}
		targets = ts
	}

	total := len(targets)
	if total == 0 {
		// Emit a single done=true so client closes UI properly.
		_ = emit(BulkAutoCategoriseEvent{Processed: 0, Total: 0, Done: true})
		return nil
	}

	timeout := uc.PerItemTimeout
	if timeout <= 0 {
		timeout = 8 * time.Second
	}

	for i, t := range targets {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("hone.BulkAutoCategorise: %w", err)
		}
		processed := i + 1

		// Per-item timeout — derive from parent so client cancel still
		// works, but a slow LLM call doesn't tank the rest of the batch.
		itemCtx, cancel := context.WithTimeout(ctx, timeout)
		out, err := uc.Categoriser.Do(itemCtx, CategoriseTaskInput{
			Title:    t.Title,
			BriefMD:  t.BriefMD,
			Kind:     string(t.Kind),
			SkillKey: t.SkillKey,
		})
		cancel()
		if err != nil {
			if uc.Log != nil {
				uc.Log.Warn("hone.BulkAutoCategorise: categorise failed",
					slog.String("task_id", t.ID.String()), slog.String("err", err.Error()))
			}
			// Emit a no-op-ish event so client increments counter and
			// сохраняет progress UX. Kind unchanged → same as current.
			if e := emit(BulkAutoCategoriseEvent{
				TaskID: t.ID, Kind: t.Kind, Processed: processed, Total: total,
			}); e != nil {
				return e
			}
			continue
		}

		detected := domain.TaskKind(out.Kind)
		if !detected.IsValid() {
			detected = t.Kind
		}

		// Apply only when kind actually shifts (skip noisy no-op writes).
		// manualOverride=false — bulk path is auto-categorise, not user
		// assertion. Repo guards against overwriting an existing override.
		if detected != t.Kind {
			if _, err := uc.Tasks.SetKind(ctx, in.UserID, t.ID, detected, false); err != nil {
				if uc.Log != nil {
					uc.Log.Warn("hone.BulkAutoCategorise: SetKind failed",
						slog.String("task_id", t.ID.String()), slog.String("err", err.Error()))
				}
				// Continue — emit event with original kind so UI consistent.
				if e := emit(BulkAutoCategoriseEvent{
					TaskID: t.ID, Kind: t.Kind, Reasoning: out.Reasoning,
					Confidence: out.Confidence, Processed: processed, Total: total,
				}); e != nil {
					return e
				}
				continue
			}
		}

		// Cursor bus side-channel — other Hone windows / web clients listening
		// to the SSE stream get a real-time toast as each task gets tagged.
		if uc.CursorBus != nil && out.Reasoning != "" {
			uc.CursorBus.Publish(ctx, domain.CursorEvent{
				Kind:         domain.CardCategorise,
				UserID:       in.UserID,
				TaskID:       t.ID,
				DetectedKind: detected,
				Body:         out.Reasoning,
				Confidence:   out.Confidence,
				OccurredAt:   time.Now().UTC(),
			})
		}

		if e := emit(BulkAutoCategoriseEvent{
			TaskID: t.ID, Kind: detected, Reasoning: out.Reasoning,
			Confidence: out.Confidence, Processed: processed, Total: total,
		}); e != nil {
			return e
		}
	}

	// One-shot cache invalidation after the batch — single Redis DEL vs.
	// `total` invals from inside SetKind. SetKind doesn't drop cache
	// itself (writes are bulk, не per-call critical).
	InvalidateTasksCacheForUser(ctx, uc.Cache, in.UserID)

	_ = emit(BulkAutoCategoriseEvent{Processed: total, Total: total, Done: true})
	return nil
}

// ── UpdateTaskKind ─────────────────────────────────────────────────────

// UpdateTaskKind — manual chip-picker path. Sets kind and flips
// manual_kind_override = true (the whole point: user-asserted truth).
type UpdateTaskKind struct {
	Tasks domain.TaskRepo
	Cache TasksListCache // optional · invalidate ListTasks cache
}

// UpdateTaskKindInput.
type UpdateTaskKindInput struct {
	UserID         uuid.UUID
	TaskID         uuid.UUID
	Kind           domain.TaskKind
	ManualOverride bool
}

// Do executes the use case.
func (uc *UpdateTaskKind) Do(ctx context.Context, in UpdateTaskKindInput) (domain.Task, error) {
	if !in.Kind.IsValid() {
		return domain.Task{}, fmt.Errorf("hone.UpdateTaskKind: %w: invalid kind %q", domain.ErrInvalidInput, in.Kind)
	}
	t, err := uc.Tasks.SetKind(ctx, in.UserID, in.TaskID, in.Kind, in.ManualOverride)
	if err != nil {
		return domain.Task{}, fmt.Errorf("hone.UpdateTaskKind: %w", err)
	}
	InvalidateTasksCacheForUser(ctx, uc.Cache, in.UserID)
	return t, nil
}
