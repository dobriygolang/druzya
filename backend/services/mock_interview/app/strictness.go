package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
)

func (h *Handlers) ListStrictness(ctx context.Context, onlyActive bool) ([]domain.AIStrictnessProfile, error) {
	out, err := h.Strictness.List(ctx, onlyActive)
	if err != nil {
		return nil, fmt.Errorf("strictness.List: %w", err)
	}
	return out, nil
}

func (h *Handlers) GetStrictness(ctx context.Context, id uuid.UUID) (domain.AIStrictnessProfile, error) {
	p, err := h.Strictness.Get(ctx, id)
	if err != nil {
		return domain.AIStrictnessProfile{}, fmt.Errorf("strictness.Get: %w", err)
	}
	return p, nil
}

func (h *Handlers) CreateStrictness(ctx context.Context, p domain.AIStrictnessProfile) (domain.AIStrictnessProfile, error) {
	p.Slug = strings.TrimSpace(p.Slug)
	p.Name = strings.TrimSpace(p.Name)
	if p.Slug == "" || p.Name == "" {
		return domain.AIStrictnessProfile{}, fmt.Errorf("slug/name required: %w", domain.ErrValidation)
	}
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	now := h.Now().UTC()
	p.CreatedAt = now
	p.UpdatedAt = now
	out, err := h.Strictness.Create(ctx, p)
	if err != nil {
		return domain.AIStrictnessProfile{}, fmt.Errorf("strictness.Create: %w", err)
	}
	return out, nil
}

func (h *Handlers) UpdateStrictness(ctx context.Context, p domain.AIStrictnessProfile) (domain.AIStrictnessProfile, error) {
	if p.ID == uuid.Nil {
		return domain.AIStrictnessProfile{}, fmt.Errorf("id required: %w", domain.ErrValidation)
	}
	p.UpdatedAt = h.Now().UTC()
	out, err := h.Strictness.Update(ctx, p)
	if err != nil {
		return domain.AIStrictnessProfile{}, fmt.Errorf("strictness.Update: %w", err)
	}
	return out, nil
}

func (h *Handlers) SetStrictnessActive(ctx context.Context, id uuid.UUID, active bool) error {
	if err := h.Strictness.SetActive(ctx, id, active); err != nil {
		return fmt.Errorf("strictness.SetActive: %w", err)
	}
	return nil
}

// ResolveStrictness walks the cascade task → company_stage → global default.
// Returns the resolved profile or ErrNotFound if even 'default' is missing.
//
// Used by the orchestrator (Phase B) when snapshotting strictness onto a
// pipeline_stage row at start time so admin tweaks don't retroactively
// rescore old pipelines.
func (h *Handlers) ResolveStrictness(ctx context.Context, taskID uuid.UUID, companyID *uuid.UUID, stage domain.StageKind) (domain.AIStrictnessProfile, error) {
	// 1. task override
	if taskID != uuid.Nil {
		t, err := h.Tasks.Get(ctx, taskID)
		if err != nil && !errors.Is(err, domain.ErrNotFound) {
			return domain.AIStrictnessProfile{}, fmt.Errorf("strictness.resolve tasks.Get: %w", err)
		}
		if err == nil && t.AIStrictnessProfileID != nil {
			p, gerr := h.Strictness.Get(ctx, *t.AIStrictnessProfileID)
			if gerr != nil {
				return domain.AIStrictnessProfile{}, fmt.Errorf("strictness.resolve task profile: %w", gerr)
			}
			return p, nil
		}
	}
	// 2. company_stage override
	if companyID != nil && *companyID != uuid.Nil {
		stages, err := h.CompanyStages.GetForCompany(ctx, *companyID)
		if err != nil {
			return domain.AIStrictnessProfile{}, fmt.Errorf("strictness.resolve companyStages: %w", err)
		}
		for _, s := range stages {
			if s.StageKind == stage && s.AIStrictnessProfileID != nil {
				p, gerr := h.Strictness.Get(ctx, *s.AIStrictnessProfileID)
				if gerr != nil {
					return domain.AIStrictnessProfile{}, fmt.Errorf("strictness.resolve stage profile: %w", gerr)
				}
				return p, nil
			}
		}
	}
	// 3. global default
	def, err := h.Strictness.GetBySlug(ctx, "default")
	if err != nil {
		return domain.AIStrictnessProfile{}, fmt.Errorf("strictness.resolve default: %w", err)
	}
	return def, nil
}
