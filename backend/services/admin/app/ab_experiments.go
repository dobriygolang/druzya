// ab_experiments.go — A/B experiment UCs (minimal scaffold).
//
// List + Create + SetStatus (pause/resume/complete). Assignment logic +
// stats aggregation live elsewhere.
//
// Validation:
//   - slug + hypothesis + metric_slug non-empty.
//   - variants: at least 2; weights non-negative integers summing 100.
//   - status — допустимое значение из ABStatus*.
package app

import (
	"context"
	"fmt"
	"strings"

	"druz9/admin/domain"

	"github.com/google/uuid"
)

var allowedABStatuses = map[string]struct{}{
	domain.ABStatusDraft:     {},
	domain.ABStatusRunning:   {},
	domain.ABStatusPaused:    {},
	domain.ABStatusCompleted: {},
}

// ─────────────────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────────────────

// ListABExperiments — read-only UC.
type ListABExperiments struct {
	Repo domain.ABExperimentRepo
}

// Do — full list ordered repo-side by created_at desc.
func (uc *ListABExperiments) Do(ctx context.Context) ([]domain.ABExperiment, error) {
	out, err := uc.Repo.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("admin.ListABExperiments: %w", err)
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────

// CreateABExperiment — admin-only.
type CreateABExperiment struct {
	Repo domain.ABExperimentRepo
}

// Do validates + persists.
func (uc *CreateABExperiment) Do(ctx context.Context, in domain.ABExperimentUpsert) (domain.ABExperiment, error) {
	if err := validateABUpsert(in); err != nil {
		return domain.ABExperiment{}, err
	}
	if in.Status == "" {
		in.Status = domain.ABStatusDraft
	}
	out, err := uc.Repo.Create(ctx, in)
	if err != nil {
		return domain.ABExperiment{}, fmt.Errorf("admin.CreateABExperiment: %w", err)
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// SetStatus
// ─────────────────────────────────────────────────────────────────────────

// SetABExperimentStatus — pause/resume/complete a running experiment.
type SetABExperimentStatus struct {
	Repo domain.ABExperimentRepo
}

// Do validates target status + persists.
func (uc *SetABExperimentStatus) Do(ctx context.Context, id uuid.UUID, status string) (domain.ABExperiment, error) {
	if id == uuid.Nil {
		return domain.ABExperiment{}, fmt.Errorf("%w: id required", domain.ErrInvalidInput)
	}
	if _, ok := allowedABStatuses[status]; !ok {
		return domain.ABExperiment{}, fmt.Errorf("%w: invalid status %q", domain.ErrInvalidInput, status)
	}
	out, err := uc.Repo.SetStatus(ctx, id, status)
	if err != nil {
		return domain.ABExperiment{}, fmt.Errorf("admin.SetABExperimentStatus: %w", err)
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────

func validateABUpsert(in domain.ABExperimentUpsert) error {
	if strings.TrimSpace(in.Slug) == "" {
		return fmt.Errorf("%w: slug required", domain.ErrInvalidInput)
	}
	if strings.TrimSpace(in.Hypothesis) == "" {
		return fmt.Errorf("%w: hypothesis required", domain.ErrInvalidInput)
	}
	if strings.TrimSpace(in.MetricSlug) == "" {
		return fmt.Errorf("%w: metric_slug required", domain.ErrInvalidInput)
	}
	if len(in.Variants) < 2 {
		return fmt.Errorf("%w: at least two variants required", domain.ErrInvalidInput)
	}
	total := 0
	for _, v := range in.Variants {
		if strings.TrimSpace(v.Name) == "" {
			return fmt.Errorf("%w: variant name required", domain.ErrInvalidInput)
		}
		if v.Weight < 0 {
			return fmt.Errorf("%w: variant weight must be non-negative", domain.ErrInvalidInput)
		}
		total += v.Weight
	}
	if total != 100 {
		return fmt.Errorf("%w: variant weights must sum to 100 (got %d)", domain.ErrInvalidInput, total)
	}
	if in.Status != "" {
		if _, ok := allowedABStatuses[in.Status]; !ok {
			return fmt.Errorf("%w: invalid status %q", domain.ErrInvalidInput, in.Status)
		}
	}
	return nil
}
