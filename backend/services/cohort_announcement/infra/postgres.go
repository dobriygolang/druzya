// Package infra holds the Postgres adapter for the cohort announcement
// bounded context.
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/cohort_announcement/domain"
	announcementdb "druz9/cohort_announcement/infra/db"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const defaultListLimit = 100

type Postgres struct {
	pool *pgxpool.Pool
	q    *announcementdb.Queries
}

func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool, q: announcementdb.New(pool)}
}

func (p *Postgres) Create(ctx context.Context, a domain.Announcement) (domain.Announcement, error) {
	row, err := p.q.CreateAnnouncement(ctx, announcementdb.CreateAnnouncementParams{
		CohortID: pgUUID(a.CohortID),
		AuthorID: pgUUID(a.AuthorID),
		Body:     a.Body,
		Pinned:   a.Pinned,
	})
	if err != nil {
		return domain.Announcement{}, fmt.Errorf("announcement.pg.Create: %w", err)
	}
	return domain.Announcement{
		ID:        fromPgUUID(row.ID),
		CohortID:  fromPgUUID(row.CohortID),
		AuthorID:  fromPgUUID(row.AuthorID),
		Body:      row.Body,
		Pinned:    row.Pinned,
		CreatedAt: row.CreatedAt.Time,
		UpdatedAt: row.UpdatedAt.Time,
	}, nil
}

func (p *Postgres) GetByID(ctx context.Context, id uuid.UUID) (domain.Announcement, error) {
	row, err := p.q.GetAnnouncementByID(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Announcement{}, domain.ErrNotFound
		}
		return domain.Announcement{}, fmt.Errorf("announcement.pg.GetByID: %w", err)
	}
	return domain.Announcement{
		ID:                fromPgUUID(row.ID),
		CohortID:          fromPgUUID(row.CohortID),
		AuthorID:          fromPgUUID(row.AuthorID),
		AuthorUsername:    row.AuthorUsername,
		AuthorDisplayName: row.AuthorDisplayName,
		Body:              row.Body,
		Pinned:            row.Pinned,
		CreatedAt:         row.CreatedAt.Time,
		UpdatedAt:         row.UpdatedAt.Time,
	}, nil
}

// ListByCohort + reaction hydration in one round-trip via array param.
func (p *Postgres) ListByCohort(ctx context.Context, cohortID, viewerID uuid.UUID, limit int) ([]domain.Announcement, error) {
	if limit <= 0 || limit > defaultListLimit {
		limit = defaultListLimit
	}
	rows, err := p.q.ListAnnouncementsByCohort(ctx, announcementdb.ListAnnouncementsByCohortParams{
		CohortID: pgUUID(cohortID),
		Limit:    int32(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("announcement.pg.ListByCohort: %w", err)
	}
	out := make([]domain.Announcement, 0, len(rows))
	ids := make([]pgtype.UUID, 0, len(rows))
	idxByID := map[uuid.UUID]int{}
	for _, r := range rows {
		idxByID[fromPgUUID(r.ID)] = len(out)
		out = append(out, domain.Announcement{
			ID:                fromPgUUID(r.ID),
			CohortID:          fromPgUUID(r.CohortID),
			AuthorID:          fromPgUUID(r.AuthorID),
			AuthorUsername:    r.AuthorUsername,
			AuthorDisplayName: r.AuthorDisplayName,
			Body:              r.Body,
			Pinned:            r.Pinned,
			CreatedAt:         r.CreatedAt.Time,
			UpdatedAt:         r.UpdatedAt.Time,
		})
		ids = append(ids, r.ID)
	}
	if len(ids) == 0 {
		return out, nil
	}
	// Hydrate reactions in one batch query (sqlc emits Column1 []pgtype.UUID).
	reactionRows, err := p.q.ListReactionsForAnnouncements(ctx, announcementdb.ListReactionsForAnnouncementsParams{
		Column1: ids,
		UserID:  pgUUID(viewerID),
	})
	if err != nil {
		return nil, fmt.Errorf("announcement.pg.ListByCohort: reactions: %w", err)
	}
	for _, rr := range reactionRows {
		idx, ok := idxByID[fromPgUUID(rr.AnnouncementID)]
		if !ok {
			continue
		}
		out[idx].Reactions = append(out[idx].Reactions, domain.ReactionGroup{
			Emoji: rr.Emoji,
			Count: int(rr.Total),
		})
		if rr.ViewerReacted {
			out[idx].ViewerReacted = append(out[idx].ViewerReacted, rr.Emoji)
		}
	}
	return out, nil
}

func (p *Postgres) Delete(ctx context.Context, id uuid.UUID) error {
	n, err := p.q.DeleteAnnouncement(ctx, pgUUID(id))
	if err != nil {
		return fmt.Errorf("announcement.pg.Delete: %w", err)
	}
	if n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (p *Postgres) AddReaction(ctx context.Context, announcementID, userID uuid.UUID, emoji string) (int, error) {
	if err := p.q.AddReaction(ctx, announcementdb.AddReactionParams{
		AnnouncementID: pgUUID(announcementID),
		UserID:         pgUUID(userID),
		Emoji:          emoji,
	}); err != nil {
		return 0, fmt.Errorf("announcement.pg.AddReaction: %w", err)
	}
	return p.countReaction(ctx, announcementID, emoji)
}

func (p *Postgres) RemoveReaction(ctx context.Context, announcementID, userID uuid.UUID, emoji string) (int, error) {
	if _, err := p.q.RemoveReaction(ctx, announcementdb.RemoveReactionParams{
		AnnouncementID: pgUUID(announcementID),
		UserID:         pgUUID(userID),
		Emoji:          emoji,
	}); err != nil {
		return 0, fmt.Errorf("announcement.pg.RemoveReaction: %w", err)
	}
	return p.countReaction(ctx, announcementID, emoji)
}

func (p *Postgres) countReaction(ctx context.Context, announcementID uuid.UUID, emoji string) (int, error) {
	n, err := p.q.CountReactions(ctx, announcementdb.CountReactionsParams{
		AnnouncementID: pgUUID(announcementID),
		Emoji:          emoji,
	})
	if err != nil {
		return 0, fmt.Errorf("announcement.pg.countReaction: %w", err)
	}
	return int(n), nil
}

// ── helpers ───────────────────────────────────────────────────────────────

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: id != uuid.Nil} }

func fromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}
