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
// ClaimStore (in-memory)
//
// STUB: the `season_progress` schema has no claim-tracking column today. MVP
// keeps claims in an in-memory map; a future migration will add
// `season_reward_claims(user_id, season_id, kind, tier, claimed_at)`.
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

// MarkClaimed flips the bit for (kind, tier).
func (m *memClaimStore) MarkClaimed(_ context.Context, userID, seasonID uuid.UUID, kind domain.TrackKind, tier int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := claimKey{userID, seasonID}
	s, ok := m.state[key]
	if !ok {
		s = domain.NewClaimState()
	}
	switch kind {
	case domain.TrackFree:
		s.FreeClaimed[tier] = true
	case domain.TrackPremium:
		s.PremiumClaimed[tier] = true
	default:
		return fmt.Errorf("season.memClaimStore: unknown track %q", kind)
	}
	m.state[key] = s
	return nil
}

var _ domain.ClaimRepo = (*memClaimStore)(nil)
