package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/admin/domain"
	"druz9/admin/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestListGoalPresets_PassesActiveFlag(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockGoalPresetRepo(ctrl)
	var lastActive bool
	repo.EXPECT().List(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, activeOnly bool) ([]domain.GoalPreset, error) {
			lastActive = activeOnly
			return []domain.GoalPreset{{Slug: "x"}}, nil
		},
	)
	uc := &ListGoalPresets{Repo: repo}
	out, err := uc.Do(context.Background(), true)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out) != 1 || !lastActive {
		t.Fatalf("activeOnly not propagated; active=%v", lastActive)
	}
}

func TestCreateGoalPreset_Validates(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &CreateGoalPreset{Repo: mocks.NewMockGoalPresetRepo(ctrl)}
	cases := []struct {
		name string
		in   domain.GoalPresetUpsert
	}{
		{"blank slug", domain.GoalPresetUpsert{Slug: "", Title: "x", Kind: "GOAL_KIND_ANY_SENIOR"}},
		{"blank title", domain.GoalPresetUpsert{Slug: "x", Title: " ", Kind: "GOAL_KIND_ANY_SENIOR"}},
		{"bad kind", domain.GoalPresetUpsert{Slug: "x", Title: "x", Kind: "any_senior"}},
		{"days too big", domain.GoalPresetUpsert{Slug: "x", Title: "x", Kind: "GOAL_KIND_ANY_SENIOR", DefaultTargetDays: ptrInt(99999)}},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			if _, err := uc.Do(context.Background(), c.in); !errors.Is(err, domain.ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput, got %v", err)
			}
		})
	}
}

func TestCreateGoalPreset_Success(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockGoalPresetRepo(ctrl)
	var captured domain.GoalPresetUpsert
	repo.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, in domain.GoalPresetUpsert) (domain.GoalPreset, error) {
			captured = in
			return domain.GoalPreset{
				ID:        uuid.New(),
				Slug:      in.Slug,
				Title:     in.Title,
				Kind:      in.Kind,
				IsActive:  true,
				CreatedAt: time.Now(),
			}, nil
		},
	)
	uc := &CreateGoalPreset{Repo: repo}
	out, err := uc.Do(context.Background(), domain.GoalPresetUpsert{
		Slug: "senior-yandex", Title: "Senior Backend @ Yandex", Kind: "GOAL_KIND_TOP_TIER_CO",
		TargetCompany: "Yandex", DefaultTargetDays: ptrInt(90), IsActive: true, SortOrder: 10,
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.Slug != "senior-yandex" || captured.TargetCompany != "Yandex" {
		t.Fatalf("payload not propagated: %+v", captured)
	}
}

func TestUpdateGoalPreset_RejectsNilID(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &UpdateGoalPreset{Repo: mocks.NewMockGoalPresetRepo(ctrl)}
	if _, err := uc.Do(context.Background(), uuid.Nil, domain.GoalPresetPatch{}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestUpdateGoalPreset_RejectsBlankTitle(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &UpdateGoalPreset{Repo: mocks.NewMockGoalPresetRepo(ctrl)}
	blank := "   "
	if _, err := uc.Do(context.Background(), uuid.New(), domain.GoalPresetPatch{Title: &blank}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestUpdateGoalPreset_AllowsClearDefaultTargetDays(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockGoalPresetRepo(ctrl)
	repo.EXPECT().Update(gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.GoalPreset{Slug: "x"}, nil)
	uc := &UpdateGoalPreset{Repo: repo}
	clear := -1
	if _, err := uc.Do(context.Background(), uuid.New(), domain.GoalPresetPatch{DefaultTargetDays: &clear}); err != nil {
		t.Fatalf("clear sentinel must be allowed, got %v", err)
	}
}

func TestDeactivateGoalPreset_RejectsNilID(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &DeactivateGoalPreset{Repo: mocks.NewMockGoalPresetRepo(ctrl)}
	if err := uc.Do(context.Background(), uuid.Nil); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestDeactivateGoalPreset_DelegatesToRepo(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	id := uuid.New()
	repo := mocks.NewMockGoalPresetRepo(ctrl)
	repo.EXPECT().Deactivate(gomock.Any(), id).Return(nil)
	uc := &DeactivateGoalPreset{Repo: repo}
	if err := uc.Do(context.Background(), id); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func ptrInt(v int) *int { return &v }
