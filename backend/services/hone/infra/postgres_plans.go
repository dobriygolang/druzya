// Plans repository — split out of postgres.go.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/hone/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Plans implements domain.PlanRepo.
type Plans struct {
	pool *pgxpool.Pool
}

// NewPlans wraps a pool.
func NewPlans(pool *pgxpool.Pool) *Plans { return &Plans{pool: pool} }

// GetForDate returns the plan for (user, date) — ErrNotFound if none.
func (p *Plans) GetForDate(ctx context.Context, userID uuid.UUID, date time.Time) (domain.Plan, error) {
	var (
		id            pgtype.UUID
		itemsJSON     []byte
		regeneratedAt time.Time
		createdAt     time.Time
		updatedAt     time.Time
	)
	err := p.pool.QueryRow(ctx,
		`SELECT id, items, regenerated_at, created_at, updated_at
		   FROM hone_daily_plans
		  WHERE user_id=$1 AND plan_date=$2`,
		sharedpg.UUID(userID), pgtype.Date{Time: date, Valid: true},
	).Scan(&id, &itemsJSON, &regeneratedAt, &createdAt, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Plan{}, domain.ErrNotFound
		}
		return domain.Plan{}, fmt.Errorf("hone.Plans.GetForDate: %w", err)
	}
	items, err := unmarshalPlanItems(itemsJSON)
	if err != nil {
		return domain.Plan{}, fmt.Errorf("hone.Plans.GetForDate: items: %w", err)
	}
	return domain.Plan{
		ID:            sharedpg.UUIDFrom(id),
		UserID:        userID,
		Date:          date,
		Items:         items,
		RegeneratedAt: regeneratedAt,
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
	}, nil
}

// Upsert replaces the plan for (user, date).
func (p *Plans) Upsert(ctx context.Context, pl domain.Plan) (domain.Plan, error) {
	itemsJSON, err := json.Marshal(pl.Items)
	if err != nil {
		return domain.Plan{}, fmt.Errorf("hone.Plans.Upsert: marshal: %w", err)
	}
	var (
		id        pgtype.UUID
		createdAt time.Time
		updatedAt time.Time
	)
	err = p.pool.QueryRow(ctx,
		`INSERT INTO hone_daily_plans (user_id, plan_date, items, regenerated_at)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id, plan_date) DO UPDATE
		   SET items = EXCLUDED.items,
		       regenerated_at = EXCLUDED.regenerated_at,
		       updated_at = now()
		 RETURNING id, created_at, updated_at`,
		sharedpg.UUID(pl.UserID),
		pgtype.Date{Time: pl.Date, Valid: true},
		itemsJSON,
		pl.RegeneratedAt,
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		return domain.Plan{}, fmt.Errorf("hone.Plans.Upsert: %w", err)
	}
	pl.ID = sharedpg.UUIDFrom(id)
	pl.CreatedAt = createdAt
	pl.UpdatedAt = updatedAt
	return pl, nil
}

// PatchItem updates a single item's flags in place. We read → mutate → write
// for MVP simplicity; future rev can push a jsonb_set() query for atomicity
// if concurrent clicks become a real issue (unlikely — one user, one desktop).
func (p *Plans) PatchItem(ctx context.Context, userID uuid.UUID, date time.Time, itemID string, dismissed, completed bool) (domain.Plan, error) {
	pl, err := p.GetForDate(ctx, userID, date)
	if err != nil {
		return domain.Plan{}, fmt.Errorf("hone.Plans.PatchItem: %w", err)
	}
	found := false
	for i := range pl.Items {
		if pl.Items[i].ID == itemID {
			pl.Items[i].Dismissed = dismissed
			pl.Items[i].Completed = completed
			found = true
			break
		}
	}
	if !found {
		return domain.Plan{}, fmt.Errorf("hone.Plans.PatchItem: %w", domain.ErrNotFound)
	}
	return p.Upsert(ctx, pl)
}

func unmarshalPlanItems(raw []byte) ([]domain.PlanItem, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var out []domain.PlanItem
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("unmarshal plan items: %w", err)
	}
	return out, nil
}
