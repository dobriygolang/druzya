package app

import (
	"context"
	"fmt"
	"strings"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// ── Task questions ──────────────────────────────────────────────────────

func (h *Handlers) ListTaskQuestions(ctx context.Context, taskID uuid.UUID) ([]domain.TaskQuestion, error) {
	out, err := h.Questions.ListTaskQuestions(ctx, taskID)
	if err != nil {
		return nil, fmt.Errorf("questions.ListTaskQuestions: %w", err)
	}
	return out, nil
}

func (h *Handlers) CreateTaskQuestion(ctx context.Context, q domain.TaskQuestion) (domain.TaskQuestion, error) {
	q.Body = strings.TrimSpace(q.Body)
	if q.TaskID == uuid.Nil || q.Body == "" {
		return domain.TaskQuestion{}, fmt.Errorf("task_id/body required: %w", domain.ErrValidation)
	}
	validateReferenceCriteria(&q.ReferenceCriteria)
	if q.ID == uuid.Nil {
		q.ID = uuid.New()
	}
	q.CreatedAt = h.Now().UTC()
	out, err := h.Questions.CreateTaskQuestion(ctx, q)
	if err != nil {
		return domain.TaskQuestion{}, fmt.Errorf("questions.CreateTaskQuestion: %w", err)
	}
	return out, nil
}

func (h *Handlers) UpdateTaskQuestion(ctx context.Context, q domain.TaskQuestion) (domain.TaskQuestion, error) {
	if q.ID == uuid.Nil {
		return domain.TaskQuestion{}, fmt.Errorf("id required: %w", domain.ErrValidation)
	}
	validateReferenceCriteria(&q.ReferenceCriteria)
	out, err := h.Questions.UpdateTaskQuestion(ctx, q)
	if err != nil {
		return domain.TaskQuestion{}, fmt.Errorf("questions.UpdateTaskQuestion: %w", err)
	}
	return out, nil
}

func (h *Handlers) DeleteTaskQuestion(ctx context.Context, id uuid.UUID) error {
	if err := h.Questions.DeleteTaskQuestion(ctx, id); err != nil {
		return fmt.Errorf("questions.DeleteTaskQuestion: %w", err)
	}
	return nil
}

// ── Default questions (HR / behavioral global pool) ─────────────────────

func (h *Handlers) ListDefaultQuestions(ctx context.Context, stage domain.StageKind, onlyActive bool) ([]domain.DefaultQuestion, error) {
	if stage != "" && !stage.Valid() {
		return nil, fmt.Errorf("stage_kind invalid: %w", domain.ErrValidation)
	}
	out, err := h.Questions.ListDefaultQuestions(ctx, stage, onlyActive)
	if err != nil {
		return nil, fmt.Errorf("questions.ListDefaultQuestions: %w", err)
	}
	return out, nil
}

func (h *Handlers) CreateDefaultQuestion(ctx context.Context, q domain.DefaultQuestion) (domain.DefaultQuestion, error) {
	q.Body = strings.TrimSpace(q.Body)
	if !q.StageKind.Valid() || q.Body == "" {
		return domain.DefaultQuestion{}, fmt.Errorf("stage_kind/body required: %w", domain.ErrValidation)
	}
	validateReferenceCriteria(&q.ReferenceCriteria)
	if q.ID == uuid.Nil {
		q.ID = uuid.New()
	}
	q.CreatedAt = h.Now().UTC()
	out, err := h.Questions.CreateDefaultQuestion(ctx, q)
	if err != nil {
		return domain.DefaultQuestion{}, fmt.Errorf("questions.CreateDefaultQuestion: %w", err)
	}
	return out, nil
}

func (h *Handlers) UpdateDefaultQuestion(ctx context.Context, q domain.DefaultQuestion) (domain.DefaultQuestion, error) {
	if q.ID == uuid.Nil {
		return domain.DefaultQuestion{}, fmt.Errorf("id required: %w", domain.ErrValidation)
	}
	validateReferenceCriteria(&q.ReferenceCriteria)
	out, err := h.Questions.UpdateDefaultQuestion(ctx, q)
	if err != nil {
		return domain.DefaultQuestion{}, fmt.Errorf("questions.UpdateDefaultQuestion: %w", err)
	}
	return out, nil
}

func (h *Handlers) DeleteDefaultQuestion(ctx context.Context, id uuid.UUID) error {
	if err := h.Questions.DeleteDefaultQuestion(ctx, id); err != nil {
		return fmt.Errorf("questions.DeleteDefaultQuestion: %w", err)
	}
	return nil
}

// ── Company questions ───────────────────────────────────────────────────

func (h *Handlers) ListCompanyQuestions(ctx context.Context, companyID uuid.UUID, stage domain.StageKind) ([]domain.CompanyQuestion, error) {
	if stage != "" && !stage.Valid() {
		return nil, fmt.Errorf("stage_kind invalid: %w", domain.ErrValidation)
	}
	out, err := h.Questions.ListCompanyQuestions(ctx, companyID, stage)
	if err != nil {
		return nil, fmt.Errorf("questions.ListCompanyQuestions: %w", err)
	}
	return out, nil
}

func (h *Handlers) CreateCompanyQuestion(ctx context.Context, q domain.CompanyQuestion) (domain.CompanyQuestion, error) {
	q.Body = strings.TrimSpace(q.Body)
	if q.CompanyID == uuid.Nil || !q.StageKind.Valid() || q.Body == "" {
		return domain.CompanyQuestion{}, fmt.Errorf("company_id/stage_kind/body required: %w", domain.ErrValidation)
	}
	validateReferenceCriteria(&q.ReferenceCriteria)
	if q.ID == uuid.Nil {
		q.ID = uuid.New()
	}
	q.CreatedAt = h.Now().UTC()
	out, err := h.Questions.CreateCompanyQuestion(ctx, q)
	if err != nil {
		return domain.CompanyQuestion{}, fmt.Errorf("questions.CreateCompanyQuestion: %w", err)
	}
	return out, nil
}

func (h *Handlers) UpdateCompanyQuestion(ctx context.Context, q domain.CompanyQuestion) (domain.CompanyQuestion, error) {
	if q.ID == uuid.Nil {
		return domain.CompanyQuestion{}, fmt.Errorf("id required: %w", domain.ErrValidation)
	}
	validateReferenceCriteria(&q.ReferenceCriteria)
	out, err := h.Questions.UpdateCompanyQuestion(ctx, q)
	if err != nil {
		return domain.CompanyQuestion{}, fmt.Errorf("questions.UpdateCompanyQuestion: %w", err)
	}
	return out, nil
}

func (h *Handlers) DeleteCompanyQuestion(ctx context.Context, id uuid.UUID) error {
	if err := h.Questions.DeleteCompanyQuestion(ctx, id); err != nil {
		return fmt.Errorf("questions.DeleteCompanyQuestion: %w", err)
	}
	return nil
}
