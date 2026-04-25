package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ─── GeneratePlan ──────────────────────────────────────────────────────────

// GeneratePlan orchestrates the AI plan synthesis. It:
//  1. checks whether today's plan already exists and Force=false → returns cached
//  2. reads the user's weakest skill nodes via SkillAtlasReader
//  3. asks PlanSynthesizer to produce 3-5 items
//  4. upserts the result
//
// When LLMChain is nil (no provider keys) the UC returns domain.ErrLLMUnavailable
// — the transport surfaces that as 503 so the UI shows "connect AI to enable
// daily plan" rather than inventing a fake plan.
type GeneratePlan struct {
	Plans       domain.PlanRepo
	Skills      domain.SkillAtlasReader
	Resistance  domain.ResistanceRepo  // nullable — без него chronic-skip empty
	Synthesiser domain.PlanSynthesizer // nil when llmchain is nil
	Log         *slog.Logger
	Now         func() time.Time
	// Queue — nullable. Если задан, после успешной генерации plan-items
	// материализуются в hone_queue_items (source='ai') через SyncAIItems.
	// Идемпотентно — повторная генерация не дублирует. Ошибки sync — non-fatal.
	Queue domain.QueueRepo
}

// GeneratePlanInput holds the request parameters.
type GeneratePlanInput struct {
	UserID uuid.UUID
	Force  bool
}

// Do executes the use case.
func (uc *GeneratePlan) Do(ctx context.Context, in GeneratePlanInput) (domain.Plan, error) {
	today := uc.today()
	if !in.Force {
		existing, err := uc.Plans.GetForDate(ctx, in.UserID, today)
		if err == nil {
			return existing, nil
		}
		if !errors.Is(err, domain.ErrNotFound) {
			return domain.Plan{}, fmt.Errorf("hone.GeneratePlan.Do: get existing: %w", err)
		}
	}

	if uc.Synthesiser == nil {
		return domain.Plan{}, fmt.Errorf("hone.GeneratePlan.Do: %w", domain.ErrLLMUnavailable)
	}

	weak, err := uc.Skills.WeakestNodes(ctx, in.UserID, 5)
	if err != nil {
		return domain.Plan{}, fmt.Errorf("hone.GeneratePlan.Do: weakest nodes: %w", err)
	}

	// Resistance-tracker — скиллы, от которых пользователь отмахивался
	// последние 14 дней. Нулевой chronic-список не меняет поведение
	// синтезайзера; непустой — ломает обычный flow и вставляет tiny-task
	// или reflection-prompt (см. system prompt).
	var chronic []domain.ChronicSkill
	if uc.Resistance != nil {
		c, cerr := uc.Resistance.ChronicSkills(ctx, in.UserID, ChronicSkipWindow, ChronicSkipMinCount)
		if cerr != nil {
			// Non-fatal: plan synth продолжает без chronic-сигнала.
			uc.Log.Warn("hone.GeneratePlan.Do: chronic skills lookup failed",
				slog.Any("err", cerr), slog.String("user_id", in.UserID.String()))
		} else {
			chronic = c
		}
	}

	// STUB: enrich weak-node list with calendar events + recent PRs before
	// handing to the synthesiser. For MVP we go weak-nodes-only; the
	// synthesiser produces one solve item per weak node and decides whether
	// to inject a mock/review/read item via prompt signals.
	items, err := uc.Synthesiser.Synthesise(ctx, in.UserID, weak, chronic, today)
	if err != nil {
		return domain.Plan{}, fmt.Errorf("hone.GeneratePlan.Do: synthesise: %w", err)
	}
	if len(items) > MaxPlanItems {
		items = items[:MaxPlanItems]
	}

	p := domain.Plan{
		UserID:        in.UserID,
		Date:          today,
		Items:         items,
		RegeneratedAt: uc.Now(),
	}
	saved, err := uc.Plans.Upsert(ctx, p)
	if err != nil {
		return domain.Plan{}, fmt.Errorf("hone.GeneratePlan.Do: upsert: %w", err)
	}
	// Materialise plan items в Focus Queue (source='ai'). Best-effort —
	// если падает, plan уже сохранён, queue best-effort. Идемпотентно через
	// ExistsByTitleToday внутри SyncAIItems.
	if uc.Queue != nil {
		sync := &SyncAIItems{Plans: uc.Plans, Queue: uc.Queue, Log: uc.Log, Now: uc.Now}
		if syncErr := sync.Do(ctx, in.UserID); syncErr != nil && uc.Log != nil {
			uc.Log.Warn("hone.GeneratePlan.Do: SyncAIItems failed",
				slog.Any("err", syncErr),
				slog.String("user_id", in.UserID.String()))
		}
	}
	return saved, nil
}

func (uc *GeneratePlan) today() time.Time {
	return uc.Now().UTC().Truncate(24 * time.Hour)
}

// ─── GetPlan ───────────────────────────────────────────────────────────────

// GetPlan returns today's cached plan. Does NOT synthesise on miss — the
// client decides whether to call GeneratePlan (e.g. show an "empty" state
// for brand-new users until they tap "Regenerate").
type GetPlan struct {
	Plans domain.PlanRepo
	Now   func() time.Time
}

// Do executes the use case.
func (uc *GetPlan) Do(ctx context.Context, userID uuid.UUID) (domain.Plan, error) {
	p, err := uc.Plans.GetForDate(ctx, userID, uc.Now().UTC().Truncate(24*time.Hour))
	if err != nil {
		return domain.Plan{}, fmt.Errorf("hone.GetPlan.Do: %w", err)
	}
	return p, nil
}

// ─── DismissPlanItem ───────────────────────────────────────────────────────

// DismissPlanItem flips the Dismissed flag on one PlanItem. Idempotent
// (dismiss-twice is a no-op).
type DismissPlanItem struct {
	Plans      domain.PlanRepo
	Resistance domain.ResistanceRepo // nullable
	Log        *slog.Logger
	Now        func() time.Time
	// Memory — optional Phase B-2 hook в Coach memory. nil = no-op.
	Memory domain.MemoryHook
}

// DismissPlanItemInput — request body.
type DismissPlanItemInput struct {
	UserID uuid.UUID
	ItemID string
}

// Do executes the use case.
func (uc *DismissPlanItem) Do(ctx context.Context, in DismissPlanItemInput) (domain.Plan, error) {
	today := uc.Now().UTC().Truncate(24 * time.Hour)
	p, err := uc.Plans.PatchItem(ctx, in.UserID, today, in.ItemID, true, false)
	if err != nil {
		return domain.Plan{}, fmt.Errorf("hone.DismissPlanItem.Do: %w", err)
	}
	// Resistance-tracker: фиксируем skip только если у item'а есть skill_key
	// (custom/review item'ы пропускаем). Ошибка записи — non-fatal: dismiss
	// уже успел, resistance-signal потерять можно, plan сломать нельзя.
	if uc.Resistance != nil {
		for _, it := range p.Items {
			if it.ID == in.ItemID && it.SkillKey != "" {
				if rerr := uc.Resistance.Record(ctx, in.UserID, it.SkillKey, it.ID, today); rerr != nil && uc.Log != nil {
					uc.Log.Warn("hone.DismissPlanItem.Do: resistance record failed",
						slog.Any("err", rerr),
						slog.String("user_id", in.UserID.String()),
						slog.String("skill", it.SkillKey))
				}
				break
			}
		}
	}
	if uc.Memory != nil {
		for _, it := range p.Items {
			if it.ID == in.ItemID {
				uc.Memory.OnPlanSkipped(ctx, in.UserID, it.Title, it.SkillKey, today)
				break
			}
		}
	}
	return p, nil
}

// ─── CompletePlanItem ──────────────────────────────────────────────────────

// CompletePlanItem flips the Completed flag. Usually called automatically
// when a FocusSession ends with session.PlanItemID set — the endpoint is
// here for manual ticks.
type CompletePlanItem struct {
	Plans domain.PlanRepo
	Now   func() time.Time
	// Memory — optional Phase B-2 hook в Coach memory. nil = no-op.
	Memory domain.MemoryHook
}

// CompletePlanItemInput — request body.
type CompletePlanItemInput struct {
	UserID uuid.UUID
	ItemID string
}

// Do executes the use case.
func (uc *CompletePlanItem) Do(ctx context.Context, in CompletePlanItemInput) (domain.Plan, error) {
	today := uc.Now().UTC().Truncate(24 * time.Hour)
	p, err := uc.Plans.PatchItem(ctx, in.UserID, today, in.ItemID, false, true)
	if err != nil {
		return domain.Plan{}, fmt.Errorf("hone.CompletePlanItem.Do: %w", err)
	}
	if uc.Memory != nil {
		for _, it := range p.Items {
			if it.ID == in.ItemID {
				uc.Memory.OnPlanCompleted(ctx, in.UserID, it.Title, it.SkillKey, today)
				break
			}
		}
	}
	return p, nil
}
