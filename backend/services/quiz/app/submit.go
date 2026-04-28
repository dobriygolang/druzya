package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/quiz/domain"

	"github.com/google/uuid"
)

// SubmitSession — grades a finished session and publishes the bus event.
type SubmitSession struct {
	Sessions domain.SessionStore
	Grader   domain.Grader
	Bus      domain.Bus
	Log      *slog.Logger
}

// SubmitSessionInput.
//
// Answers — map[question_id]given_answer. Missing question_ids count as
// blank answers (graded as wrong). Extra ids are ignored.
type SubmitSessionInput struct {
	UserID    uuid.UUID
	SessionID uuid.UUID
	Answers   map[string]string
}

// Do executes the use case.
func (uc *SubmitSession) Do(ctx context.Context, in SubmitSessionInput) (domain.Result, error) {
	s, err := uc.Sessions.Get(ctx, in.SessionID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) || errors.Is(err, domain.ErrSessionExpired) {
			return domain.Result{}, fmt.Errorf("quiz.SubmitSession: %w", err)
		}
		return domain.Result{}, fmt.Errorf("quiz.SubmitSession: get: %w", err)
	}
	if s.UserID != in.UserID {
		// Session belongs to someone else — surface as not-found to avoid
		// disclosing that a foreign session exists.
		return domain.Result{}, fmt.Errorf("quiz.SubmitSession: %w", domain.ErrNotFound)
	}

	res := domain.Result{
		SessionID:  s.ID,
		UserID:     s.UserID,
		Source:     s.Source,
		Total:      len(s.Questions),
		Judgements: make([]domain.AnswerJudgement, 0, len(s.Questions)),
	}
	for _, q := range s.Questions {
		given := in.Answers[q.ID]
		j, err := uc.Grader.Grade(ctx, q, given)
		if err != nil {
			return domain.Result{}, fmt.Errorf("quiz.SubmitSession: grade %q: %w", q.ID, err)
		}
		res.Judgements = append(res.Judgements, j)
		if j.Correct {
			res.Correct++
		}
	}

	// Best-effort publish — even if the bus is down we still return the
	// result to the user. Hone task settlement will catch up on the next
	// generator sweep.
	if uc.Bus != nil {
		if err := uc.Bus.PublishSessionCompleted(ctx, res); err != nil && uc.Log != nil {
			uc.Log.WarnContext(ctx, "quiz.SubmitSession: publish failed", "err", err)
		}
	}

	// Tear down the session after grading; another submit on the same id
	// returns 404 (no replays).
	if err := uc.Sessions.Delete(ctx, s.ID); err != nil && uc.Log != nil {
		uc.Log.WarnContext(ctx, "quiz.SubmitSession: cleanup failed", "err", err)
	}
	return res, nil
}
