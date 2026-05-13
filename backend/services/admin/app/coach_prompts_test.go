package app

import (
	"context"
	"errors"
	"testing"

	"druz9/admin/domain"
	"druz9/admin/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestCreateCoachPrompt_RejectsBadCategory(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &CreateCoachPrompt{Repo: mocks.NewMockCoachPromptRepo(ctrl)}
	_, err := uc.Do(context.Background(), domain.CoachPromptUpsert{
		Slug: "x", Category: "nope", Template: "hello",
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCreateCoachPrompt_RejectsBadVariable(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &CreateCoachPrompt{Repo: mocks.NewMockCoachPromptRepo(ctrl)}
	_, err := uc.Do(context.Background(), domain.CoachPromptUpsert{
		Slug: "x", Category: "daily_brief", Template: "hi {{x}}",
		Variables: []string{"plain"},
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCreateCoachPrompt_Success(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockCoachPromptRepo(ctrl)
	repo.EXPECT().Create(gomock.Any(), gomock.Any()).Return(domain.CoachPrompt{Slug: "x", Version: 1}, nil)
	uc := &CreateCoachPrompt{Repo: repo}
	_, err := uc.Do(context.Background(), domain.CoachPromptUpsert{
		Slug: "x", Category: "daily_brief", Template: "hi {{goal}}",
		Variables: []string{"{{goal}}"},
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestDeactivateCoachPrompt_RejectsNilID(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &DeactivateCoachPrompt{Repo: mocks.NewMockCoachPromptRepo(ctrl)}
	if err := uc.Do(context.Background(), uuid.Nil); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}
