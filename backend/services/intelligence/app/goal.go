// goal.go — F2 primary goal CRUD use cases.
//
// Four UCs (CreateGoal / GetActiveGoal / UpdateGoal / DeactivateGoal)
// над PrimaryGoalRepo. Single-active invariant enforced at DB layer
// (partial unique index); UCs валидируют kind + per-kind requirements
// до repo call.
package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// ─── CreateGoal ───────────────────────────────────────────────────────────

// CreateGoal UC.
type CreateGoal struct {
	Repo domain.PrimaryGoalRepo
	Now  func() time.Time
}

// CreateGoalInput — params.
type CreateGoalInput struct {
	UserID        uuid.UUID
	Kind          domain.PrimaryGoalKind
	TargetCompany string
	TargetLevel   string
	TargetText    string
	// TargetDate — ISO yyyy-mm-dd; "" допустимо (skill-only / english goals
	// часто без жёсткой даты).
	TargetDate string
}

// Do создаёт active goal. Repo деактивирует предыдущий active goal
// атомарно (partial unique index gate).
func (uc *CreateGoal) Do(ctx context.Context, in CreateGoalInput) (domain.PrimaryGoal, error) {
	if in.UserID == uuid.Nil {
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.CreateGoal: %w: zero user_id", domain.ErrInvalidInput)
	}
	if !in.Kind.IsValid() {
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.CreateGoal: %w: invalid kind %q", domain.ErrInvalidInput, in.Kind)
	}
	if err := validateKindFields(in.Kind, in.TargetCompany, in.TargetText); err != nil {
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.CreateGoal: %w", err)
	}
	date, err := parseTargetDate(in.TargetDate)
	if err != nil {
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.CreateGoal: %w", err)
	}
	now := uc.now()
	goal := domain.PrimaryGoal{
		UserID:        in.UserID,
		Kind:          in.Kind,
		TargetCompany: strings.TrimSpace(in.TargetCompany),
		TargetLevel:   strings.TrimSpace(in.TargetLevel),
		TargetText:    strings.TrimSpace(in.TargetText),
		TargetDate:    date,
		Active:        true,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	saved, err := uc.Repo.Insert(ctx, goal)
	if err != nil {
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.CreateGoal insert: %w", err)
	}
	return saved, nil
}

// ─── GetActiveGoal ────────────────────────────────────────────────────────

// GetActiveGoal UC. Returns domain.ErrNotFound if none active.
type GetActiveGoal struct {
	Repo domain.PrimaryGoalRepo
}

// Do reads active goal.
func (uc *GetActiveGoal) Do(ctx context.Context, userID uuid.UUID) (domain.PrimaryGoal, error) {
	if userID == uuid.Nil {
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.GetActiveGoal: %w: zero user_id", domain.ErrInvalidInput)
	}
	g, err := uc.Repo.GetActive(ctx, userID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return domain.PrimaryGoal{}, err
		}
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.GetActiveGoal: %w", err)
	}
	return g, nil
}

// ─── UpdateGoal ───────────────────────────────────────────────────────────

// UpdateGoal UC. Caller-supplied id MUST be owned by UserID — repo
// enforces and returns ErrNotFound on mismatch.
type UpdateGoal struct {
	Repo domain.PrimaryGoalRepo
	Now  func() time.Time
	// Milestones optional — invalidate cache when goal mutates (existing
	// roadmap becomes stale). nil-safe.
	Milestones domain.MilestoneRepo
}

// UpdateGoalInput — params.
type UpdateGoalInput struct {
	UserID        uuid.UUID
	GoalID        uuid.UUID
	Kind          domain.PrimaryGoalKind
	TargetCompany string
	TargetLevel   string
	TargetText    string
	TargetDate    string
}

// Do updates an existing goal. active flag is preserved (use
// DeactivateGoal to flip it).
func (uc *UpdateGoal) Do(ctx context.Context, in UpdateGoalInput) (domain.PrimaryGoal, error) {
	if in.UserID == uuid.Nil {
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.UpdateGoal: %w: zero user_id", domain.ErrInvalidInput)
	}
	if in.GoalID == uuid.Nil {
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.UpdateGoal: %w: zero goal_id", domain.ErrInvalidInput)
	}
	if !in.Kind.IsValid() {
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.UpdateGoal: %w: invalid kind %q", domain.ErrInvalidInput, in.Kind)
	}
	if err := validateKindFields(in.Kind, in.TargetCompany, in.TargetText); err != nil {
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.UpdateGoal: %w", err)
	}
	date, err := parseTargetDate(in.TargetDate)
	if err != nil {
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.UpdateGoal: %w", err)
	}
	goal := domain.PrimaryGoal{
		ID:            in.GoalID,
		UserID:        in.UserID,
		Kind:          in.Kind,
		TargetCompany: strings.TrimSpace(in.TargetCompany),
		TargetLevel:   strings.TrimSpace(in.TargetLevel),
		TargetText:    strings.TrimSpace(in.TargetText),
		TargetDate:    date,
		UpdatedAt:     uc.now(),
	}
	saved, err := uc.Repo.UpdateByID(ctx, goal)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return domain.PrimaryGoal{}, err
		}
		return domain.PrimaryGoal{}, fmt.Errorf("intelligence.UpdateGoal update: %w", err)
	}
	// F2 cache invalidation: any goal mutation invalidates roadmap. Юзер
	// regenerates milestones via UI (GenerateMilestones UC). Best-effort.
	if uc.Milestones != nil {
		_, _ = uc.Milestones.Replace(ctx, in.UserID, in.GoalID, nil)
	}
	return saved, nil
}

// ─── DeactivateGoal ───────────────────────────────────────────────────────

// DeactivateGoal UC. Sets active=false. ErrNotFound if no row matches
// (id, user_id).
type DeactivateGoal struct {
	Repo      domain.PrimaryGoalRepo
	// Milestones optional — invalidate cache on goal deactivation. nil-safe.
	Milestones domain.MilestoneRepo
}

// Do deactivates a goal.
func (uc *DeactivateGoal) Do(ctx context.Context, userID, goalID uuid.UUID) error {
	if userID == uuid.Nil {
		return fmt.Errorf("intelligence.DeactivateGoal: %w: zero user_id", domain.ErrInvalidInput)
	}
	if goalID == uuid.Nil {
		return fmt.Errorf("intelligence.DeactivateGoal: %w: zero goal_id", domain.ErrInvalidInput)
	}
	if err := uc.Repo.DeactivateByID(ctx, userID, goalID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return err
		}
		return fmt.Errorf("intelligence.DeactivateGoal: %w", err)
	}
	// F2 cache invalidation: deactivated goal → no longer has valid roadmap.
	// Best-effort: failure не блокирует deactivate (юзер всё равно видит
	// stale milestones до next regen).
	if uc.Milestones != nil {
		_, _ = uc.Milestones.Replace(ctx, userID, goalID, nil)
	}
	return nil
}

// ─── helpers ──────────────────────────────────────────────────────────────

func (uc *CreateGoal) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now().UTC()
}

func (uc *UpdateGoal) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now().UTC()
}

// validateKindFields enforces per-kind requirements mirroring frontend
// wizard:
//   - top_tier_co: target_company required (one of the whitelisted top-tier
//     companies; backend doesn't enforce whitelist — wizard does)
//   - custom: target_text required (LLM parses later)
//   - any_senior / ml_offer / english_target: no extra required field
func validateKindFields(kind domain.PrimaryGoalKind, company, text string) error {
	switch kind {
	case domain.PrimaryGoalKindTopTierCo:
		if strings.TrimSpace(company) == "" {
			return fmt.Errorf("%w: target_company required for kind=top_tier_co", domain.ErrInvalidInput)
		}
	case domain.PrimaryGoalKindCustom:
		if strings.TrimSpace(text) == "" {
			return fmt.Errorf("%w: target_text required for kind=custom", domain.ErrInvalidInput)
		}
	}
	return nil
}

// parseTargetDate parses ISO yyyy-mm-dd. Returns nil for "" (allowed).
func parseTargetDate(s string) (*time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil, fmt.Errorf("%w: bad target_date %q (need yyyy-mm-dd)", domain.ErrInvalidInput, s)
	}
	return &t, nil
}
