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

func TestCreateABExperiment_RejectsBadWeightSum(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &CreateABExperiment{Repo: mocks.NewMockABExperimentRepo(ctrl)}
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
	ctrl := gomock.NewController(t)
	uc := &CreateABExperiment{Repo: mocks.NewMockABExperimentRepo(ctrl)}
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
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockABExperimentRepo(ctrl)
	var captured domain.ABExperimentUpsert
	repo.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, in domain.ABExperimentUpsert) (domain.ABExperiment, error) {
			captured = in
			return domain.ABExperiment{Slug: in.Slug, Status: domain.ABStatusDraft}, nil
		},
	)
	uc := &CreateABExperiment{Repo: repo}
	out, err := uc.Do(context.Background(), domain.ABExperimentUpsert{
		Slug: "x", Hypothesis: "test hypothesis", MetricSlug: "metric",
		Variants: []domain.ABVariant{{Name: "control", Weight: 50}, {Name: "v1", Weight: 50}},
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.Slug != "x" || captured.Status != domain.ABStatusDraft {
		t.Fatalf("status default not applied: %+v", captured)
	}
}

func TestSetABExperimentStatus_RejectsBadStatus(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &SetABExperimentStatus{Repo: mocks.NewMockABExperimentRepo(ctrl)}
	_, err := uc.Do(context.Background(), uuid.New(), "exploding")
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}
