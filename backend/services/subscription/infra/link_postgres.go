package infra

import (
	"context"
	"errors"
	"fmt"

	sharedpg "druz9/shared/pkg/pg"
	"druz9/subscription/domain"
	subdb "druz9/subscription/infra/db"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// LinkPostgres реализует domain.LinkRepo. Разделён с Postgres (subscriptions)
// — это другая таблица с другим сроком жизни и разными access patterns.
type LinkPostgres struct {
	q *subdb.Queries
}

// NewLinkPostgres — wrapper над тем же *pgxpool.Pool что и Postgres.
func NewLinkPostgres(pool pgtypePool) *LinkPostgres {
	return &LinkPostgres{q: subdb.New(pool)}
}

// pgtypePool — локальный alias чтобы избежать импорта pgxpool в каждой
// сигнатуре и оставить возможность моков. Интерфейс совпадает с тем что
// принимает subdb.New (DBTX от sqlc).
type pgtypePool = subdb.DBTX

func (p *LinkPostgres) Upsert(ctx context.Context, link domain.ProviderLink) error {
	if err := p.q.UpsertProviderLink(ctx, subdb.UpsertProviderLinkParams{
		UserID:       pgUUID(link.UserID),
		Provider:     string(link.Provider),
		ExternalID:   link.ExternalID,
		ExternalTier: pgText(link.ExternalTier),
		VerifiedAt:   pgTS(link.VerifiedAt),
	}); err != nil {
		return fmt.Errorf("subscription.link.Upsert: %w", err)
	}
	return nil
}

func (p *LinkPostgres) Get(ctx context.Context, userID uuid.UUID, provider domain.Provider) (domain.ProviderLink, error) {
	row, err := p.q.GetProviderLink(ctx, subdb.GetProviderLinkParams{
		UserID:   pgUUID(userID),
		Provider: string(provider),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ProviderLink{}, domain.ErrNotFound
		}
		return domain.ProviderLink{}, fmt.Errorf("subscription.link.Get: %w", err)
	}
	return linkRowToDomain(row), nil
}

func (p *LinkPostgres) FindUserByExternalID(ctx context.Context, provider domain.Provider, externalID string) (uuid.UUID, error) {
	uid, err := p.q.FindUserByExternalID(ctx, subdb.FindUserByExternalIDParams{
		Provider:   string(provider),
		ExternalID: externalID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, domain.ErrNotFound
		}
		return uuid.Nil, fmt.Errorf("subscription.link.FindUserByExternalID: %w", err)
	}
	return sharedpg.UUIDFrom(uid), nil
}

func (p *LinkPostgres) ListByProvider(ctx context.Context, provider domain.Provider, limit, offset int) ([]domain.ProviderLink, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := p.q.ListLinksByProvider(ctx, subdb.ListLinksByProviderParams{
		Provider: string(provider),
		Limit:    int32(limit),
		Offset:   int32(offset),
	})
	if err != nil {
		return nil, fmt.Errorf("subscription.link.ListByProvider: %w", err)
	}
	out := make([]domain.ProviderLink, 0, len(rows))
	for _, r := range rows {
		out = append(out, domain.ProviderLink{
			UserID:       sharedpg.UUIDFrom(r.UserID),
			Provider:     domain.Provider(r.Provider),
			ExternalID:   r.ExternalID,
			ExternalTier: fromPgText(r.ExternalTier),
			VerifiedAt:   fromPgTS(r.VerifiedAt),
			CreatedAt:    r.CreatedAt.Time,
			UpdatedAt:    r.UpdatedAt.Time,
		})
	}
	return out, nil
}

var _ domain.LinkRepo = (*LinkPostgres)(nil)

func linkRowToDomain(r subdb.ProviderLink) domain.ProviderLink {
	return domain.ProviderLink{
		UserID:       sharedpg.UUIDFrom(r.UserID),
		Provider:     domain.Provider(r.Provider),
		ExternalID:   r.ExternalID,
		ExternalTier: fromPgText(r.ExternalTier),
		VerifiedAt:   fromPgTS(r.VerifiedAt),
		CreatedAt:    r.CreatedAt.Time,
		UpdatedAt:    r.UpdatedAt.Time,
	}
}

// pgtype helpers используются также в postgres.go — функция fromPgTS/pgTS/
// pgText уже определены там. Go-package'ы разделяют file-level scope, но
// это один пакет infra — символы доступны.
var _ = pgtype.Text{}
