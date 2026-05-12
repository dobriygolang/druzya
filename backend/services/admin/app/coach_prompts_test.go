package app

import (
	"context"
	"errors"
	"testing"

	"druz9/admin/domain"

	"github.com/google/uuid"
)

type fakeCoachPromptRepo struct {
	list      []domain.CoachPrompt
	createIn  domain.CoachPromptUpsert
	createOut domain.CoachPrompt
	updateOut domain.CoachPrompt
	deactID   uuid.UUID
	listErr   error
	createErr error
	updateErr error
	deactErr  error
}

func (f *fakeCoachPromptRepo) List(_ context.Context, _ bool) ([]domain.CoachPrompt, error) {
	return f.list, f.listErr
}
func (f *fakeCoachPromptRepo) GetByID(_ context.Context, _ uuid.UUID) (domain.CoachPrompt, error) {
	return domain.CoachPrompt{}, domain.ErrNotFound
}
func (f *fakeCoachPromptRepo) Create(_ context.Context, in domain.CoachPromptUpsert) (domain.CoachPrompt, error) {
	f.createIn = in
	return f.createOut, f.createErr
}
func (f *fakeCoachPromptRepo) Update(_ context.Context, _ uuid.UUID, _ domain.CoachPromptPatch) (domain.CoachPrompt, error) {
	return f.updateOut, f.updateErr
}
func (f *fakeCoachPromptRepo) Deactivate(_ context.Context, id uuid.UUID) error {
	f.deactID = id
	return f.deactErr
}

func TestCreateCoachPrompt_RejectsBadCategory(t *testing.T) {
	t.Parallel()
	uc := &CreateCoachPrompt{Repo: &fakeCoachPromptRepo{}}
	_, err := uc.Do(context.Background(), domain.CoachPromptUpsert{
		Slug: "x", Category: "nope", Template: "hello",
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCreateCoachPrompt_RejectsBadVariable(t *testing.T) {
	t.Parallel()
	uc := &CreateCoachPrompt{Repo: &fakeCoachPromptRepo{}}
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
	repo := &fakeCoachPromptRepo{createOut: domain.CoachPrompt{Slug: "x", Version: 1}}
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
	uc := &DeactivateCoachPrompt{Repo: &fakeCoachPromptRepo{}}
	if err := uc.Do(context.Background(), uuid.Nil); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}
