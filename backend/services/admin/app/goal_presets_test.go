package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/admin/domain"

	"github.com/google/uuid"
)

// fakeGoalPresetRepo — hand-rolled fake (no mockgen для маленького surface).
type fakeGoalPresetRepo struct {
	list         []domain.GoalPreset
	listErr      error
	listCalls    int
	lastActive   bool
	createIn     domain.GoalPresetUpsert
	createOut    domain.GoalPreset
	createErr    error
	updateID     uuid.UUID
	updatePatch  domain.GoalPresetPatch
	updateOut    domain.GoalPreset
	updateErr    error
	deactivateID uuid.UUID
	deactErr     error
}

func (f *fakeGoalPresetRepo) List(_ context.Context, activeOnly bool) ([]domain.GoalPreset, error) {
	f.listCalls++
	f.lastActive = activeOnly
	return f.list, f.listErr
}

func (f *fakeGoalPresetRepo) GetByID(_ context.Context, id uuid.UUID) (domain.GoalPreset, error) {
	for _, p := range f.list {
		if p.ID == id {
			return p, nil
		}
	}
	return domain.GoalPreset{}, domain.ErrNotFound
}

func (f *fakeGoalPresetRepo) GetBySlug(_ context.Context, slug string) (domain.GoalPreset, error) {
	for _, p := range f.list {
		if p.Slug == slug {
			return p, nil
		}
	}
	return domain.GoalPreset{}, domain.ErrNotFound
}

func (f *fakeGoalPresetRepo) Create(_ context.Context, in domain.GoalPresetUpsert) (domain.GoalPreset, error) {
	f.createIn = in
	if f.createErr != nil {
		return domain.GoalPreset{}, f.createErr
	}
	return f.createOut, nil
}

func (f *fakeGoalPresetRepo) Update(_ context.Context, id uuid.UUID, in domain.GoalPresetPatch) (domain.GoalPreset, error) {
	f.updateID = id
	f.updatePatch = in
	if f.updateErr != nil {
		return domain.GoalPreset{}, f.updateErr
	}
	return f.updateOut, nil
}

func (f *fakeGoalPresetRepo) Deactivate(_ context.Context, id uuid.UUID) error {
	f.deactivateID = id
	return f.deactErr
}

func TestListGoalPresets_PassesActiveFlag(t *testing.T) {
	t.Parallel()
	repo := &fakeGoalPresetRepo{list: []domain.GoalPreset{{Slug: "x"}}}
	uc := &ListGoalPresets{Repo: repo}
	out, err := uc.Do(context.Background(), true)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out) != 1 || !repo.lastActive {
		t.Fatalf("activeOnly not propagated; calls=%d active=%v", repo.listCalls, repo.lastActive)
	}
}

func TestCreateGoalPreset_Validates(t *testing.T) {
	t.Parallel()
	uc := &CreateGoalPreset{Repo: &fakeGoalPresetRepo{}}
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
	repo := &fakeGoalPresetRepo{
		createOut: domain.GoalPreset{
			ID:        uuid.New(),
			Slug:      "senior-yandex",
			Title:     "Senior Backend @ Yandex",
			Kind:      "GOAL_KIND_TOP_TIER_CO",
			IsActive:  true,
			CreatedAt: time.Now(),
		},
	}
	uc := &CreateGoalPreset{Repo: repo}
	out, err := uc.Do(context.Background(), domain.GoalPresetUpsert{
		Slug: "senior-yandex", Title: "Senior Backend @ Yandex", Kind: "GOAL_KIND_TOP_TIER_CO",
		TargetCompany: "Yandex", DefaultTargetDays: ptrInt(90), IsActive: true, SortOrder: 10,
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.Slug != "senior-yandex" || repo.createIn.TargetCompany != "Yandex" {
		t.Fatalf("payload not propagated: %+v", repo.createIn)
	}
}

func TestUpdateGoalPreset_RejectsNilID(t *testing.T) {
	t.Parallel()
	uc := &UpdateGoalPreset{Repo: &fakeGoalPresetRepo{}}
	if _, err := uc.Do(context.Background(), uuid.Nil, domain.GoalPresetPatch{}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestUpdateGoalPreset_RejectsBlankTitle(t *testing.T) {
	t.Parallel()
	uc := &UpdateGoalPreset{Repo: &fakeGoalPresetRepo{}}
	blank := "   "
	if _, err := uc.Do(context.Background(), uuid.New(), domain.GoalPresetPatch{Title: &blank}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestUpdateGoalPreset_AllowsClearDefaultTargetDays(t *testing.T) {
	t.Parallel()
	repo := &fakeGoalPresetRepo{updateOut: domain.GoalPreset{Slug: "x"}}
	uc := &UpdateGoalPreset{Repo: repo}
	clear := -1
	if _, err := uc.Do(context.Background(), uuid.New(), domain.GoalPresetPatch{DefaultTargetDays: &clear}); err != nil {
		t.Fatalf("clear sentinel must be allowed, got %v", err)
	}
}

func TestDeactivateGoalPreset_RejectsNilID(t *testing.T) {
	t.Parallel()
	uc := &DeactivateGoalPreset{Repo: &fakeGoalPresetRepo{}}
	if err := uc.Do(context.Background(), uuid.Nil); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestDeactivateGoalPreset_DelegatesToRepo(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	repo := &fakeGoalPresetRepo{}
	uc := &DeactivateGoalPreset{Repo: repo}
	if err := uc.Do(context.Background(), id); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if repo.deactivateID != id {
		t.Fatalf("repo.Deactivate not called with id; got %v", repo.deactivateID)
	}
}

func ptrInt(v int) *int { return &v }
