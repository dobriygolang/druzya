package infra

import (
	"context"
	"fmt"
	"strings"

	"druz9/hone/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ExternalRepo — pgx repo поверх external_activity (миграция 00037).
type ExternalRepo struct{ pool *pgxpool.Pool }

func NewExternalRepo(pool *pgxpool.Pool) *ExternalRepo { return &ExternalRepo{pool: pool} }

func (r *ExternalRepo) Insert(ctx context.Context, a domain.ExternalActivity) (domain.ExternalActivity, error) {
	const q = `
		INSERT INTO external_activity (
		    user_id, source, topic_atlas_node_id, topic_free_text,
		    duration_min, notes, occurred_at
		) VALUES ($1, $2, NULLIF($3,''), $4, $5, $6, $7)
		RETURNING id, created_at, occurred_at`
	var topicID *string
	if a.TopicAtlasNodeID != "" {
		v := a.TopicAtlasNodeID
		topicID = &v
	}
	row := r.pool.QueryRow(ctx, q,
		a.UserID,
		string(a.Source),
		strDeref(topicID),
		a.TopicFreeText,
		a.DurationMin,
		a.Notes,
		a.OccurredAt.UTC(),
	)
	if err := row.Scan(&a.ID, &a.CreatedAt, &a.OccurredAt); err != nil {
		return domain.ExternalActivity{}, fmt.Errorf("hone.ExternalRepo.Insert: %w", err)
	}
	return a, nil
}

func (r *ExternalRepo) List(ctx context.Context, userID uuid.UUID, source string, limit int) ([]domain.ExternalActivity, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	args := []any{userID, limit}
	q := `SELECT id, user_id, source, COALESCE(topic_atlas_node_id, ''), topic_free_text,
	             duration_min, notes, occurred_at, created_at
	      FROM external_activity
	      WHERE user_id = $1`
	if strings.TrimSpace(source) != "" {
		q += ` AND source = $3`
		args = append(args, strings.TrimSpace(source))
	}
	q += ` ORDER BY occurred_at DESC LIMIT $2`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("hone.ExternalRepo.List: %w", err)
	}
	defer rows.Close()
	out := make([]domain.ExternalActivity, 0, limit)
	for rows.Next() {
		var a domain.ExternalActivity
		var src string
		if err := rows.Scan(&a.ID, &a.UserID, &src, &a.TopicAtlasNodeID, &a.TopicFreeText,
			&a.DurationMin, &a.Notes, &a.OccurredAt, &a.CreatedAt); err != nil {
			return nil, fmt.Errorf("hone.ExternalRepo.List scan: %w", err)
		}
		a.Source = domain.ExternalActivitySource(src)
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.ExternalRepo.List rows: %w", err)
	}
	return out, nil
}

// ListPaged — keyset cursor variant (occurred_at DESC, id DESC).
// Decodes the opaque cursor; empty = first page; cursor with garbage =
// typed error rather than silent empty page.
func (r *ExternalRepo) ListPaged(
	ctx context.Context, userID uuid.UUID, source string, limit int, cursor string,
) ([]domain.ExternalActivity, string, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	c, err := decodeCreatedAtCursor(cursor) // CreatedAt holds occurred_at here.
	if err != nil {
		return nil, "", fmt.Errorf("hone.ExternalRepo.ListPaged: %w", err)
	}
	args := []any{userID}
	q := `SELECT id, user_id, source, COALESCE(topic_atlas_node_id, ''), topic_free_text,
	             duration_min, notes, occurred_at, created_at
	      FROM external_activity
	      WHERE user_id = $1`
	if strings.TrimSpace(source) != "" {
		args = append(args, strings.TrimSpace(source))
		q += fmt.Sprintf(` AND source = $%d`, len(args))
	}
	if !c.CreatedAt.IsZero() {
		cid, parseErr := uuid.Parse(c.ID)
		if parseErr != nil {
			return nil, "", fmt.Errorf("hone.ExternalRepo.ListPaged: cursor id: %w", parseErr)
		}
		args = append(args, c.CreatedAt, cid)
		q += fmt.Sprintf(` AND (occurred_at, id) < ($%d, $%d)`, len(args)-1, len(args))
	}
	args = append(args, limit+1)
	q += fmt.Sprintf(` ORDER BY occurred_at DESC, id DESC LIMIT $%d`, len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, "", fmt.Errorf("hone.ExternalRepo.ListPaged: %w", err)
	}
	defer rows.Close()
	out := make([]domain.ExternalActivity, 0, limit)
	for rows.Next() {
		var a domain.ExternalActivity
		var src string
		if scanErr := rows.Scan(&a.ID, &a.UserID, &src, &a.TopicAtlasNodeID, &a.TopicFreeText,
			&a.DurationMin, &a.Notes, &a.OccurredAt, &a.CreatedAt); scanErr != nil {
			return nil, "", fmt.Errorf("hone.ExternalRepo.ListPaged scan: %w", scanErr)
		}
		a.Source = domain.ExternalActivitySource(src)
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("hone.ExternalRepo.ListPaged rows: %w", err)
	}
	var nextCursor string
	if len(out) > limit {
		out = out[:limit]
		last := out[len(out)-1]
		nextCursor = encodeCreatedAtCursor(createdAtCursor{
			CreatedAt: last.OccurredAt,
			ID:        last.ID.String(),
		})
	}
	return out, nextCursor, nil
}

func (r *ExternalRepo) Delete(ctx context.Context, userID, id uuid.UUID) error {
	const q = `DELETE FROM external_activity WHERE user_id = $1 AND id = $2`
	tag, err := r.pool.Exec(ctx, q, userID, id)
	if err != nil {
		return fmt.Errorf("hone.ExternalRepo.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func strDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ─── Atlas topic searcher (trigram fallback to LIKE) ──────────────────────

type AtlasTopicSearcher struct{ pool *pgxpool.Pool }

func NewAtlasTopicSearcher(pool *pgxpool.Pool) *AtlasTopicSearcher {
	return &AtlasTopicSearcher{pool: pool}
}

func (s *AtlasTopicSearcher) SearchByPrefix(ctx context.Context, prefix string, limit int) ([]domain.AtlasTopicSuggestion, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		return nil, nil
	}
	// ILIKE на title — простой и быстрый для нескольких сотен узлов
	// в атласе. Можно apgrade'ить до pg_trgm % similarity если корпус
	// вырастет.
	const q = `
		SELECT id, title, section
		FROM atlas_nodes
		WHERE is_active = TRUE AND title ILIKE $1
		ORDER BY length(title), title
		LIMIT $2`
	rows, err := s.pool.Query(ctx, q, "%"+prefix+"%", limit)
	if err != nil {
		return nil, fmt.Errorf("hone.AtlasTopicSearcher: %w", err)
	}
	defer rows.Close()
	out := make([]domain.AtlasTopicSuggestion, 0, limit)
	for rows.Next() {
		var s domain.AtlasTopicSuggestion
		if err := rows.Scan(&s.AtlasNodeID, &s.Title, &s.Section); err != nil {
			return nil, fmt.Errorf("hone.AtlasTopicSearcher scan: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.AtlasTopicSearcher rows: %w", err)
	}
	return out, nil
}

// ─── AtlasNodeTracksReader (bulk track_kind map) ──────────────────────────

type AtlasNodeTracksReader struct{ pool *pgxpool.Pool }

func NewAtlasNodeTracksReader(pool *pgxpool.Pool) *AtlasNodeTracksReader {
	return &AtlasNodeTracksReader{pool: pool}
}

func (r *AtlasNodeTracksReader) ListAll(ctx context.Context) ([]domain.AtlasNodeTrack, error) {
	const q = `
		SELECT id, track_kind::text
		FROM atlas_nodes
		WHERE is_active = TRUE
		ORDER BY id`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("hone.AtlasNodeTracksReader: %w", err)
	}
	defer rows.Close()
	out := make([]domain.AtlasNodeTrack, 0, 200)
	for rows.Next() {
		var t domain.AtlasNodeTrack
		if err := rows.Scan(&t.AtlasNodeID, &t.TrackKind); err != nil {
			return nil, fmt.Errorf("hone.AtlasNodeTracksReader scan: %w", err)
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.AtlasNodeTracksReader rows: %w", err)
	}
	return out, nil
}
