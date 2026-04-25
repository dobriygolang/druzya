// Package app — use cases for the mock interview admin surface.
//
// Handlers struct is the single seam between ports/ and infra/. Phase A
// covers admin CRUD plus the create-pipeline stub used by the /mock picker.
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// Handlers bundles every repo + a clock so use cases stay pure.
type Handlers struct {
	Companies      domain.CompanyRepo
	Strictness     domain.StrictnessRepo
	Tasks          domain.TaskRepo
	Questions      domain.QuestionRepo
	CompanyStages  domain.CompanyStageRepo
	Pipelines      domain.PipelineRepo
	PipelineStages domain.PipelineStageRepo
	Attempts       domain.PipelineAttemptRepo
	Leaderboard    domain.LeaderboardRepo
	TestCases      domain.MockTaskTestCaseRepo
	Now            func() time.Time
}

func NewHandlers(
	companies domain.CompanyRepo,
	strictness domain.StrictnessRepo,
	tasks domain.TaskRepo,
	questions domain.QuestionRepo,
	companyStages domain.CompanyStageRepo,
	pipelines domain.PipelineRepo,
	pipelineStages domain.PipelineStageRepo,
	attempts domain.PipelineAttemptRepo,
	leaderboard domain.LeaderboardRepo,
	testCases domain.MockTaskTestCaseRepo,
) *Handlers {
	return &Handlers{
		Companies: companies, Strictness: strictness, Tasks: tasks,
		Questions: questions, CompanyStages: companyStages,
		Pipelines: pipelines, PipelineStages: pipelineStages, Attempts: attempts,
		Leaderboard: leaderboard,
		TestCases:   testCases,
		Now:         time.Now,
	}
}

func (h *Handlers) ListCompanies(ctx context.Context, onlyActive bool) ([]domain.Company, error) {
	out, err := h.Companies.List(ctx, onlyActive)
	if err != nil {
		return nil, fmt.Errorf("companies.List: %w", err)
	}
	return out, nil
}

func (h *Handlers) GetCompany(ctx context.Context, id uuid.UUID) (domain.Company, error) {
	c, err := h.Companies.Get(ctx, id)
	if err != nil {
		return domain.Company{}, fmt.Errorf("companies.Get: %w", err)
	}
	return c, nil
}

// CreateCompany inserts a new row. Slug must be unique; bubble up
// ErrConflict on duplicate.
func (h *Handlers) CreateCompany(ctx context.Context, c domain.Company) (domain.Company, error) {
	c.Slug = strings.TrimSpace(c.Slug)
	c.Name = strings.TrimSpace(c.Name)
	if c.Slug == "" || c.Name == "" {
		return domain.Company{}, fmt.Errorf("slug/name required: %w", domain.ErrValidation)
	}
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	now := h.Now().UTC()
	c.CreatedAt = now
	c.UpdatedAt = now
	if c.Difficulty == "" {
		c.Difficulty = "normal"
	}
	if c.Sections == nil {
		c.Sections = []string{}
	}
	out, err := h.Companies.Create(ctx, c)
	if err != nil {
		return domain.Company{}, fmt.Errorf("companies.Create: %w", err)
	}
	return out, nil
}

func (h *Handlers) UpdateCompany(ctx context.Context, c domain.Company) (domain.Company, error) {
	if c.ID == uuid.Nil {
		return domain.Company{}, fmt.Errorf("id required: %w", domain.ErrValidation)
	}
	c.UpdatedAt = h.Now().UTC()
	out, err := h.Companies.Update(ctx, c)
	if err != nil {
		return domain.Company{}, fmt.Errorf("companies.Update: %w", err)
	}
	return out, nil
}

func (h *Handlers) SetCompanyActive(ctx context.Context, id uuid.UUID, active bool) error {
	if err := h.Companies.SetActive(ctx, id, active); err != nil {
		return fmt.Errorf("companies.SetActive: %w", err)
	}
	return nil
}
