//go:generate mockgen -package mocks -destination mocks/coach_prompts_mock.go -source coach_prompts.go

// coach_prompts.go — Admin Phase 2: coach prompt entity + repo port.
//
// Admin-curated LLM prompt templates. Stored in coach_prompts table;
// upstream services lookup by slug при первом обращении + слушают
// dynconfig change channel для hot-reload. Variables — массив документ-
// ированных placeholder'ов для UI hint'а; реальная подстановка делается
// Go templating layer'ом в caller'е, не здесь.
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// CoachPrompt mirrors a coach_prompts row.
type CoachPrompt struct {
	ID          uuid.UUID
	Slug        string
	Category    string
	Template    string
	Variables   []string
	Description string
	IsActive    bool
	Version     int
	CreatedBy   *uuid.UUID
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// CoachPromptUpsert — create payload.
type CoachPromptUpsert struct {
	Slug        string
	Category    string
	Template    string
	Variables   []string
	Description string
	IsActive    bool
	CreatedBy   *uuid.UUID
}

// CoachPromptPatch — partial update payload (pointer-fields).
type CoachPromptPatch struct {
	Category    *string
	Template    *string
	Variables   *[]string
	Description *string
	IsActive    *bool
}

// CoachPromptRepo — persistence port.
type CoachPromptRepo interface {
	List(ctx context.Context, activeOnly bool) ([]CoachPrompt, error)
	GetByID(ctx context.Context, id uuid.UUID) (CoachPrompt, error)
	Create(ctx context.Context, in CoachPromptUpsert) (CoachPrompt, error)
	Update(ctx context.Context, id uuid.UUID, in CoachPromptPatch) (CoachPrompt, error)
	Deactivate(ctx context.Context, id uuid.UUID) error
}
