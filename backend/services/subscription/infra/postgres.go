// Package infra — Postgres адаптер для subscription-сервиса.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/shared/enums"
	sharedpg "druz9/shared/pkg/pg"
	"druz9/subscription/domain"
	subdb "druz9/subscription/infra/db"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres реализует domain.Repo. Ничего не знает о HTTP/Connect-слое —
// только sqlc + pgx.
type Postgres struct {
	pool *pgxpool.Pool
	q    *subdb.Queries
}

// NewPostgres — конструктор поверх shared pgxpool.Pool.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool, q: subdb.New(pool)}
}

// Get возвращает subscription или ErrNotFound.
func (p *Postgres) Get(ctx context.Context, userID uuid.UUID) (domain.Subscription, error) {
	row, err := p.q.GetSubscription(ctx, pgUUID(userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Subscription{}, domain.ErrNotFound
		}
		return domain.Subscription{}, fmt.Errorf("subscription.pg.Get: %w", err)
	}
	return getRowToSub(row), nil
}

// Upsert — идемпотентный INSERT..ON CONFLICT по user_id.
func (p *Postgres) Upsert(ctx context.Context, sub domain.Subscription) error {
	if err := p.q.UpsertSubscription(ctx, subdb.UpsertSubscriptionParams{
		UserID:           pgUUID(sub.UserID),
		Plan:             string(sub.Tier),
		Status:           string(sub.Status),
		Provider:         pgText(string(sub.Provider)),
		ProviderSubID:    pgText(sub.ProviderSubID),
		StartedAt:        pgTS(sub.StartedAt),
		CurrentPeriodEnd: pgTS(sub.CurrentPeriodEnd),
		GraceUntil:       pgTS(sub.GraceUntil),
		UpdatedAt:        pgtype.Timestamptz{Time: sub.UpdatedAt, Valid: !sub.UpdatedAt.IsZero()},
	}); err != nil {
		return fmt.Errorf("subscription.pg.Upsert: %w", err)
	}
	return nil
}

// ListByPlan — read-only выборка active rows.
func (p *Postgres) ListByPlan(ctx context.Context, tier domain.Tier, limit, offset int) ([]domain.Subscription, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := p.q.ListSubscriptionsByPlan(ctx, subdb.ListSubscriptionsByPlanParams{
		Plan:   string(tier),
		Limit:  int32(limit),
		Offset: int32(offset),
	})
	if err != nil {
		return nil, fmt.Errorf("subscription.pg.ListByPlan: %w", err)
	}
	out := make([]domain.Subscription, 0, len(rows))
	for _, r := range rows {
		out = append(out, listRowToSub(r))
	}
	return out, nil
}

// MarkExpired — batch-update для cron'а.
func (p *Postgres) MarkExpired(ctx context.Context, now time.Time) (int64, error) {
	affected, err := p.q.MarkExpiredSubscriptions(ctx, pgtype.Timestamptz{Time: now, Valid: true})
	if err != nil {
		return 0, fmt.Errorf("subscription.pg.MarkExpired: %w", err)
	}
	return affected, nil
}

// Compile-time assertion.
var _ domain.Repo = (*Postgres)(nil)

// ── converters ─────────────────────────────────────────────────────────────

func getRowToSub(r subdb.GetSubscriptionRow) domain.Subscription {
	return domain.Subscription{
		UserID:           sharedpg.UUIDFrom(r.UserID),
		Tier:             enums.SubscriptionPlan(r.Plan),
		Status:           domain.Status(r.Status),
		Provider:         domain.Provider(fromPgText(r.Provider)),
		ProviderSubID:    fromPgText(r.ProviderSubID),
		StartedAt:        fromPgTS(r.StartedAt),
		CurrentPeriodEnd: fromPgTS(r.CurrentPeriodEnd),
		GraceUntil:       fromPgTS(r.GraceUntil),
		UpdatedAt:        r.UpdatedAt.Time,
	}
}

func listRowToSub(r subdb.ListSubscriptionsByPlanRow) domain.Subscription {
	return domain.Subscription{
		UserID:           sharedpg.UUIDFrom(r.UserID),
		Tier:             enums.SubscriptionPlan(r.Plan),
		Status:           domain.Status(r.Status),
		Provider:         domain.Provider(fromPgText(r.Provider)),
		ProviderSubID:    fromPgText(r.ProviderSubID),
		StartedAt:        fromPgTS(r.StartedAt),
		CurrentPeriodEnd: fromPgTS(r.CurrentPeriodEnd),
		GraceUntil:       fromPgTS(r.GraceUntil),
		UpdatedAt:        r.UpdatedAt.Time,
	}
}

// ── pgtype helpers (local, чтобы не тянуть всю shared pg утилиту) ──────────

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func pgText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func fromPgText(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}

func pgTS(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

func fromPgTS(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}
