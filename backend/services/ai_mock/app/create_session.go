// Package app contains the ai_mock use cases. Each handler is a thin
// orchestrator — persistence lives in infra/, rules in domain/.
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

// CreateSession implements POST /api/v1/mock/session.
type CreateSession struct {
	Sessions  domain.SessionRepo
	Tasks     domain.TaskRepo
	Users     domain.UserRepo
	Companies domain.CompanyRepo
	Bus       sharedDomain.Bus

	DefaultModelFree enums.LLMModel
	DefaultModelPaid enums.LLMModel
	Log              *slog.Logger
	Now              func() time.Time
}

// CreateSessionInput is the validated use-case payload.
type CreateSessionInput struct {
	UserID         uuid.UUID
	CompanyID      uuid.UUID
	Section        enums.Section
	Difficulty     enums.Difficulty
	DurationMin    int
	VoiceMode      bool
	PairedUserID   *uuid.UUID
	DevilsAdvocate bool
	PreferredModel enums.LLMModel // empty if no preference
}

// Do executes the use case and returns the persisted session.
func (uc *CreateSession) Do(ctx context.Context, in CreateSessionInput) (domain.Session, error) {
	if err := domain.ValidateCreate(in.CompanyID, in.Section, in.Difficulty, in.DurationMin); err != nil {
		return domain.Session{}, fmt.Errorf("mock.CreateSession: validate: %w", err)
	}

	// Fetch user + company context for model selection.
	user, err := uc.Users.Get(ctx, in.UserID)
	if err != nil {
		return domain.Session{}, fmt.Errorf("mock.CreateSession: user: %w", err)
	}
	if in.PreferredModel.IsValid() {
		user.PreferredModel = in.PreferredModel
	}
	company, err := uc.Companies.Get(ctx, in.CompanyID)
	if err != nil {
		return domain.Session{}, fmt.Errorf("mock.CreateSession: company: %w", err)
	}

	task, err := uc.Tasks.PickForSession(ctx, in.Section.String(), in.Difficulty.String())
	if err != nil {
		return domain.Session{}, fmt.Errorf("mock.CreateSession: pick task: %w", err)
	}

	model := domain.PickModel(user, "", in.Section, company, uc.DefaultModelFree, uc.DefaultModelPaid)

	duration := in.DurationMin
	if duration == 0 {
		duration = 45 // openapi default
	}

	now := uc.now()
	s := domain.Session{
		UserID:         in.UserID,
		CompanyID:      in.CompanyID,
		TaskID:         task.ID,
		Section:        in.Section,
		Difficulty:     in.Difficulty,
		Status:         enums.MockStatusCreated,
		DurationMin:    duration,
		VoiceMode:      in.VoiceMode,
		PairedUserID:   in.PairedUserID,
		LLMModel:       model,
		DevilsAdvocate: in.DevilsAdvocate,
		StartedAt:      &now,
	}
	created, err := uc.Sessions.Create(ctx, s)
	if err != nil {
		return domain.Session{}, fmt.Errorf("mock.CreateSession: persist: %w", err)
	}
	// Preserve devils_advocate flag (not on the DB row) for downstream use
	// within the returned struct.
	created.DevilsAdvocate = in.DevilsAdvocate

	if uc.Bus != nil {
		if err := uc.Bus.Publish(ctx, sharedDomain.MockSessionCreated{
			SessionID: created.ID,
			UserID:    created.UserID,
			Section:   created.Section,
			CompanyID: created.CompanyID,
		}); err != nil {
			uc.Log.WarnContext(ctx, "mock.CreateSession: publish event", slog.Any("err", err))
		}
	}
	return created, nil
}

func (uc *CreateSession) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now().UTC()
}
