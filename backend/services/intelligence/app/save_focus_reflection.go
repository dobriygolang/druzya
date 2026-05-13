// Package app — save end-of-pomodoro reflection.
//
// Hone end-of-pomodoro reflection prompt собирает grade (1-5) + notes;
// раньше эти данные никуда не шли («// future RPC» в App.tsx). Этот UC
// закрывает loop:
//
//  1. Hone POSTs SaveFocusReflectionRequest через offline-friendly outbox.
//  2. UC валидирует (session_id required, grade ∈ {0,1..5}, mode ∈ enum)
//     + idempotent insert через UNIQUE(user_id, session_id).
//  3. Side-effect: appends coach_episodes (kind=focus_reflection_added)
//     через MemoryWriter — DailyBrief / Recall / next-action surface это.
//
// MemoryWriter optional (nil-safe) — durable row в focus_reflections всё
// равно создаётся.
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// SaveFocusReflection UC.
type SaveFocusReflection struct {
	Repo   domain.FocusReflectionRepo
	Memory MemoryWriter // optional, nil-safe
	Now    func() time.Time
	// StruggleMark — optional. When grade ≤2 AND the
	// pinned task name looks like an atlas anchor («node:dist-sharding»
	// или goose-style slug), emit a MarkAtlasStruggle so web AtlasPage
	// highlights it. Heuristic: any task_pinned starting with «node:» or
	// «atlas:» or «track:» is treated as an atlas anchor.
	StruggleMark AtlasStruggleMarker
}

// SaveFocusReflectionInput — wire-shape для UC.
type SaveFocusReflectionInput struct {
	UserID          uuid.UUID
	SessionID       string
	FocusMode       string
	DurationSeconds int
	// Grade ∈ [1,5]; 0 = no rating (only notes submitted).
	Grade      int
	Notes      string
	TaskPinned string
	StartedAt  time.Time
	EndedAt    time.Time
}

// Do validates, persists, and fires off the memory episode.
func (uc *SaveFocusReflection) Do(ctx context.Context, in SaveFocusReflectionInput) (domain.FocusReflection, error) {
	if in.UserID == uuid.Nil {
		return domain.FocusReflection{}, fmt.Errorf("intelligence.SaveFocusReflection: %w: zero user_id", domain.ErrInvalidInput)
	}
	sessionID := strings.TrimSpace(in.SessionID)
	if sessionID == "" {
		return domain.FocusReflection{}, fmt.Errorf("intelligence.SaveFocusReflection: %w: session_id required", domain.ErrInvalidInput)
	}
	if !validFocusMode(in.FocusMode) {
		return domain.FocusReflection{}, fmt.Errorf("intelligence.SaveFocusReflection: %w: invalid focus_mode %q", domain.ErrInvalidInput, in.FocusMode)
	}
	if in.DurationSeconds < 0 {
		return domain.FocusReflection{}, fmt.Errorf("intelligence.SaveFocusReflection: %w: negative duration", domain.ErrInvalidInput)
	}
	// Allow grade=0 (no rating) or 1..5. Anything outside [0,5] = client bug.
	if in.Grade < 0 || in.Grade > 5 {
		return domain.FocusReflection{}, fmt.Errorf("intelligence.SaveFocusReflection: %w: grade %d out of [0,5]", domain.ErrInvalidInput, in.Grade)
	}
	if in.StartedAt.IsZero() {
		// Backfill from now() - duration so the row stays self-consistent;
		// reflection без started_at — client bug, но мы не валим request.
		in.StartedAt = uc.now().Add(-time.Duration(in.DurationSeconds) * time.Second)
	}
	if in.EndedAt.IsZero() {
		in.EndedAt = uc.now()
	}

	var gradePtr *int
	if in.Grade >= 1 && in.Grade <= 5 {
		g := in.Grade
		gradePtr = &g
	}

	notes := strings.TrimSpace(in.Notes)
	if len(notes) > 4000 {
		// Hard cap — reflection — это «note», not essay. Backend защищает
		// БД от accidental dump'ов logs/transcripts.
		notes = notes[:4000]
	}

	row := domain.FocusReflection{
		UserID:          in.UserID,
		SessionID:       sessionID,
		FocusMode:       in.FocusMode,
		DurationSeconds: in.DurationSeconds,
		Grade:           gradePtr,
		Notes:           notes,
		TaskPinned:      strings.TrimSpace(in.TaskPinned),
		StartedAt:       in.StartedAt,
		EndedAt:         in.EndedAt,
	}
	saved, err := uc.Repo.Insert(ctx, row)
	if err != nil {
		return domain.FocusReflection{}, fmt.Errorf("intelligence.SaveFocusReflection insert: %w", err)
	}

	// Fire-and-forget memory append. Idempotency на стороне UC: повторный
	// insert вернёт ту же row (same id), и Memory entry получит тот же
	// summary — DailyBrief Recall просто увидит её один раз.
	if uc.Memory != nil {
		uc.Memory.AppendAsync(ctx, AppendInput{
			UserID:     in.UserID,
			Kind:       domain.EpisodeFocusReflectionAdded,
			Summary:    focusReflectionSummary(saved),
			Payload:    focusReflectionPayload(saved),
			OccurredAt: saved.EndedAt,
		})
	}
	// X5 cross-product handoff. Low grade (1-2) + pinned task that resembles
	// an atlas anchor → flag struggle. Web AtlasPage subtly highlights matched
	// nodes. Heuristic is conservative: only fires when task_pinned has an
	// explicit anchor prefix («node:», «atlas:», «track:») to avoid false
	// positives on free-form titles like «refactor api».
	if uc.StruggleMark != nil && saved.Grade != nil && *saved.Grade >= 1 && *saved.Grade <= 2 {
		if anchor := atlasAnchorFromPinned(saved.TaskPinned); anchor != "" {
			confidence := 0.8
			if *saved.Grade == 1 {
				confidence = 0.95
			}
			note := saved.Notes
			if note == "" {
				note = fmt.Sprintf("reflection grade %d/5", *saved.Grade)
			}
			_ = uc.StruggleMark.Do(ctx, MarkAtlasStruggleInput{
				UserID:      in.UserID,
				AtlasNodeID: anchor,
				Source:      string(domain.AtlasStruggleSourceHoneReflection),
				Confidence:  confidence,
				Note:        note,
			})
		}
	}
	return saved, nil
}

// atlasAnchorFromPinned recognises explicit atlas-anchor prefixes in a
// pinned task title. Returns the canonical node id, or empty when no
// recognisable prefix. Conservative — free-form titles return "".
func atlasAnchorFromPinned(pinned string) string {
	s := strings.TrimSpace(pinned)
	if s == "" {
		return ""
	}
	lower := strings.ToLower(s)
	for _, prefix := range []string{"node:", "atlas:", "track:"} {
		if strings.HasPrefix(lower, prefix) {
			return lower
		}
	}
	return ""
}

func (uc *SaveFocusReflection) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now().UTC()
}

// validFocusMode mirrors hone_focus_mode_valid CHECK constraint (00068).
// Kept в UC чтобы пинговать invalid input до DB round-trip'а.
func validFocusMode(m string) bool {
	switch m {
	case "pomodoro", "stopwatch", "free", "plan", "pinned", "countdown":
		return true
	}
	return false
}

// focusReflectionSummary — single-line "what happened" для coach memory.
// Coach next-action prompt видит «25 min pomodoro · grade 2 · stuck on
// joins» — это даёт directional context для recommendation.
func focusReflectionSummary(r domain.FocusReflection) string {
	mins := r.DurationSeconds / 60
	parts := []string{fmt.Sprintf("%d min %s", mins, r.FocusMode)}
	if r.Grade != nil {
		parts = append(parts, fmt.Sprintf("grade %d/5", *r.Grade))
	}
	if r.TaskPinned != "" {
		parts = append(parts, "on "+r.TaskPinned)
	}
	if r.Notes != "" {
		preview := r.Notes
		if len(preview) > 200 {
			preview = preview[:200] + "…"
		}
		parts = append(parts, preview)
	}
	return strings.Join(parts, " · ")
}

// focusReflectionPayload — JSONB payload для coach_episodes row.
// Keeps structured data accessible for future analytics (avg grade trend,
// stuck-area detection) without re-parsing summary text.
func focusReflectionPayload(r domain.FocusReflection) map[string]any {
	out := map[string]any{
		"source":           "hone_focus",
		"reflection_id":    r.ID.String(),
		"session_id":       r.SessionID,
		"focus_mode":       r.FocusMode,
		"duration_seconds": r.DurationSeconds,
		"notes":            r.Notes,
		"task_pinned":      r.TaskPinned,
		"started_at":       r.StartedAt.UTC().Format(time.RFC3339),
		"ended_at":         r.EndedAt.UTC().Format(time.RFC3339),
	}
	if r.Grade != nil {
		out["grade"] = *r.Grade
	}
	return out
}
