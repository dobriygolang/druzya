// Package app — quiz use cases (Start + Submit).
//
// Hone TaskBoard kind=quiz cards deep-link into /api/v1/quiz/start; the
// frontend renders the questions, collects answers, then POSTs them to
// /api/v1/quiz/{id}/submit. Every flow is two HTTP calls — no streaming,
// no state machine. The session lives in Redis with a 30-minute TTL.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/quiz/domain"

	"github.com/google/uuid"
)

// DefaultSessionTTL — how long a started quiz session remains valid for
// /submit. Matches the typical sit-down session length.
const DefaultSessionTTL = 30 * time.Minute

// DefaultQuestionsPerSession — handed out per session if caller didn't ask.
const DefaultQuestionsPerSession = 5

// StartSession — pulls a random question pack and persists the session.
type StartSession struct {
	Pool     domain.QuestionPool
	Sessions domain.SessionStore
	Now      func() time.Time
	Log      *slog.Logger
}

// StartSessionInput.
type StartSessionInput struct {
	UserID uuid.UUID
	Source domain.QuestionSource
	Topic  string
	Count  int
}

// Do executes the use case.
func (uc *StartSession) Do(ctx context.Context, in StartSessionInput) (domain.Session, error) {
	if !in.Source.IsValid() {
		return domain.Session{}, fmt.Errorf("quiz.StartSession: invalid source %q", in.Source)
	}
	count := in.Count
	if count <= 0 || count > 20 {
		count = DefaultQuestionsPerSession
	}
	qs, err := uc.Pool.Random(ctx, in.Source, in.Topic, count)
	if err != nil {
		return domain.Session{}, fmt.Errorf("quiz.StartSession: pool: %w", err)
	}
	if len(qs) == 0 {
		return domain.Session{}, fmt.Errorf("quiz.StartSession: %w: empty pool for source=%q topic=%q",
			domain.ErrNotFound, in.Source, in.Topic)
	}
	now := time.Now
	if uc.Now != nil {
		now = uc.Now
	}
	s := domain.Session{
		ID:        uuid.New(),
		UserID:    in.UserID,
		Source:    in.Source,
		Questions: qs,
		StartedAt: now().UTC(),
		ExpiresAt: now().UTC().Add(DefaultSessionTTL),
	}
	if err := uc.Sessions.Save(ctx, s); err != nil {
		return domain.Session{}, fmt.Errorf("quiz.StartSession: save: %w", err)
	}
	return s, nil
}
