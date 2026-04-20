package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/daily/domain"
	sharedDomain "druz9/shared/domain"

	"github.com/google/uuid"
)

// XPKataDaily is the base XP reward for completing a daily kata.
// The cursed-day multiplier lives in the event handler that reacts to
// DailyKataCompleted — this constant matches dynamic_config `xp_kata_daily`.
const XPKataDaily = 30

// CursedMultiplier triples XP on Fridays (bible §). Value mirrors
// dynamic_config `xp_kata_cursed_multiplier`.
const CursedMultiplier = 3

// SubmitKata implements POST /daily/kata/submit.
type SubmitKata struct {
	Tasks   domain.TaskRepo
	Katas   domain.KataRepo
	Streaks domain.StreakRepo
	Judge   domain.Judge0Client
	Bus     sharedDomain.Bus
	Log     *slog.Logger
	Now     func() time.Time
}

// SubmitKataInput carries the user-supplied payload.
type SubmitKataInput struct {
	UserID   uuid.UUID
	Code     string
	Language string
}

// Do verifies, updates streak, returns the result.
func (uc *SubmitKata) Do(ctx context.Context, in SubmitKataInput) (domain.KataSubmissionResult, error) {
	now := uc.Now().UTC()
	today := now.Truncate(24 * time.Hour)

	// Load today's assignment via history so we have the task id.
	history, err := uc.Katas.HistoryLast30(ctx, in.UserID, today)
	if err != nil {
		return domain.KataSubmissionResult{}, fmt.Errorf("daily.SubmitKata: load history: %w", err)
	}
	for _, h := range history {
		if sameDay(h.Date, today) {
			if h.Passed != nil && *h.Passed {
				return domain.KataSubmissionResult{}, fmt.Errorf("daily.SubmitKata: %w", domain.ErrAlreadySubmitted)
			}
		}
	}
	taskID := loadTodaysTaskID(history, today)

	// STUB: real Judge0 client. For MVP, every submission passes with a
	// single-case scoreboard.
	passed, total, ok, err := uc.Judge.Submit(ctx, in.Code, in.Language, domain.TaskPublic{})
	if err != nil {
		return domain.KataSubmissionResult{}, fmt.Errorf("daily.SubmitKata: judge: %w", err)
	}

	if err := uc.Katas.MarkSubmitted(ctx, in.UserID, today, passed); err != nil {
		return domain.KataSubmissionResult{}, fmt.Errorf("daily.SubmitKata: mark: %w", err)
	}

	streak, err := uc.updateStreak(ctx, in.UserID, today, passed)
	if err != nil {
		return domain.KataSubmissionResult{}, fmt.Errorf("daily.SubmitKata: streak: %w", err)
	}

	isCursed := now.Weekday() == time.Friday
	xp := XPKataDaily
	if isCursed {
		xp *= CursedMultiplier
	}

	// Event out (XPGained is emitted by the daily handler that subscribes to
	// DailyKataCompleted — see app/handlers.go).
	if passed {
		if perr := uc.Bus.Publish(ctx, sharedDomain.DailyKataCompleted{
			UserID:    in.UserID,
			TaskID:    taskID,
			StreakNew: streak.CurrentStreak,
			XPEarned:  xp,
			IsCursed:  isCursed,
		}); perr != nil {
			uc.Log.WarnContext(ctx, "daily.SubmitKata: publish completed", slog.Any("err", perr))
		}
	}

	info, err := buildStreakInfo(streak, history)
	if err != nil {
		return domain.KataSubmissionResult{}, fmt.Errorf("daily.SubmitKata: build streak info: %w", err)
	}
	return domain.KataSubmissionResult{
		Passed:      passed,
		TestsTotal:  total,
		TestsPassed: ok,
		XPEarned:    xp,
		IsCursed:    isCursed,
		Streak:      info,
	}, nil
}

func (uc *SubmitKata) updateStreak(ctx context.Context, userID uuid.UUID, today time.Time, passed bool) (domain.StreakState, error) {
	s, err := uc.Streaks.Get(ctx, userID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return domain.StreakState{}, fmt.Errorf("get streak: %w", err)
	}
	if passed {
		// Consecutive if last_kata_date was yesterday; reset to 1 otherwise.
		if s.LastKataDate != nil && sameDay(s.LastKataDate.Add(24*time.Hour), today) {
			s.CurrentStreak++
		} else {
			s.CurrentStreak = 1
		}
		if s.CurrentStreak > s.LongestStreak {
			s.LongestStreak = s.CurrentStreak
		}
		s.LastKataDate = &today
	}
	if err := uc.Streaks.Update(ctx, userID, s); err != nil {
		return domain.StreakState{}, fmt.Errorf("update streak: %w", err)
	}
	return s, nil
}

func sameDay(a, b time.Time) bool {
	ay, am, ad := a.UTC().Date()
	by, bm, bd := b.UTC().Date()
	return ay == by && am == bm && ad == bd
}
