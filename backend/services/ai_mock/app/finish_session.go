package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/ai_mock/domain"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// FinishSession implements POST /api/v1/mock/session/:id/finish.
type FinishSession struct {
	Sessions domain.SessionRepo
	Bus      sharedDomain.Bus
	Worker   *ReportWorker
	Log      *slog.Logger
	Now      func() time.Time
}

// Do transitions the session to finished, enqueues the report job, and emits
// the MockSessionFinished event.
func (uc *FinishSession) Do(ctx context.Context, userID, sessionID uuid.UUID) (domain.Session, error) {
	s, err := uc.Sessions.Get(ctx, sessionID)
	if err != nil {
		return domain.Session{}, fmt.Errorf("mock.FinishSession: %w", err)
	}
	if s.UserID != userID {
		return domain.Session{}, fmt.Errorf("mock.FinishSession: %w", domain.ErrForbidden)
	}
	if s.Status == enums.MockStatusFinished {
		return s, nil // idempotent
	}
	if err := uc.Sessions.UpdateStatus(ctx, sessionID, enums.MockStatusFinished.String(), true); err != nil {
		return domain.Session{}, fmt.Errorf("mock.FinishSession: update: %w", err)
	}
	s.Status = enums.MockStatusFinished
	now := uc.now()
	s.FinishedAt = &now

	if uc.Worker != nil {
		uc.Worker.Enqueue(sessionID)
	}

	if uc.Bus != nil {
		if err := uc.Bus.Publish(ctx, sharedDomain.MockSessionFinished{
			SessionID:    s.ID,
			UserID:       s.UserID,
			Section:      s.Section,
			CompanyID:    s.CompanyID,
			OverallScore: 0, // populated when report completes
			Abandoned:    false,
		}); err != nil {
			uc.Log.WarnContext(ctx, "mock.FinishSession: publish event", slog.Any("err", err))
		}
	}
	return s, nil
}

func (uc *FinishSession) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now().UTC()
}
