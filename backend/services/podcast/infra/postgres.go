// Package infra holds Postgres + MinIO adapters for the podcast domain.
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/podcast/domain"
	podcastdb "druz9/podcast/infra/db"
	"druz9/shared/enums"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres implements domain.PodcastRepo on a *pgxpool.Pool.
type Postgres struct {
	pool *pgxpool.Pool
	q    *podcastdb.Queries
}

// NewPostgres wires a Postgres repo.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool, q: podcastdb.New(pool)}
}

// ListForUser returns a catalog with per-user progress joined in.
func (p *Postgres) ListForUser(ctx context.Context, userID uuid.UUID, section *enums.Section) ([]domain.Listing, error) {
	params := podcastdb.ListPodcastsWithProgressParams{
		UserID: sharedpg.UUID(userID),
	}
	if section != nil && section.IsValid() {
		params.FilterBySection = true
		params.Section = string(*section)
	}
	rows, err := p.q.ListPodcastsWithProgress(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("podcast.pg.ListForUser: %w", err)
	}
	out := make([]domain.Listing, 0, len(rows))
	for _, r := range rows {
		pod := domain.Podcast{
			ID:          sharedpg.UUIDFrom(r.ID),
			TitleRu:     r.TitleRu,
			TitleEn:     r.TitleEn,
			Section:     enums.Section(r.Section),
			DurationSec: int(r.DurationSec),
			AudioKey:    r.AudioKey,
		}
		if r.Description.Valid {
			pod.Description = r.Description.String
		}
		completed := r.CompletedAt.Valid
		out = append(out, domain.Listing{
			Podcast:   pod,
			Progress:  int(r.ListenedSec),
			Completed: completed,
		})
	}
	return out, nil
}

// GetByID returns a single podcast.
func (p *Postgres) GetByID(ctx context.Context, podcastID uuid.UUID) (domain.Podcast, error) {
	row, err := p.q.GetPodcastByID(ctx, sharedpg.UUID(podcastID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Podcast{}, fmt.Errorf("podcast.pg.GetByID: %w", domain.ErrNotFound)
		}
		return domain.Podcast{}, fmt.Errorf("podcast.pg.GetByID: %w", err)
	}
	out := domain.Podcast{
		ID:          sharedpg.UUIDFrom(row.ID),
		TitleRu:     row.TitleRu,
		TitleEn:     row.TitleEn,
		Section:     enums.Section(row.Section),
		DurationSec: int(row.DurationSec),
		AudioKey:    row.AudioKey,
		IsPublished: row.IsPublished,
		CreatedAt:   row.CreatedAt.Time,
	}
	if row.Description.Valid {
		out.Description = row.Description.String
	}
	return out, nil
}

// GetProgress returns (user, podcast). Missing → zero-valued.
func (p *Postgres) GetProgress(ctx context.Context, userID, podcastID uuid.UUID) (domain.Progress, error) {
	row, err := p.q.GetPodcastProgress(ctx, podcastdb.GetPodcastProgressParams{
		UserID:    sharedpg.UUID(userID),
		PodcastID: sharedpg.UUID(podcastID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Progress{UserID: userID, PodcastID: podcastID}, nil
		}
		return domain.Progress{}, fmt.Errorf("podcast.pg.GetProgress: %w", err)
	}
	out := domain.Progress{
		UserID:      sharedpg.UUIDFrom(row.UserID),
		PodcastID:   sharedpg.UUIDFrom(row.PodcastID),
		ListenedSec: int(row.ListenedSec),
		UpdatedAt:   row.UpdatedAt.Time,
	}
	if row.CompletedAt.Valid {
		t := row.CompletedAt.Time
		out.CompletedAt = &t
	}
	return out, nil
}

// UpsertProgress writes the progress row.
func (p *Postgres) UpsertProgress(ctx context.Context, prog domain.Progress) error {
	var completed pgtype.Timestamptz
	if prog.CompletedAt != nil {
		completed = pgtype.Timestamptz{Time: *prog.CompletedAt, Valid: true}
	}
	if err := p.q.UpsertPodcastProgress(ctx, podcastdb.UpsertPodcastProgressParams{
		UserID:      sharedpg.UUID(prog.UserID),
		PodcastID:   sharedpg.UUID(prog.PodcastID),
		ListenedSec: int32(prog.ListenedSec),
		CompletedAt: completed,
	}); err != nil {
		return fmt.Errorf("podcast.pg.UpsertProgress: %w", err)
	}
	return nil
}

// FakeSigner is a STUB AudioSigner. Real impl: wrap a MinIO client's
// PresignGetObject with a 1h TTL. For MVP we return a stable "/stream/<key>"
// URL that an edge proxy rewrites to a signed request.
type FakeSigner struct {
	Prefix string // e.g. "/stream" or "https://cdn.example.com/stream"
}

// NewFakeSigner wires a FakeSigner. Prefix defaults to "/stream".
func NewFakeSigner(prefix string) *FakeSigner {
	if prefix == "" {
		prefix = "/stream"
	}
	return &FakeSigner{Prefix: prefix}
}

// Sign returns a placeholder URL. STUB — see package comment.
func (s *FakeSigner) Sign(_ context.Context, audioKey string) (string, error) {
	return s.Prefix + "/" + audioKey, nil
}

// ── helpers ────────────────────────────────────────────────────────────────

// Compile-time assertions.
var (
	_ domain.PodcastRepo = (*Postgres)(nil)
	_ domain.AudioSigner = (*FakeSigner)(nil)
)
