// primary_goal.go — F2 single-active "primary goal" type.
//
// Distinct from UserGoal (job_target/skill_target/track_target workflow):
// PrimaryGoal — 5-kind enum mirroring frontend localStorage MVP
// (frontend/src/lib/goal.ts) — top_tier_co / any_senior / ml_offer /
// english_target / custom. One active goal per user (DB partial unique index).
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// PrimaryGoalKind mirrors the user_primary_goals.kind SQL enum
// (migration 00086). Stable string values — wire-safe.
type PrimaryGoalKind string

const (
	PrimaryGoalKindTopTierCo     PrimaryGoalKind = "top_tier_co"
	PrimaryGoalKindAnySenior     PrimaryGoalKind = "any_senior"
	PrimaryGoalKindMLOffer       PrimaryGoalKind = "ml_offer"
	PrimaryGoalKindEnglishTarget PrimaryGoalKind = "english_target"
	PrimaryGoalKindCustom        PrimaryGoalKind = "custom"
)

// IsValid returns true for known kinds.
func (k PrimaryGoalKind) IsValid() bool {
	switch k {
	case PrimaryGoalKindTopTierCo, PrimaryGoalKindAnySenior, PrimaryGoalKindMLOffer,
		PrimaryGoalKindEnglishTarget, PrimaryGoalKindCustom:
		return true
	}
	return false
}

// PrimaryGoal — projection over user_primary_goals row.
//
// TargetDate format: "" если не задано; иначе ISO yyyy-mm-dd. Хранится как
// DATE в БД; UC переводит к/из *time.Time для repo.
type PrimaryGoal struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	Kind          PrimaryGoalKind
	TargetCompany string
	TargetLevel   string
	TargetText    string
	TargetDate    *time.Time
	Active        bool
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// PrimaryGoalRepo — write-side для user_primary_goals.
//
// Insert: ставит active=TRUE атомарно деактивируя предыдущий active goal
// этого user'а (DB partial unique index гарантирует ровно один active).
// GetActive: ErrNotFound если active row отсутствует.
// UpdateByID + DeactivateByID: scoped to (id, user_id) — отказ если
// goal принадлежит другому юзеру (ErrNotFound).
type PrimaryGoalRepo interface {
	Insert(ctx context.Context, in PrimaryGoal) (PrimaryGoal, error)
	GetActive(ctx context.Context, userID uuid.UUID) (PrimaryGoal, error)
	UpdateByID(ctx context.Context, in PrimaryGoal) (PrimaryGoal, error)
	DeactivateByID(ctx context.Context, userID, goalID uuid.UUID) error
}
