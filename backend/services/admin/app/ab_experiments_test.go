package app

import (
	"context"
	"errors"
	"testing"

	"druz9/admin/domain"

	"github.com/google/uuid"
)

type fakeABRepo struct {
	list      []domain.ABExperiment
	createIn  domain.ABExperimentUpsert
	createOut domain.ABExperiment
	statusID  uuid.UUID
	statusOut domain.ABExperiment
	listErr   error
	createErr error
	statusErr error
}

func (f *fakeABRepo) List(_ context.Context) ([]domain.ABExperiment, error) {
	return f.list, f.listErr
}
func (f *fakeABRepo) GetByID(_ context.Context, _ uuid.UUID) (domain.ABExperiment, error) {
	return domain.ABExperiment{}, domain.ErrNotFound
}
func (f *fakeABRepo) Create(_ context.Context, in domain.ABExperimentUpsert) (domain.ABExperiment, error) {
	f.createIn = in
	return f.createOut, f.createErr
}
func (f *fakeABRepo) SetStatus(_ context.Context, id uuid.UUID, _ string) (domain.ABExperiment, error) {
	f.statusID = id
	return f.statusOut, f.statusErr
}

func TestCreateABExperiment_RejectsBadWeightSum(t *testing.T) {
	t.Parallel()
	uc := &CreateABExperiment{Repo: &fakeABRepo{}}
	_, err := uc.Do(context.Background(), domain.ABExperimentUpsert{
		Slug: "x", Hypothesis: "h", MetricSlug: "m",
		Variants: []domain.ABVariant{{Name: "a", Weight: 30}, {Name: "b", Weight: 30}},
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCreateABExperiment_RejectsSingleVariant(t *testing.T) {
	t.Parallel()
	uc := &CreateABExperiment{Repo: &fakeABRepo{}}
	_, err := uc.Do(context.Background(), domain.ABExperimentUpsert{
		Slug: "x", Hypothesis: "h", MetricSlug: "m",
		Variants: []domain.ABVariant{{Name: "a", Weight: 100}},
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCreateABExperiment_Success(t *testing.T) {
	t.Parallel()
	repo := &fakeABRepo{createOut: domain.ABExperiment{Slug: "x", Status: domain.ABStatusDraft}}
	uc := &CreateABExperiment{Repo: repo}
	out, err := uc.Do(context.Background(), domain.ABExperimentUpsert{
		Slug: "x", Hypothesis: "test hypothesis", MetricSlug: "metric",
		Variants: []domain.ABVariant{{Name: "control", Weight: 50}, {Name: "v1", Weight: 50}},
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.Slug != "x" || repo.createIn.Status != domain.ABStatusDraft {
		t.Fatalf("status default not applied: %+v", repo.createIn)
	}
}

func TestSetABExperimentStatus_RejectsBadStatus(t *testing.T) {
	t.Parallel()
	uc := &SetABExperimentStatus{Repo: &fakeABRepo{}}
	_, err := uc.Do(context.Background(), uuid.New(), "exploding")
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}
