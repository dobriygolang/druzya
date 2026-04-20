package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/daily/domain"

	"github.com/google/uuid"
)

// GetStreak implements GET /daily/streak.
type GetStreak struct {
	Streaks domain.StreakRepo
	Katas   domain.KataRepo
	Now     func() time.Time
}

// Do loads the streak state and builds a 30-day history window.
func (uc *GetStreak) Do(ctx context.Context, userID uuid.UUID) (domain.StreakInfo, error) {
	now := uc.Now().UTC()
	today := now.Truncate(24 * time.Hour)
	s, err := uc.Streaks.Get(ctx, userID)
	if err != nil && !isMissing(err) {
		return domain.StreakInfo{}, fmt.Errorf("daily.GetStreak: state: %w", err)
	}
	history, err := uc.Katas.HistoryLast30(ctx, userID, today)
	if err != nil {
		return domain.StreakInfo{}, fmt.Errorf("daily.GetStreak: history: %w", err)
	}
	out, err := buildStreakInfo(s, history)
	if err != nil {
		return domain.StreakInfo{}, fmt.Errorf("daily.GetStreak: build: %w", err)
	}
	return out, nil
}

// buildStreakInfo projects state + history into the StreakInfo DTO.
// history entries with FreezeUsed==true become nil in the history slice,
// per the openapi convention (null = freeze).
func buildStreakInfo(s domain.StreakState, history []domain.HistoryEntry) (domain.StreakInfo, error) {
	slice := make([]*bool, 0, len(history))
	for _, h := range history {
		switch {
		case h.FreezeUsed:
			slice = append(slice, nil)
		case h.Passed != nil:
			v := *h.Passed
			slice = append(slice, &v)
		default:
			f := false
			slice = append(slice, &f)
		}
	}
	return domain.StreakInfo{
		Current:      s.CurrentStreak,
		Longest:      s.LongestStreak,
		FreezeTokens: s.FreezeTokens,
		LastKataDate: s.LastKataDate,
		History:      slice,
	}, nil
}

// loadTodaysTaskID finds today's TaskID in the 30-day history slice.
func loadTodaysTaskID(history []domain.HistoryEntry, today time.Time) uuid.UUID {
	for _, h := range history {
		if sameDay(h.Date, today) {
			return h.TaskID
		}
	}
	return uuid.Nil
}

func isMissing(err error) bool {
	return errors.Is(err, domain.ErrNotFound)
}
