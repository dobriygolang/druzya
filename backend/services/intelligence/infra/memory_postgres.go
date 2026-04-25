// Memory layer pgx adapter — coach_episodes table.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
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

// Append inserts one episode. Embedding is optional (worker fills it
// later if NULL on insert).
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
		    (user_id, kind, summary, payload, embedding, embedding_model, embedded_at, occurred_at)
		 VALUES ($1, $2, $3, $4::jsonb, $5, NULLIF($6, ''), $7,
		         COALESCE(NULLIF($8, '0001-01-01 00:00:00+00'::timestamptz), now()))`,
		sharedpg.UUID(e.UserID),
		string(e.Kind),
		e.Summary,
		string(payload),
		nullableFloat32Slice(e.Embedding),
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
		`SELECT id, user_id, kind, summary, payload, embedding, embedding_model,
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
			`SELECT id, user_id, kind, summary, payload, embedding, embedding_model,
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
		`SELECT id, user_id, kind, summary, payload, embedding, embedding_model,
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

// SearchSimilar returns top-K by cosine. Filtering by kinds — optional.
// Берём всех с непустым embedding'ом (limit*4 candidates по recency), считаем
// cosine in Go, сортируем. Для размеров корпуса <10k за пользователя — ОК;
// >10k надо будет переехать на pgvector (см. 00011 header).
func (r *Episodes) SearchSimilar(ctx context.Context, userID uuid.UUID, vec []float32, kinds []domain.EpisodeKind, limit int) ([]domain.EpisodeWithScore, error) {
	if len(vec) == 0 {
		return nil, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 8
	}
	candCap := limit * 8
	if candCap < 64 {
		candCap = 64
	}
	var (
		rows pgx.Rows
		err  error
	)
	if len(kinds) == 0 {
		rows, err = r.pool.Query(ctx,
			`SELECT id, user_id, kind, summary, payload, embedding, embedding_model,
			        embedded_at, occurred_at, created_at
			   FROM coach_episodes
			  WHERE user_id = $1 AND embedding IS NOT NULL
			  ORDER BY occurred_at DESC
			  LIMIT $2`,
			sharedpg.UUID(userID), candCap,
		)
	} else {
		kindStrs := make([]string, len(kinds))
		for i, k := range kinds {
			kindStrs[i] = string(k)
		}
		rows, err = r.pool.Query(ctx,
			`SELECT id, user_id, kind, summary, payload, embedding, embedding_model,
			        embedded_at, occurred_at, created_at
			   FROM coach_episodes
			  WHERE user_id = $1 AND embedding IS NOT NULL AND kind = ANY($2::text[])
			  ORDER BY occurred_at DESC
			  LIMIT $3`,
			sharedpg.UUID(userID), kindStrs, candCap,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("intelligence.Episodes.SearchSimilar: %w", err)
	}
	defer rows.Close()
	cands, err := scanEpisodes(rows)
	if err != nil {
		return nil, err
	}
	scored := make([]domain.EpisodeWithScore, 0, len(cands))
	for _, c := range cands {
		s := cosine32(vec, c.Embedding)
		if s > 0 {
			scored = append(scored, domain.EpisodeWithScore{Episode: c, Score: s})
		}
	}
	sort.Slice(scored, func(i, j int) bool { return scored[i].Score > scored[j].Score })
	if len(scored) > limit {
		scored = scored[:limit]
	}
	return scored, nil
}

// PendingEmbeddings — async worker hot-loop. Partial index покрывает.
func (r *Episodes) PendingEmbeddings(ctx context.Context, limit int) ([]domain.Episode, error) {
	if limit <= 0 || limit > 256 {
		limit = 64
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id, user_id, kind, summary, payload, embedding, embedding_model,
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
func (r *Episodes) SetEmbedding(ctx context.Context, id uuid.UUID, vec []float32, model string) error {
	if len(vec) == 0 {
		return fmt.Errorf("intelligence.Episodes.SetEmbedding: empty vector")
	}
	tag, err := r.pool.Exec(ctx,
		`UPDATE coach_episodes
		    SET embedding = $2,
		        embedding_model = $3,
		        embedded_at = now()
		  WHERE id = $1`,
		sharedpg.UUID(id), nullableFloat32Slice(vec), model,
	)
	if err != nil {
		return fmt.Errorf("intelligence.Episodes.SetEmbedding: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrEpisodeNotFound
	}
	return nil
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

// GetBriefRecommendations — ищет brief_emitted с payload.brief_id == briefID
// (UUID хранится как jsonb-string). Возвращает массив recommendations.
func (r *Episodes) GetBriefRecommendations(ctx context.Context, briefID uuid.UUID) ([]domain.Recommendation, error) {
	var raw []byte
	err := r.pool.QueryRow(ctx,
		`SELECT payload
		   FROM coach_episodes
		  WHERE kind = 'brief_emitted' AND payload->>'brief_id' = $1
		  ORDER BY created_at DESC LIMIT 1`,
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
			embedding      []float32
			embeddingModel pgtype.Text
			embeddedAt     pgtype.Timestamptz
			occurredAt     time.Time
			createdAt      time.Time
		)
		if err := rows.Scan(&id, &userID, &kind, &summary, &payload, &embedding,
			&embeddingModel, &embeddedAt, &occurredAt, &createdAt); err != nil {
			return nil, fmt.Errorf("scanEpisodes: %w", err)
		}
		ep := domain.Episode{
			ID:         sharedpg.UUIDFrom(id),
			UserID:     sharedpg.UUIDFrom(userID),
			Kind:       domain.EpisodeKind(kind),
			Summary:    summary,
			Payload:    payload,
			Embedding:  embedding,
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

// nullableFloat32Slice returns nil for empty slices so pg writes SQL NULL
// (otherwise pgx encodes as empty real[] which is non-NULL but empty).
func nullableFloat32Slice(v []float32) any {
	if len(v) == 0 {
		return nil
	}
	return v
}

// cosine32 — cosine similarity на float32. 0 если любая длина = 0.
func cosine32(a, b []float32) float32 {
	if len(a) == 0 || len(b) == 0 || len(a) != len(b) {
		return 0
	}
	var dot, na, nb float64
	for i := 0; i < len(a); i++ {
		dot += float64(a[i]) * float64(b[i])
		na += float64(a[i]) * float64(a[i])
		nb += float64(b[i]) * float64(b[i])
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return float32(dot / (math.Sqrt(na) * math.Sqrt(nb)))
}
