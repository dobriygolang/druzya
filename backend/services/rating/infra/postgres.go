// Package infra holds Postgres and Redis adapters for the rating domain.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/rating/domain"
	ratingdb "druz9/rating/infra/db"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres implements domain.RatingRepo on a *pgxpool.Pool via sqlc-generated
// queries (package ratingdb).
type Postgres struct {
	pool *pgxpool.Pool
	q    *ratingdb.Queries
}

// NewPostgres wires a Postgres repo.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool, q: ratingdb.New(pool)}
}

// List returns every section rating for a user.
func (p *Postgres) List(ctx context.Context, userID uuid.UUID) ([]domain.SectionRating, error) {
	rows, err := p.q.GetRatingsByUser(ctx, pgUUID(userID))
	if err != nil {
		return nil, fmt.Errorf("rating.pg.List: %w", err)
	}
	out := make([]domain.SectionRating, 0, len(rows))
	for _, r := range rows {
		out = append(out, toSectionRating(r))
	}
	return out, nil
}

// Upsert inserts or updates the (user_id, section) row.
func (p *Postgres) Upsert(ctx context.Context, r domain.SectionRating) error {
	var last pgtype.Timestamptz
	if r.LastMatchAt != nil {
		last = pgtype.Timestamptz{Time: *r.LastMatchAt, Valid: true}
	}
	if err := p.q.UpsertRating(ctx, ratingdb.UpsertRatingParams{
		UserID:       pgUUID(r.UserID),
		Section:      string(r.Section),
		Elo:          int32(r.Elo),
		MatchesCount: int32(r.MatchesCount),
		LastMatchAt:  last,
	}); err != nil {
		return fmt.Errorf("rating.pg.Upsert: %w", err)
	}
	return nil
}

// Top returns the leaderboard for a section.
func (p *Postgres) Top(ctx context.Context, section enums.Section, limit int) ([]domain.LeaderboardEntry, error) {
	rows, err := p.q.TopLeaderboard(ctx, ratingdb.TopLeaderboardParams{
		Section: string(section),
		Limit:   int32(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("rating.pg.Top: %w", err)
	}
	out := make([]domain.LeaderboardEntry, 0, len(rows))
	for _, r := range rows {
		out = append(out, domain.LeaderboardEntry{
			UserID:   fromPgUUID(r.UserID),
			Username: r.Username,
			Title:    r.Title,
			Elo:      int(r.Elo),
			Rank:     int(r.Rank),
		})
	}
	return out, nil
}

// FindRank returns the user's 1-based rank within a section.
func (p *Postgres) FindRank(ctx context.Context, userID uuid.UUID, section enums.Section) (int, error) {
	rank, err := p.q.FindRank(ctx, ratingdb.FindRankParams{
		UserID:  pgUUID(userID),
		Section: string(section),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil
		}
		return 0, fmt.Errorf("rating.pg.FindRank: %w", err)
	}
	return int(rank), nil
}

// CountSection returns the total number of ranked users for a section.
func (p *Postgres) CountSection(ctx context.Context, section enums.Section) (int, error) {
	total, err := p.q.CountSection(ctx, string(section))
	if err != nil {
		return 0, fmt.Errorf("rating.pg.CountSection: %w", err)
	}
	return int(total), nil
}

// HistoryLast12Weeks returns an empty slice for now.
// STUB: real implementation joins arena_participants + mock_sessions,
// bucketed by ISO week. Wire once arena and mock land.
func (p *Postgres) HistoryLast12Weeks(_ context.Context, _ uuid.UUID) ([]domain.HistorySample, error) {
	return []domain.HistorySample{}, nil
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

func toSectionRating(r ratingdb.Rating) domain.SectionRating {
	out := domain.SectionRating{
		UserID:       fromPgUUID(r.UserID),
		Section:      enums.Section(r.Section),
		Elo:          int(r.Elo),
		MatchesCount: int(r.MatchesCount),
		UpdatedAt:    r.UpdatedAt.Time,
	}
	if r.LastMatchAt.Valid {
		t := r.LastMatchAt.Time
		out.LastMatchAt = &t
	}
	return out
}

// Ensure Postgres satisfies the domain port.
var _ domain.RatingRepo = (*Postgres)(nil)

// tickNow is a tiny helper used only in tests; kept here to avoid a test
// dependency on time.Now in infra code paths.
func tickNow() time.Time { return time.Now().UTC() }

// Suppress unused warning in the non-test build path.
var _ = tickNow
