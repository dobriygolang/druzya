//go:generate mockgen -package mocks -destination mocks/goal_preset_mock.go -source goal_preset.go

// goal_preset.go — GoalPreset entity + repo port.
//
// Admin-curated quick-start goals for GoalWizardModal. Lives entirely в
// admin/ bounded context — frontend GoalWizard читает через public REST
// (active only), admin CMS делает CRUD через role-gated REST.
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// GoalPreset mirrors a goal_presets row.
type GoalPreset struct {
	ID                uuid.UUID
	Slug              string
	Title             string
	Kind              string // mirrors primary_goal_kind enum string (e.g. "GOAL_KIND_TOP_TIER_CO")
	TargetCompany     string
	TargetLevel       string
	TargetText        string
	DefaultTargetDays *int // optional — NULL = no default date
	IsActive          bool
	SortOrder         int
	CreatedBy         *uuid.UUID
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// GoalPresetUpsert — curator input. ID + timestamps set by repo.
type GoalPresetUpsert struct {
	Slug              string
	Title             string
	Kind              string
	TargetCompany     string
	TargetLevel       string
	TargetText        string
	DefaultTargetDays *int
	IsActive          bool
	SortOrder         int
	CreatedBy         *uuid.UUID
}

// GoalPresetPatch — partial update payload. Pointer-fields are "absent →
// keep current; present → overwrite".
type GoalPresetPatch struct {
	Title             *string
	Kind              *string
	TargetCompany     *string
	TargetLevel       *string
	TargetText        *string
	DefaultTargetDays *int  // nil-pointer means "skip"; -1 sentinel means "clear to NULL"
	IsActive          *bool
	SortOrder         *int
}

// GoalPresetRepo — persistence port. Impl in admin/infra.
type GoalPresetRepo interface {
	List(ctx context.Context, activeOnly bool) ([]GoalPreset, error)
	GetByID(ctx context.Context, id uuid.UUID) (GoalPreset, error)
	GetBySlug(ctx context.Context, slug string) (GoalPreset, error)
	Create(ctx context.Context, in GoalPresetUpsert) (GoalPreset, error)
	Update(ctx context.Context, id uuid.UUID, in GoalPresetPatch) (GoalPreset, error)
	Deactivate(ctx context.Context, id uuid.UUID) error
}
