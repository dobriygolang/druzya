package app

import (
	"context"
	"fmt"
	"log/slog"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// SessionEndedPublisher is the narrow interface the use case uses to
// notify an analyzer subscriber — kept local so we don't pull the whole
// eventbus package into the domain. The monolith wiring wraps the bus.
type SessionEndedPublisher interface {
	PublishSessionEnded(ctx context.Context, ev SessionEndedEvent)
}

// SessionEndedEvent — the minimum payload an analyzer needs to kick off.
// Keep it small; the analyzer fetches conversations on demand.
type SessionEndedEvent struct {
	SessionID uuid.UUID
	UserID    uuid.UUID
	Kind      domain.SessionKind
	BYOKOnly  bool
}

// EndSession — implements POST /api/v1/copilot/sessions/{id}/end.
// Side effects:
//  1. End the session (finished_at = now).
//  2. Initialize a pending report row so GetSessionAnalysis has
//     something to return while the analyzer works.
//  3. Publish SessionEndedEvent on the bus. Non-interview / byok-only
//     sessions still fire the event; the analyzer itself decides
//     whether to run.
type EndSession struct {
	Sessions  domain.SessionRepo
	Reports   domain.ReportRepo
	Publisher SessionEndedPublisher
	Log       *slog.Logger
}

type EndSessionInput struct {
	UserID    uuid.UUID
	SessionID uuid.UUID
}

func (uc *EndSession) Do(ctx context.Context, in EndSessionInput) (domain.Session, error) {
	// Load first so we can return the fresh state + enforce ownership
	// separately from the end call (End is a no-op on wrong-user).
	s, err := uc.Sessions.Get(ctx, in.SessionID)
	if err != nil {
		return domain.Session{}, fmt.Errorf("copilot.EndSession: %w", err)
	}
	if s.UserID != in.UserID {
		return domain.Session{}, fmt.Errorf("copilot.EndSession: %w", domain.ErrNotFound)
	}
	if endErr := uc.Sessions.End(ctx, in.SessionID, in.UserID); endErr != nil {
		return domain.Session{}, fmt.Errorf("copilot.EndSession: %w", endErr)
	}

	// Reload with the updated finished_at for the response.
	ended, err := uc.Sessions.Get(ctx, in.SessionID)
	if err != nil {
		return domain.Session{}, fmt.Errorf("copilot.EndSession: reload: %w", err)
	}

	// Only seed the report row for interview sessions — other kinds
	// don't trigger LLM analysis today.
	if ended.Kind == domain.SessionKindInterview {
		if _, err := uc.Reports.Init(ctx, in.SessionID); err != nil && uc.Log != nil {
			uc.Log.Warn("copilot.EndSession: report init failed", "err", err, "session", in.SessionID)
		}
	}

	// Fire-and-forget the event. Publishing should be cheap (in-process
	// channel / goroutine dispatch); if it blocks or errors, don't
	// propagate — the session is already ended from the user's POV.
	if uc.Publisher != nil {
		uc.Publisher.PublishSessionEnded(ctx, SessionEndedEvent{
			SessionID: ended.ID,
			UserID:    ended.UserID,
			Kind:      ended.Kind,
			BYOKOnly:  ended.BYOKOnly,
		})
	}

	return ended, nil
}
