package app

import (
	"context"
	"fmt"
	"time"

	"druz9/learning_state/domain"

	"github.com/google/uuid"
)

// SetMode переключает режим. Lazy-create аналогичен GetState — если
// строки нет, считаем что юзер был в default-explore.
type SetMode struct {
	Repo  domain.Repo
	Clock Clock
}

// Input — без structurals; trackID nil для explore, обязателен для commit/deep.
type SetModeInput struct {
	UserID  uuid.UUID
	Mode    domain.Mode
	TrackID *uuid.UUID
}

func (uc SetMode) Execute(ctx context.Context, in SetModeInput) (domain.State, error) {
	now := uc.now()
	getter := GetState{Repo: uc.Repo, Clock: func() time.Time { return now }}
	prev, err := getter.Execute(ctx, in.UserID)
	if err != nil {
		return domain.State{}, fmt.Errorf("learning_state.SetMode load: %w", err)
	}
	next, err := domain.ApplyMode(prev, in.Mode, in.TrackID, now)
	if err != nil {
		return domain.State{}, err
	}
	if err := uc.Repo.Upsert(ctx, next); err != nil {
		return domain.State{}, fmt.Errorf("learning_state.SetMode persist: %w", err)
	}
	return next, nil
}

func (uc SetMode) now() time.Time {
	if uc.Clock != nil {
		return uc.Clock()
	}
	return time.Now()
}

// SetFork выставляет fork_branch. nil = очистить выбор (admin-only flow).
type SetFork struct {
	Repo  domain.Repo
	Clock Clock
}

type SetForkInput struct {
	UserID uuid.UUID
	Branch *domain.ForkBranch
}

func (uc SetFork) Execute(ctx context.Context, in SetForkInput) (domain.State, error) {
	now := uc.now()
	getter := GetState{Repo: uc.Repo, Clock: func() time.Time { return now }}
	prev, err := getter.Execute(ctx, in.UserID)
	if err != nil {
		return domain.State{}, fmt.Errorf("learning_state.SetFork load: %w", err)
	}
	next, err := domain.ApplyFork(prev, in.Branch, now)
	if err != nil {
		return domain.State{}, err
	}
	if err := uc.Repo.Upsert(ctx, next); err != nil {
		return domain.State{}, fmt.Errorf("learning_state.SetFork persist: %w", err)
	}
	return next, nil
}

func (uc SetFork) now() time.Time {
	if uc.Clock != nil {
		return uc.Clock()
	}
	return time.Now()
}
