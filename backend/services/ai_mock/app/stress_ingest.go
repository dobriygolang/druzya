package app

import (
	"context"
	"fmt"

	"druz9/ai_mock/domain"

	"github.com/google/uuid"
)

// IngestStress implements POST /api/v1/mock/session/:id/stress.
type IngestStress struct {
	Sessions domain.SessionRepo
	Params   domain.StressScoringParams

	// Emit is invoked for each detected boundary crossing. Wired to the WS hub
	// in main.go — nil-safe for tests.
	Emit func(sessionID uuid.UUID, crossing domain.StressCrossing)
}

// IngestStressInput carries the decoded batch.
type IngestStressInput struct {
	UserID    uuid.UUID
	SessionID uuid.UUID
	Events    []domain.EditorEvent
}

// Do folds the events into the session's stress profile and persists the
// result. Boundary crossings emit WS events via uc.Emit.
func (uc *IngestStress) Do(ctx context.Context, in IngestStressInput) (domain.StressProfile, error) {
	s, err := uc.Sessions.Get(ctx, in.SessionID)
	if err != nil {
		return domain.StressProfile{}, fmt.Errorf("mock.IngestStress: %w", err)
	}
	if s.UserID != in.UserID {
		return domain.StressProfile{}, fmt.Errorf("mock.IngestStress: %w", domain.ErrForbidden)
	}

	params := uc.Params
	if params.DimensionCap == 0 {
		params = domain.DefaultStressScoring()
	}

	prior := s.Stress
	next := domain.ApplyStressEvents(prior, in.Events, params)
	if err := uc.Sessions.UpdateStress(ctx, in.SessionID, next); err != nil {
		return domain.StressProfile{}, fmt.Errorf("mock.IngestStress: persist: %w", err)
	}

	if uc.Emit != nil {
		for _, c := range domain.DetectStressBoundaries(prior, next) {
			uc.Emit(in.SessionID, c)
		}
	}
	return next, nil
}
