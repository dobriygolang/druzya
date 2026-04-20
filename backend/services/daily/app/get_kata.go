// Package app contains the daily use cases: kata select/submit, streak read,
// calendar upsert, autopsy create/get, and the DailyKataCompleted event handler.
package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/daily/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// GetKata implements GET /daily/kata. Picks the user's weakest node and a
// deterministic-per-day task inside that (section, difficulty).
type GetKata struct {
	Skills domain.SkillRepo
	Tasks  domain.TaskRepo
	Katas  domain.KataRepo
	Now    func() time.Time // injectable clock for tests
}

// Do returns today's kata.
func (uc *GetKata) Do(ctx context.Context, userID uuid.UUID) (domain.Kata, error) {
	now := uc.Now().UTC()
	today := now.Truncate(24 * time.Hour)

	weak, err := uc.Skills.WeakestNode(ctx, userID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return domain.Kata{}, fmt.Errorf("daily.GetKata: weakest node: %w", err)
	}
	difficulty := domain.DifficultyForProgress(weak.Progress)
	section := weak.Section
	if !section.IsValid() {
		// New user without a weakest-node row: default to algorithms/easy.
		section = enums.SectionAlgorithms
	}
	if !difficulty.IsValid() {
		difficulty = enums.DifficultyEasy
	}

	candidates, err := uc.Tasks.ListActiveBySectionDifficulty(ctx, section, difficulty)
	if err != nil {
		return domain.Kata{}, fmt.Errorf("daily.GetKata: list tasks: %w", err)
	}
	if len(candidates) == 0 {
		return domain.Kata{}, fmt.Errorf("daily.GetKata: no active tasks for section=%s diff=%s", section, difficulty)
	}
	pick, ok := domain.PickKataForUser(userID, today, candidates)
	if !ok {
		return domain.Kata{}, fmt.Errorf("daily.GetKata: picker returned empty")
	}

	isCursed, isWeeklyBoss := domain.KataModifiers(today)
	assignment, _, err := uc.Katas.GetOrAssign(ctx, userID, today, pick.ID, isCursed, isWeeklyBoss)
	if err != nil {
		return domain.Kata{}, fmt.Errorf("daily.GetKata: persist assignment: %w", err)
	}
	// If we had an existing assignment with a different task, respect that stored choice.
	if assignment.TaskID != pick.ID {
		stored, err := uc.Tasks.GetByID(ctx, assignment.TaskID)
		if err != nil {
			return domain.Kata{}, fmt.Errorf("daily.GetKata: load stored task: %w", err)
		}
		pick = stored
	}

	return domain.Kata{
		Date:         today,
		Task:         pick,
		IsCursed:     assignment.IsCursed,
		IsWeeklyBoss: assignment.IsWeeklyBoss,
		AlreadyDone:  assignment.Passed != nil && *assignment.Passed,
	}, nil
}
