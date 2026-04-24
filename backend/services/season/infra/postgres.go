package infra

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"druz9/season/domain"
	seasondb "druz9/season/infra/db"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres implements domain.SeasonRepo on a *pgxpool.Pool via the
// sqlc-generated seasondb package.
type Postgres struct {
	pool *pgxpool.Pool
	q    *seasondb.Queries
}

// NewPostgres wires a Postgres repo.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool, q: seasondb.New(pool)}
}

// GetCurrent returns the row flagged is_current = TRUE.
func (p *Postgres) GetCurrent(ctx context.Context) (domain.Season, error) {
	row, err := p.q.GetCurrentSeason(ctx)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Season{}, fmt.Errorf("season.pg.GetCurrent: %w", domain.ErrNoCurrent)
		}
		return domain.Season{}, fmt.Errorf("season.pg.GetCurrent: %w", err)
	}
	return toSeason(row), nil
}

// GetProgress loads (user, season). Missing → zero-valued Progress.
func (p *Postgres) GetProgress(ctx context.Context, userID, seasonID uuid.UUID) (domain.Progress, error) {
	row, err := p.q.GetSeasonProgress(ctx, seasondb.GetSeasonProgressParams{
		UserID:   pgUUID(userID),
		SeasonID: pgUUID(seasonID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Progress{UserID: userID, SeasonID: seasonID}, nil
		}
		return domain.Progress{}, fmt.Errorf("season.pg.GetProgress: %w", err)
	}
	return domain.Progress{
		UserID:    fromPgUUID(row.UserID),
		SeasonID:  fromPgUUID(row.SeasonID),
		Points:    int(row.Points),
		Tier:      int(row.Tier),
		IsPremium: row.IsPremium,
		UpdatedAt: row.UpdatedAt.Time,
	}, nil
}

// IncrementPoints atomically bumps points and returns the new total.
func (p *Postgres) IncrementPoints(ctx context.Context, userID, seasonID uuid.UUID, delta int) (int, error) {
	total, err := p.q.IncrementSeasonPoints(ctx, seasondb.IncrementSeasonPointsParams{
		UserID:   pgUUID(userID),
		SeasonID: pgUUID(seasonID),
		Points:   int32(delta),
	})
	if err != nil {
		return 0, fmt.Errorf("season.pg.IncrementPoints: %w", err)
	}
	return int(total), nil
}

// UpdateTier writes the recomputed tier.
func (p *Postgres) UpdateTier(ctx context.Context, userID, seasonID uuid.UUID, tier int) error {
	if err := p.q.UpdateSeasonTier(ctx, seasondb.UpdateSeasonTierParams{
		UserID:   pgUUID(userID),
		SeasonID: pgUUID(seasonID),
		Tier:     int32(tier),
	}); err != nil {
		return fmt.Errorf("season.pg.UpdateTier: %w", err)
	}
	return nil
}

// ── helpers ────────────────────────────────────────────────────────────────

func pgUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

func fromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

func toSeason(r seasondb.Season) domain.Season {
	out := domain.Season{
		ID:        fromPgUUID(r.ID),
		Name:      r.Name,
		Slug:      r.Slug,
		IsCurrent: r.IsCurrent,
		StartsAt:  r.StartsAt.Time,
		EndsAt:    r.EndsAt.Time,
	}
	if r.Theme.Valid {
		out.Theme = r.Theme.String
	}
	return out
}

// Ensure Postgres satisfies the domain port.
var _ domain.SeasonRepo = (*Postgres)(nil)

// ─────────────────────────────────────────────────────────────────────────
// ClaimStore — Postgres-backed.
//
// Таблица season_reward_claims с UNIQUE (user_id, season_id, kind, tier)
// и запросом `INSERT ... ON CONFLICT DO NOTHING RETURNING id` обеспечивает
// атомарную идемпотентность: повторная вставка возвращает pgx.ErrNoRows,
// мы мэппим это в domain.ErrAlreadyClaimed. Этого достаточно, чтобы
// закрыть TOCTOU и работать корректно при horizontal-scale.
// ─────────────────────────────────────────────────────────────────────────

// ClaimStore is the Postgres-backed ClaimRepo.
type ClaimStore struct {
	pool *pgxpool.Pool
	q    *seasondb.Queries
}

// NewClaimStore wires a Postgres-backed ClaimRepo.
func NewClaimStore(pool *pgxpool.Pool) *ClaimStore {
	return &ClaimStore{pool: pool, q: seasondb.New(pool)}
}

// Get возвращает ClaimState для (user, season). Пустой набор клеймов —
// это валидная NewClaimState, не ошибка.
func (c *ClaimStore) Get(ctx context.Context, userID, seasonID uuid.UUID) (domain.ClaimState, error) {
	rows, err := c.q.ListSeasonRewardClaims(ctx, seasondb.ListSeasonRewardClaimsParams{
		UserID:   pgUUID(userID),
		SeasonID: pgUUID(seasonID),
	})
	if err != nil {
		return domain.ClaimState{}, fmt.Errorf("season.pg.ClaimStore.Get: %w", err)
	}
	out := domain.NewClaimState()
	for _, r := range rows {
		switch domain.TrackKind(r.Kind) {
		case domain.TrackFree:
			out.FreeClaimed[int(r.Tier)] = true
		case domain.TrackPremium:
			out.PremiumClaimed[int(r.Tier)] = true
		default:
			// Непредвиденный kind в БД — игнорируем, не роняем чтение:
			// CHECK-констрейнт в миграции не даст такому значению туда попасть.
		}
	}
	return out, nil
}

// MarkClaimed атомарно вставляет клейм. Если строка уже существует
// (ON CONFLICT DO NOTHING → RETURNING без строк → pgx.ErrNoRows) —
// возвращается domain.ErrAlreadyClaimed. Это закрывает TOCTOU между
// Get+CanClaim и MarkClaimed в app/claim_reward.go.
func (c *ClaimStore) MarkClaimed(ctx context.Context, userID, seasonID uuid.UUID, kind domain.TrackKind, tier int) error {
	if !kind.IsValid() {
		return fmt.Errorf("season.pg.ClaimStore.MarkClaimed: unknown track %q", kind)
	}
	_, err := c.q.InsertSeasonRewardClaim(ctx, seasondb.InsertSeasonRewardClaimParams{
		UserID:   pgUUID(userID),
		SeasonID: pgUUID(seasonID),
		Kind:     string(kind),
		Tier:     int32(tier),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("season.pg.ClaimStore.MarkClaimed: %w", domain.ErrAlreadyClaimed)
		}
		return fmt.Errorf("season.pg.ClaimStore.MarkClaimed: %w", err)
	}
	return nil
}

var _ domain.ClaimRepo = (*ClaimStore)(nil)

// ─────────────────────────────────────────────────────────────────────────
// memClaimStore — in-memory ClaimRepo для юнит-тестов/локальной отладки.
//
// Production wiring в cmd/monolith использует ClaimStore (Postgres).
// Этот тип сохранён как удобная реализация домены для тестов, которые не
// хотят поднимать БД.
// ─────────────────────────────────────────────────────────────────────────

type memClaimStore struct {
	mu    sync.Mutex
	state map[claimKey]domain.ClaimState
}

type claimKey struct {
	userID, seasonID uuid.UUID
}

// NewMemClaimStore returns an in-memory ClaimRepo.
func NewMemClaimStore() *memClaimStore { //nolint:revive // exported via constructor below
	return &memClaimStore{state: map[claimKey]domain.ClaimState{}}
}

// Get returns the ClaimState for (user, season), or a fresh empty state.
func (m *memClaimStore) Get(_ context.Context, userID, seasonID uuid.UUID) (domain.ClaimState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.state[claimKey{userID, seasonID}]
	if !ok {
		return domain.NewClaimState(), nil
	}
	// Deep-copy maps so callers don't mutate internal state.
	out := domain.NewClaimState()
	for k, v := range s.FreeClaimed {
		out.FreeClaimed[k] = v
	}
	for k, v := range s.PremiumClaimed {
		out.PremiumClaimed[k] = v
	}
	return out, nil
}

// MarkClaimed атомарно (под mutex'ом) вставляет клейм. На повторную
// попытку возвращает domain.ErrAlreadyClaimed — идентично
// Postgres-реализации, чтобы тесты могли полагаться на тот же контракт.
func (m *memClaimStore) MarkClaimed(_ context.Context, userID, seasonID uuid.UUID, kind domain.TrackKind, tier int) error {
	if !kind.IsValid() {
		return fmt.Errorf("season.memClaimStore: unknown track %q", kind)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	key := claimKey{userID, seasonID}
	s, ok := m.state[key]
	if !ok {
		s = domain.NewClaimState()
	}
	var claimed map[int]bool
	switch kind {
	case domain.TrackFree:
		claimed = s.FreeClaimed
	case domain.TrackPremium:
		claimed = s.PremiumClaimed
	}
	if claimed[tier] {
		return fmt.Errorf("season.memClaimStore: %w", domain.ErrAlreadyClaimed)
	}
	claimed[tier] = true
	m.state[key] = s
	return nil
}

var _ domain.ClaimRepo = (*memClaimStore)(nil)
