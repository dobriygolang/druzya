// Package app contains the ai_native use cases. Each handler is a thin
// orchestrator — persistence lives in infra/, rules in domain/.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/ai_native/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// CreateSession implements POST /api/v1/native/session.
type CreateSession struct {
	Sessions domain.SessionRepo
	Tasks    domain.TaskRepo
	Users    domain.UserRepo

	DefaultModelFree enums.LLMModel
	DefaultModelPaid enums.LLMModel
	Log              *slog.Logger
	Now              func() time.Time
}

// CreateSessionInput is the validated use-case payload.
type CreateSessionInput struct {
	UserID         uuid.UUID
	Section        enums.Section
	Difficulty     enums.Difficulty
	PreferredModel enums.LLMModel
}

// CreateSessionOutput bundles the session plus the public task (needed by the
// response; MUST NOT contain the hint).
type CreateSessionOutput struct {
	Session domain.Session
	Task    domain.TaskPublic
}

// Do executes the use case.
func (uc *CreateSession) Do(ctx context.Context, in CreateSessionInput) (CreateSessionOutput, error) {
	if err := domain.ValidateCreate(in.Section, in.Difficulty); err != nil {
		return CreateSessionOutput{}, fmt.Errorf("native.CreateSession: validate: %w", err)
	}

	user, err := uc.Users.Get(ctx, in.UserID)
	if err != nil {
		return CreateSessionOutput{}, fmt.Errorf("native.CreateSession: user: %w", err)
	}
	if in.PreferredModel.IsValid() {
		user.PreferredModel = in.PreferredModel
	}

	task, err := uc.Tasks.PickForSession(ctx, in.Section.String(), in.Difficulty.String())
	if err != nil {
		return CreateSessionOutput{}, fmt.Errorf("native.CreateSession: pick task: %w", err)
	}

	model := domain.PickModel(user, in.Section, uc.DefaultModelFree, uc.DefaultModelPaid)

	s := domain.Session{
		UserID:     in.UserID,
		TaskID:     task.ID,
		Section:    in.Section,
		Difficulty: in.Difficulty,
		LLMModel:   model,
	}
	created, err := uc.Sessions.Create(ctx, s)
	if err != nil {
		return CreateSessionOutput{}, fmt.Errorf("native.CreateSession: persist: %w", err)
	}
	if uc.Log != nil {
		uc.Log.InfoContext(ctx, "native: session created",
			slog.String("session_id", created.ID.String()),
			slog.String("section", in.Section.String()),
			slog.String("model", string(model)),
		)
	}
	return CreateSessionOutput{Session: created, Task: task.ToPublic()}, nil
}

func (uc *CreateSession) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now().UTC()
}

var _ = (*CreateSession)(nil).now // keep helper referenced for future use
