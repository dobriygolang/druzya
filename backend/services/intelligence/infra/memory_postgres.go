// Memory layer pgx adapter — coach_episodes table.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/intelligence/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Episodes implements domain.EpisodeRepo over coach_episodes.
type Episodes struct {
	pool *pgxpool.Pool
}

// NewEpisodes wraps a pool.
func NewEpisodes(pool *pgxpool.Pool) *Episodes { return &Episodes{pool: pool} }

// Append inserts one episode. Embedding is optional (worker fills
// embedding_vec later if NULL on insert).
func (r *Episodes) Append(ctx context.Context, e domain.Episode) error {
	if e.Kind == "" || !e.Kind.IsValid() {
		return fmt.Errorf("intelligence.Episodes.Append: invalid kind %q", e.Kind)
	}
	occ := e.OccurredAt
	if occ.IsZero() {
		occ = time.Now().UTC()
	}
	payload := e.Payload
	if len(payload) == 0 {
		payload = []byte(`{}`)
	}
	var embedded pgtype.Timestamptz
	if e.EmbeddedAt != nil {
		embedded = pgtype.Timestamptz{Time: *e.EmbeddedAt, Valid: true}
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO coach_episodes
		    (user_id, kind, summary, payload, embedding_model_id, embedded_at, occurred_at)
		 VALUES ($1, $2, $3, $4::jsonb,
		         (SELECT id FROM embedding_models WHERE name = NULLIF($5, '')),
		         $6,
		         COALESCE(NULLIF($7, '0001-01-01 00:00:00+00'::timestamptz), now()))`,
		sharedpg.UUID(e.UserID),
		string(e.Kind),
		e.Summary,
		string(payload),
		e.EmbeddingModel,
		embedded,
		pgtype.Timestamptz{Time: occ, Valid: true},
	)
	if err != nil {
		return fmt.Errorf("intelligence.Episodes.Append: %w", err)
	}
	return nil
}

// LatestByKind returns last N rows of (user, kind) by occurred_at DESC.
func (r *Episodes) LatestByKind(ctx context.Context, userID uuid.UUID, kind domain.EpisodeKind, limit int) ([]domain.Episode, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, kind, summary, payload,
		        (SELECT name FROM embedding_models WHERE id = embedding_model_id) AS embedding_model,
		        embedded_at, occurred_at, created_at
		   FROM coach_episodes
		  WHERE user_id = $1 AND kind = $2
		  ORDER BY occurred_at DESC
		  LIMIT $3`,
		sharedpg.UUID(userID), string(kind), limit,
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.Episodes.LatestByKind: %w", err)
	}
	defer rows.Close()
	return scanEpisodes(rows)
}

// LatestByKinds — variadic over kinds. ANY-array filter.
func (r *Episodes) LatestByKinds(ctx context.Context, userID uuid.UUID, kinds []domain.EpisodeKind, limit int) ([]domain.Episode, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if len(kinds) == 0 {
		// Если фильтра нет — возвращаем все kinds. Без этого ANY([]) ловит 0 строк.
		rows, err := r.pool.Query(ctx,
			`SELECT id, user_id, kind, summary, payload,
		        (SELECT name FROM embedding_models WHERE id = embedding_model_id) AS embedding_model,
			        embedded_at, occurred_at, created_at
			   FROM coach_episodes
			  WHERE user_id = $1
			  ORDER BY occurred_at DESC LIMIT $2`,
			sharedpg.UUID(userID), limit,
		)
		if err != nil {
			return nil, fmt.Errorf("intelligence.Episodes.LatestByKinds: %w", err)
		}
		defer rows.Close()
		return scanEpisodes(rows)
	}
	kindStrs := make([]string, len(kinds))
	for i, k := range kinds {
		kindStrs[i] = string(k)
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, kind, summary, payload,
		        (SELECT name FROM embedding_models WHERE id = embedding_model_id) AS embedding_model,
		        embedded_at, occurred_at, created_at
		   FROM coach_episodes
		  WHERE user_id = $1 AND kind = ANY($2::text[])
		  ORDER BY occurred_at DESC
		  LIMIT $3`,
		sharedpg.UUID(userID), kindStrs, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.Episodes.LatestByKinds: %w", err)
	}
	defer rows.Close()
	return scanEpisodes(rows)
}

// LatestPerKind returns up to perKindLimit newest rows for each requested kind.
func (r *Episodes) LatestPerKind(ctx context.Context, userID uuid.UUID, kinds []domain.EpisodeKind, perKindLimit int) ([]domain.Episode, error) {
	if perKindLimit <= 0 || perKindLimit > 100 {
		perKindLimit = 8
	}
	if len(kinds) == 0 {
		return nil, nil
	}
	kindStrs := make([]string, len(kinds))
	for i, k := range kinds {
		kindStrs[i] = string(k)
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, kind, summary, payload,
		        (SELECT name FROM embedding_models WHERE id = embedding_model_id) AS embedding_model,
		        embedded_at, occurred_at, created_at
		   FROM (
		        SELECT id, user_id, kind, summary, payload,
		        (SELECT name FROM embedding_models WHERE id = embedding_model_id) AS embedding_model,
		               embedded_at, occurred_at, created_at,
		               row_number() OVER (PARTITION BY kind ORDER BY occurred_at DESC) AS rn
		          FROM coach_episodes
		         WHERE user_id = $1 AND kind = ANY($2::text[])
		   ) ranked
		  WHERE rn <= $3
		  ORDER BY occurred_at DESC`,
		sharedpg.UUID(userID), kindStrs, perKindLimit,
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.Episodes.LatestPerKind: %w", err)
	}
	defer rows.Close()
	return scanEpisodes(rows)
}

// SearchSimilar returns top-K by cosine. Filtering by kinds — optional.
// Phase I: episodes filtered by embedding_model_id matching modelName.
// Phase IX v2: ranking pushed into Postgres через pgvector `<=>` cosine
// distance operator + IVFFlat index — no Go-side cosine, no candidate
// pre-fetching. Score = 1 - distance (1.0 = identical, 0 = orthogonal,
// -1.0 = opposite; для cosine_ops range фактически [0..2] → score [-1..1]).
//
// modelName == "" skips the filter (test path); embedding_vec IS NOT NULL
// фильтрует pending-embedding rows.
func (r *Episodes) SearchSimilar(ctx context.Context, userID uuid.UUID, vec []float32, modelName string, kinds []domain.EpisodeKind, limit int) ([]domain.EpisodeWithScore, error) {
	if len(vec) == 0 {
		return nil, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 8
	}
	vecStr := sharedpg.VectorString(vec)
	if vecStr == "" {
		return nil, nil
	}
	q := `SELECT id, user_id, kind, summary, payload,
	        (SELECT name FROM embedding_models WHERE id = embedding_model_id) AS embedding_model,
	        embedded_at, occurred_at, created_at,
	        1 - (embedding_vec <=> $2::vector) AS similarity
	   FROM coach_episodes
	  WHERE user_id = $1 AND embedding_vec IS NOT NULL`
	args := []any{sharedpg.UUID(userID), vecStr}
	if modelName != "" {
		q += fmt.Sprintf(" AND embedding_model_id = (SELECT id FROM embedding_models WHERE name = $%d)", len(args)+1)
		args = append(args, modelName)
	}
	if len(kinds) > 0 {
		kindStrs := make([]string, len(kinds))
		for i, k := range kinds {
			kindStrs[i] = string(k)
		}
		q += fmt.Sprintf(" AND kind = ANY($%d::text[])", len(args)+1)
		args = append(args, kindStrs)
	}
	q += fmt.Sprintf(" ORDER BY embedding_vec <=> $2::vector ASC LIMIT $%d", len(args)+1)
	args = append(args, limit)
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("intelligence.Episodes.SearchSimilar: %w", err)
	}
	defer rows.Close()
	scored, err := scanEpisodesWithScore(rows)
	if err != nil {
		return nil, fmt.Errorf("intelligence.Episodes.SearchSimilar: %w", err)
	}
	return scored, nil
}

// PendingEmbeddings — async worker hot-loop. Partial index покрывает.
func (r *Episodes) PendingEmbeddings(ctx context.Context, limit int) ([]domain.Episode, error) {
	if limit <= 0 || limit > 256 {
		limit = 64
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, kind, summary, payload,
		        (SELECT name FROM embedding_models WHERE id = embedding_model_id) AS embedding_model,
		        embedded_at, occurred_at, created_at
		   FROM coach_episodes
		  WHERE embedded_at IS NULL
		  ORDER BY created_at ASC
		  LIMIT $1`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.Episodes.PendingEmbeddings: %w", err)
	}
	defer rows.Close()
	return scanEpisodes(rows)
}

// SetEmbedding writes the vector + model + embedded_at=now.
//
// R9: legacy real[] coach_episodes.embedding column dropped (00079);
// pgvector embedding_vec is now the single source of truth for similarity.
func (r *Episodes) SetEmbedding(ctx context.Context, id uuid.UUID, vec []float32, model string) error {
	if len(vec) == 0 {
		return fmt.Errorf("intelligence.Episodes.SetEmbedding: empty vector")
	}
	tag, err := r.pool.Exec(ctx,
		`UPDATE coach_episodes
		    SET embedding_vec = NULLIF($2, '')::vector,
		        embedding_model_id = (SELECT id FROM embedding_models WHERE name = $3),
		        embedded_at = now()
		  WHERE id = $1`,
		sharedpg.UUID(id), sharedpg.VectorString(vec), model,
	)
	if err != nil {
		return fmt.Errorf("intelligence.Episodes.SetEmbedding: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrEpisodeNotFound
	}
	return nil
}

// MarkStaleForReembed — Phase I admin tool. Clears embedded_at for every
// episode whose vector was produced by a model OTHER than
// currentModelName. The async embed worker re-embeds via the same
// `WHERE embedded_at IS NULL` partial index. Returns rows-affected count.
func (r *Episodes) MarkStaleForReembed(ctx context.Context, currentModelName string) (int64, error) {
	if currentModelName == "" {
		return 0, fmt.Errorf("intelligence.Episodes.MarkStaleForReembed: currentModelName is required")
	}
	tag, err := r.pool.Exec(ctx,
		`UPDATE coach_episodes
		    SET embedded_at = NULL
		  WHERE embedded_at IS NOT NULL
		    AND embedding_vec IS NOT NULL
		    AND embedding_model_id IS DISTINCT FROM
		        (SELECT id FROM embedding_models WHERE name = $1)`,
		currentModelName,
	)
	if err != nil {
		return 0, fmt.Errorf("intelligence.Episodes.MarkStaleForReembed: %w", err)
	}
	return tag.RowsAffected(), nil
}

// Stats30d — total + per-kind. Дёшево: один scan + group by.
func (r *Episodes) Stats30d(ctx context.Context, userID uuid.UUID) (domain.MemoryStats, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT kind, count(*)
		   FROM coach_episodes
		  WHERE user_id = $1
		    AND occurred_at >= now() - INTERVAL '30 days'
		  GROUP BY kind`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return domain.MemoryStats{}, fmt.Errorf("intelligence.Episodes.Stats30d: %w", err)
	}
	defer rows.Close()
	out := domain.MemoryStats{ByKind: make(map[domain.EpisodeKind]int)}
	for rows.Next() {
		var (
			kind  string
			count int
		)
		if err := rows.Scan(&kind, &count); err != nil {
			return domain.MemoryStats{}, fmt.Errorf("intelligence.Episodes.Stats30d scan: %w", err)
		}
		k := domain.EpisodeKind(kind)
		out.ByKind[k] = count
		out.TotalLast30d += count
	}
	if err := rows.Err(); err != nil {
		return domain.MemoryStats{}, fmt.Errorf("intelligence.Episodes.Stats30d rows: %w", err)
	}
	return out, nil
}

// GetBriefRecommendations — ищет owned brief_emitted с payload.brief_id ==
// briefID (UUID хранится как jsonb-string). Возвращает массив recommendations.
func (r *Episodes) GetBriefRecommendations(ctx context.Context, userID, briefID uuid.UUID) ([]domain.Recommendation, error) {
	var raw []byte
	err := r.pool.QueryRow(ctx,
		`SELECT payload
		   FROM coach_episodes
		  WHERE user_id = $1 AND kind = 'brief_emitted' AND payload->>'brief_id' = $2
		  ORDER BY created_at DESC LIMIT 1`,
		sharedpg.UUID(userID),
		briefID.String(),
	).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrEpisodeNotFound
		}
		return nil, fmt.Errorf("intelligence.Episodes.GetBriefRecommendations: %w", err)
	}
	var p struct {
		Recommendations []recommendationPayload `json:"recommendations"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, fmt.Errorf("intelligence.Episodes.GetBriefRecommendations: unmarshal: %w", err)
	}
	out := make([]domain.Recommendation, 0, len(p.Recommendations))
	for _, r := range p.Recommendations {
		k := domain.RecommendationKind(r.Kind)
		if !k.IsValid() {
			continue
		}
		out = append(out, domain.Recommendation{
			Kind: k, Title: r.Title, Rationale: r.Rationale, TargetID: r.TargetID,
		})
	}
	return out, nil
}

// ─── helpers ────────────────────────────────────────────────────────────

func scanEpisodes(rows pgx.Rows) ([]domain.Episode, error) {
	var out []domain.Episode
	for rows.Next() {
		var (
			id, userID     pgtype.UUID
			kind           string
			summary        string
			payload        []byte
			embeddingModel pgtype.Text
			embeddedAt     pgtype.Timestamptz
			occurredAt     time.Time
			createdAt      time.Time
		)
		if err := rows.Scan(&id, &userID, &kind, &summary, &payload,
			&embeddingModel, &embeddedAt, &occurredAt, &createdAt); err != nil {
			return nil, fmt.Errorf("scanEpisodes: %w", err)
		}
		ep := domain.Episode{
			ID:         sharedpg.UUIDFrom(id),
			UserID:     sharedpg.UUIDFrom(userID),
			Kind:       domain.EpisodeKind(kind),
			Summary:    summary,
			Payload:    payload,
			OccurredAt: occurredAt,
			CreatedAt:  createdAt,
		}
		if embeddingModel.Valid {
			ep.EmbeddingModel = embeddingModel.String
		}
		if embeddedAt.Valid {
			t := embeddedAt.Time
			ep.EmbeddedAt = &t
		}
		out = append(out, ep)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scanEpisodes rows: %w", err)
	}
	return out, nil
}

// scanEpisodesWithScore — scanEpisodes + similarity column (последняя в SELECT).
// Используется только SearchSimilar.
func scanEpisodesWithScore(rows pgx.Rows) ([]domain.EpisodeWithScore, error) {
	var out []domain.EpisodeWithScore
	for rows.Next() {
		var (
			id, userID     pgtype.UUID
			kind           string
			summary        string
			payload        []byte
			embeddingModel pgtype.Text
			embeddedAt     pgtype.Timestamptz
			occurredAt     time.Time
			createdAt      time.Time
			similarity     float64
		)
		if err := rows.Scan(&id, &userID, &kind, &summary, &payload,
			&embeddingModel, &embeddedAt, &occurredAt, &createdAt, &similarity); err != nil {
			return nil, fmt.Errorf("scanEpisodesWithScore: %w", err)
		}
		ep := domain.Episode{
			ID:         sharedpg.UUIDFrom(id),
			UserID:     sharedpg.UUIDFrom(userID),
			Kind:       domain.EpisodeKind(kind),
			Summary:    summary,
			Payload:    payload,
			OccurredAt: occurredAt,
			CreatedAt:  createdAt,
		}
		if embeddingModel.Valid {
			ep.EmbeddingModel = embeddingModel.String
		}
		if embeddedAt.Valid {
			t := embeddedAt.Time
			ep.EmbeddedAt = &t
		}
		out = append(out, domain.EpisodeWithScore{Episode: ep, Score: float32(similarity)})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scanEpisodesWithScore rows: %w", err)
	}
	return out, nil
}

// DeleteOlderThan removes episodes whose occurred_at is strictly older than
// the cutoff. Returns the number of rows deleted. Bounded retention keeps
// the table from growing without limit and keeps Recall windows clean.
func (r *Episodes) DeleteOlderThan(ctx context.Context, cutoff time.Time) (int64, error) {
	cmd, err := r.pool.Exec(ctx,
		`DELETE FROM coach_episodes WHERE occurred_at < $1`,
		cutoff,
	)
	if err != nil {
		return 0, fmt.Errorf("intelligence.Episodes.DeleteOlderThan: %w", err)
	}
	return cmd.RowsAffected(), nil
}

// CountByKindInRange — Phase 4.5. Single GROUP BY query. weekly_memory_summary
// исключаем сами из результата чтобы prior consolidations не двоились.
func (r *Episodes) CountByKindInRange(ctx context.Context, userID uuid.UUID, from, to time.Time) (map[domain.EpisodeKind]int, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT kind, COUNT(*)::int4
		   FROM coach_episodes
		  WHERE user_id    = $1
		    AND occurred_at >= $2
		    AND occurred_at <  $3
		    AND kind       <> $4
		  GROUP BY kind`,
		sharedpg.UUID(userID), from, to, string(domain.EpisodeWeeklyMemorySummary),
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.Episodes.CountByKindInRange: %w", err)
	}
	defer rows.Close()
	out := make(map[domain.EpisodeKind]int, 8)
	for rows.Next() {
		var (
			kind  string
			count int32
		)
		if err := rows.Scan(&kind, &count); err != nil {
			return nil, fmt.Errorf("intelligence.Episodes.CountByKindInRange: scan: %w", err)
		}
		out[domain.EpisodeKind(kind)] = int(count)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.Episodes.CountByKindInRange: rows: %w", err)
	}
	return out, nil
}

// HasWeeklySummary — Phase 4.5. Идемпотентность для consolidator: при
// повторном вызове за ту же неделю не дублируем episode. Сравниваем по
// payload.week_start (RFC3339 timestamp начала недели).
func (r *Episodes) HasWeeklySummary(ctx context.Context, userID uuid.UUID, weekStart time.Time) (bool, error) {
	weekStartUTC := weekStart.UTC().Format(time.RFC3339)
	// W13: was COUNT(*) for an existence check — replaced with EXISTS so the
	// planner can short-circuit on the first match against coach_episodes.
	var exists bool
	err := r.pool.QueryRow(ctx,
		`SELECT EXISTS (
		    SELECT 1
		      FROM coach_episodes
		     WHERE user_id = $1
		       AND kind    = $2
		       AND payload->>'week_start' = $3
		 )`,
		sharedpg.UUID(userID), string(domain.EpisodeWeeklyMemorySummary), weekStartUTC,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("intelligence.Episodes.HasWeeklySummary: %w", err)
	}
	return exists, nil
}
