package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ─── StartFocus ────────────────────────────────────────────────────────────

// StartFocus inserts a hone_focus_sessions row with ended_at = nil and
// returns the row hydrated with server-side id + started_at.
//
// Design note: the client could compute started_at locally to avoid a
// round-trip; we deliberately go with server time so the heatmap/streak
// aggregation has one consistent clock. Clock skew on multi-device users
// otherwise causes "today's streak credited to yesterday" bugs.
type StartFocus struct {
	Focus domain.FocusRepo
	Log   *slog.Logger
	Now   func() time.Time
}

// StartFocusInput — wire body.
type StartFocusInput struct {
	UserID      uuid.UUID
	PlanItemID  string
	PinnedTitle string
	Mode        domain.FocusMode
}

// Do executes the use case.
func (uc *StartFocus) Do(ctx context.Context, in StartFocusInput) (domain.FocusSession, error) {
	if !in.Mode.IsValid() {
		in.Mode = domain.FocusModePomodoro
	}
	s := domain.FocusSession{
		UserID:      in.UserID,
		PlanItemID:  in.PlanItemID,
		PinnedTitle: in.PinnedTitle,
		Mode:        in.Mode,
		StartedAt:   uc.Now().UTC(),
	}
	created, err := uc.Focus.Create(ctx, s)
	if err != nil {
		return domain.FocusSession{}, fmt.Errorf("hone.StartFocus.Do: %w", err)
	}
	return created, nil
}

// ─── EndFocus ──────────────────────────────────────────────────────────────

// EndFocus closes the session, applies the delta to streak aggregates in
// the same transaction, and emits a FocusSessionEnded event so profile/web
// can surface the updated focus-time on the arena side.
//
// Idempotency: ending an already-ended session is rejected (ErrNotFound)
// to avoid double-counting. The client uses expected_version-style retries
// via session id — a second End with the same id is a bug, not a feature.
type EndFocus struct {
	Focus             domain.FocusRepo
	Streaks           domain.StreakRepo
	Notes             domain.NoteRepo // nullable — без него reflection игнорируется
	EmbedFn           func(ctx context.Context, userID, noteID uuid.UUID, text string)
	Log               *slog.Logger
	Now               func() time.Time
	QualifyingSeconds int // defaults to MinQualifyingFocusSeconds
	// Memory — optional Phase B-2 hook в Coach memory. nil = no-op.
	Memory domain.MemoryHook
}

// EndFocusInput — wire body.
type EndFocusInput struct {
	UserID             uuid.UUID
	SessionID          uuid.UUID
	PomodorosCompleted int
	SecondsFocused     int
	// Reflection — опциональная одна строка «что сделал за эту сессию».
	// Если непустая, создаётся заметка с title = pinned_title/plan_item_id
	// + дата, body = reflection. Пустая строка = обычный end-focus без
	// побочного эффекта.
	Reflection string
}

// Do executes the use case.
func (uc *EndFocus) Do(ctx context.Context, in EndFocusInput) (domain.FocusSession, error) {
	threshold := uc.QualifyingSeconds
	if threshold <= 0 {
		threshold = MinQualifyingFocusSeconds
	}
	now := uc.Now().UTC()

	ended, err := uc.Focus.End(ctx, in.UserID, in.SessionID, now, in.PomodorosCompleted, in.SecondsFocused)
	if err != nil {
		return domain.FocusSession{}, fmt.Errorf("hone.EndFocus.Do: %w", err)
	}

	// Apply to streak aggregates. Done after End (not in same TX) for MVP
	// simplicity — drift window is one focus session and gets corrected
	// on the next End call. Migrate to single-TX via FocusRepo.EndWithStreak
	// if reconciliation noise shows up in logs.
	//
	// Skip insta-stop сессии (<60s) чтобы юзеры которые тестируют таймер
	// или случайно нажимают Start не получали ложные «10 sessions today».
	// Real focus = минимум минута. Streak/coach-stats остаются чистыми.
	day := now.Truncate(24 * time.Hour)
	if in.SecondsFocused >= 60 {
		if _, err := uc.Streaks.ApplyFocusSession(ctx, in.UserID, day, in.SecondsFocused, 1, threshold); err != nil {
			uc.Log.Error("hone.EndFocus.Do: streak apply failed", slog.Any("err", err), slog.String("session_id", in.SessionID.String()))
		}
	}

	// Coach memory: hook'ы fire-and-forget. Caller-context может уже
	// закрыться — implementation использует BG-ctx внутри.
	if uc.Memory != nil {
		uc.Memory.OnFocusSessionDone(ctx, in.UserID, ended.PinnedTitle,
			in.SecondsFocused, ended.PlanItemID, in.PomodorosCompleted, now)
		if in.Reflection != "" {
			uc.Memory.OnReflectionAdded(ctx, in.UserID, in.Reflection,
				ended.PlanItemID, in.SecondsFocused, now)
		}
	}

	// Reflection — auto-note «что сделал за эту сессию». Опциональный
	// побочный эффект: ошибка не роняет EndFocus — сессия уже persisted
	// и стрик применён, провал записи reflection'а — второстепенная
	// потеря. Warn-лог достаточен.
	if uc.Notes != nil && in.Reflection != "" {
		title := ended.PinnedTitle
		if title == "" {
			title = "Focus session"
		}
		title = title + " — " + day.Format("2006-01-02")
		body := in.Reflection +
			"\n\n---\n" +
			"Session: " + in.SessionID.String() + "  \n" +
			"Duration: " + time.Duration(in.SecondsFocused*int(time.Second)).String()
		n := domain.Note{
			UserID:    in.UserID,
			Title:     title,
			BodyMD:    body,
			SizeBytes: len(body),
			CreatedAt: now,
			UpdatedAt: now,
		}
		created, cerr := uc.Notes.Create(ctx, n)
		if cerr != nil {
			uc.Log.Warn("hone.EndFocus.Do: reflection note create failed",
				slog.Any("err", cerr), slog.String("session_id", in.SessionID.String()))
		} else if uc.EmbedFn != nil {
			go uc.EmbedFn(context.Background(), in.UserID, created.ID, created.Title+"\n\n"+created.BodyMD)
		}
	}
	return ended, nil
}

// ─── GetStats ──────────────────────────────────────────────────────────────

// GetStats hydrates the right-side widgets of the Stats page — heatmap
// (182 days), streak numbers, last-7-day bars, totals.
type GetStats struct {
	Streaks domain.StreakRepo
	Now     func() time.Time
	// Queue — nullable. Если задан, добавляет QueueStats в response для
	// карточки «Focus balance · 7 days» на странице Stats. Без этого hook'а
	// Stats.Queue остаётся zero-value и UI не рендерит карточку.
	Queue domain.QueueRepo
}

// GetStatsInput — wire body.
type GetStatsInput struct {
	UserID   uuid.UUID
	UpToDate time.Time // if zero, Now().UTC() truncated to day
}

// Do executes the use case.
func (uc *GetStats) Do(ctx context.Context, in GetStatsInput) (domain.Stats, error) {
	to := in.UpToDate
	if to.IsZero() {
		to = uc.Now().UTC().Truncate(24 * time.Hour)
	}
	// 182 = 7 * 26 (Winter-style heatmap).
	heatmapFrom := to.AddDate(0, 0, -181)

	state, err := uc.Streaks.GetState(ctx, in.UserID)
	if err != nil {
		return domain.Stats{}, fmt.Errorf("hone.GetStats.Do: state: %w", err)
	}
	days, err := uc.Streaks.RangeDays(ctx, in.UserID, heatmapFrom, to)
	if err != nil {
		return domain.Stats{}, fmt.Errorf("hone.GetStats.Do: range: %w", err)
	}

	// Compute total + last-7 slice from the single range scan.
	var total int
	lastSeven := make([]domain.StreakDay, 0, 7)
	sevenFrom := to.AddDate(0, 0, -6)
	for _, d := range days {
		total += d.FocusedSeconds
		if !d.Day.Before(sevenFrom) {
			lastSeven = append(lastSeven, d)
		}
	}

	out := domain.Stats{
		CurrentStreakDays: state.CurrentStreak,
		LongestStreakDays: state.LongestStreak,
		TotalFocusedSecs:  total,
		Heatmap:           days,
		LastSevenDays:     lastSeven,
	}
	// Queue stats — best-effort. Failure non-fatal: Stats.Queue остаётся
	// zero-value, UI просто не рендерит карточку.
	if uc.Queue != nil {
		qs := &GetQueueStats{Queue: uc.Queue}
		if qStats, qerr := qs.Do(ctx, in.UserID); qerr == nil {
			out.Queue = qStats
		}
	}
	return out, nil
}
