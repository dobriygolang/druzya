package infra

import (
	"context"
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

// InsightsPostgres implements domain.InsightRepo over the
// intelligence_insights table introduced in migration 00005.
//
// Severity column is `insight_severity` (postgres enum). We cast on
// both sides via ::text so pgx scans into a plain string slot — same
// pattern mock_pipelines verdict uses; avoids hooking enum OIDs into
// every connection's type registry.
type InsightsPostgres struct{ pool *pgxpool.Pool }

// NewInsightsPostgres wires the adapter.
func NewInsightsPostgres(pool *pgxpool.Pool) *InsightsPostgres {
	if pool == nil {
		panic("intelligence/infra.NewInsightsPostgres: nil pool")
	}
	return &InsightsPostgres{pool: pool}
}

const insightCols = `id, user_id, surface, severity::text, anchor,
    headline, evidence, interpret, lever, deep_link,
    event_id, skill_key, codex_slug, track_id,
    dismissed_at, acted_at, generated_at, expires_at`

// Upsert overwrites the (user_id, surface, anchor) row. Preserves
// dismissed_at and acted_at if they existed — re-generation must not
// resurrect a dismissed insight while the original window is open.
func (r *InsightsPostgres) Upsert(ctx context.Context, in domain.Insight) (domain.Insight, error) {
	if !in.Surface.IsValid() {
		return domain.Insight{}, fmt.Errorf("intelligence.Upsert: invalid surface %q", in.Surface)
	}
	if !in.Severity.IsValid() {
		in.Severity = domain.InsightSeverityNudge
	}
	if in.ID == uuid.Nil {
		in.ID = uuid.New()
	}
	if in.GeneratedAt.IsZero() {
		in.GeneratedAt = time.Now().UTC()
	}
	if in.ExpiresAt.IsZero() {
		in.ExpiresAt = in.GeneratedAt.Add(24 * time.Hour)
	}
	row := r.pool.QueryRow(ctx, `
        INSERT INTO intelligence_insights (
            id, user_id, surface, severity, anchor,
            headline, evidence, interpret, lever, deep_link,
            event_id, skill_key, codex_slug, track_id,
            generated_at, expires_at
        ) VALUES (
            $1, $2, $3, $4::insight_severity, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14,
            $15, $16
        )
        ON CONFLICT (user_id, surface, anchor) DO UPDATE SET
            severity     = EXCLUDED.severity,
            headline     = EXCLUDED.headline,
            evidence     = EXCLUDED.evidence,
            interpret    = EXCLUDED.interpret,
            lever        = EXCLUDED.lever,
            deep_link    = EXCLUDED.deep_link,
            event_id     = EXCLUDED.event_id,
            skill_key    = EXCLUDED.skill_key,
            codex_slug   = EXCLUDED.codex_slug,
            track_id     = EXCLUDED.track_id,
            generated_at = EXCLUDED.generated_at,
            expires_at   = EXCLUDED.expires_at
        RETURNING `+insightCols,
		sharedpg.UUID(in.ID), sharedpg.UUID(in.UserID), string(in.Surface), string(in.Severity), in.Anchor,
		in.Headline, in.Evidence, in.Interpret, in.Lever, in.DeepLink,
		nullableUUID(in.EventID), in.SkillKey, in.CodexSlug, nullableUUID(in.TrackID),
		in.GeneratedAt, in.ExpiresAt,
	)
	out, err := scanInsight(row)
	if err != nil {
		return domain.Insight{}, fmt.Errorf("intelligence.InsightsPostgres.Upsert: %w", err)
	}
	return out, nil
}

// ListLiveBySurface — surface-scoped feed, dismissed/expired filtered
// at SQL layer. Cap is 1..50; default 10 if caller passed 0.
func (r *InsightsPostgres) ListLiveBySurface(
	ctx context.Context,
	userID uuid.UUID,
	surface domain.InsightSurface,
	limit int,
) ([]domain.Insight, error) {
	rows, _, err := r.listLivePaged(ctx, userID, surface, 0, limit, false)
	return rows, err
}

// ListLiveBySurfacePaged — offset+limit variant. Returns rows + total live
// count for (user, surface). Severity-then-recency ordering preserved.
func (r *InsightsPostgres) ListLiveBySurfacePaged(
	ctx context.Context,
	userID uuid.UUID,
	surface domain.InsightSurface,
	offset, limit int,
) ([]domain.Insight, int, error) {
	return r.listLivePaged(ctx, userID, surface, offset, limit, true)
}

// listLivePaged — shared core. withTotal=true triggers COUNT(*) over
// the same predicate and returns it as the second result.
func (r *InsightsPostgres) listLivePaged(
	ctx context.Context,
	userID uuid.UUID,
	surface domain.InsightSurface,
	offset, limit int,
	withTotal bool,
) ([]domain.Insight, int, error) {
	if !surface.IsValid() {
		return nil, 0, fmt.Errorf("intelligence.ListLiveBySurfacePaged: invalid surface %q", surface)
	}
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := r.pool.Query(ctx, `
        SELECT `+insightCols+`
          FROM intelligence_insights
         WHERE user_id = $1
           AND surface = $2
           AND dismissed_at IS NULL
           AND expires_at > now()
         ORDER BY
            CASE severity::text
                WHEN 'critical' THEN 0
                WHEN 'warn' THEN 1
                WHEN 'nudge' THEN 2
                ELSE 3
            END,
            generated_at DESC
         OFFSET $3
         LIMIT $4`,
		sharedpg.UUID(userID), string(surface), offset, limit,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("intelligence.InsightsPostgres.ListLiveBySurfacePaged: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Insight, 0, 8)
	for rows.Next() {
		ins, err := scanInsight(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("intelligence.InsightsPostgres.ListLiveBySurfacePaged: scan: %w", err)
		}
		out = append(out, ins)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("intelligence.InsightsPostgres.ListLiveBySurfacePaged: rows: %w", err)
	}
	total := 0
	if withTotal {
		if err := r.pool.QueryRow(ctx, `
        SELECT COUNT(*)
          FROM intelligence_insights
         WHERE user_id = $1
           AND surface = $2
           AND dismissed_at IS NULL
           AND expires_at > now()`,
			sharedpg.UUID(userID), string(surface),
		).Scan(&total); err != nil {
			return nil, 0, fmt.Errorf("intelligence.InsightsPostgres.ListLiveBySurfacePaged: count: %w", err)
		}
	}
	return out, total, nil
}

// MarkDismissed — idempotent. Updates only when the row exists and
// belongs to the user; missing rows surface as ErrInsightNotFound so
// the port can map to CodeNotFound.
func (r *InsightsPostgres) MarkDismissed(ctx context.Context, userID, insightID uuid.UUID) error {
	cmd, err := r.pool.Exec(ctx, `
        UPDATE intelligence_insights
           SET dismissed_at = COALESCE(dismissed_at, now())
         WHERE id = $1 AND user_id = $2`,
		sharedpg.UUID(insightID), sharedpg.UUID(userID))
	if err != nil {
		return fmt.Errorf("intelligence.InsightsPostgres.MarkDismissed: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrInsightNotFound
	}
	return nil
}

// MarkActed — idempotent.
func (r *InsightsPostgres) MarkActed(ctx context.Context, userID, insightID uuid.UUID) error {
	cmd, err := r.pool.Exec(ctx, `
        UPDATE intelligence_insights
           SET acted_at = COALESCE(acted_at, now())
         WHERE id = $1 AND user_id = $2`,
		sharedpg.UUID(insightID), sharedpg.UUID(userID))
	if err != nil {
		return fmt.Errorf("intelligence.InsightsPostgres.MarkActed: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrInsightNotFound
	}
	return nil
}

// SweepExpired drops rows past expires_at. Called from a cleanup cron.
// Returns count for ops dashboards.
func (r *InsightsPostgres) SweepExpired(ctx context.Context) (int64, error) {
	cmd, err := r.pool.Exec(ctx,
		`DELETE FROM intelligence_insights WHERE expires_at <= now()`)
	if err != nil {
		return 0, fmt.Errorf("intelligence.InsightsPostgres.SweepExpired: %w", err)
	}
	return cmd.RowsAffected(), nil
}

// ── helpers ──────────────────────────────────────────────────────────────

func scanInsight(row pgx.Row) (domain.Insight, error) {
	var (
		id, userID                pgtype.UUID
		surface, severity, anchor string
		headline, evidence, interpret,
		lever, deepLink string
		eventID              pgtype.UUID
		skillKey, codexSlug  string
		trackID              pgtype.UUID
		dismissedAt, actedAt pgtype.Timestamptz
		generatedAt          time.Time
		expiresAt            time.Time
	)
	if err := row.Scan(
		&id, &userID, &surface, &severity, &anchor,
		&headline, &evidence, &interpret, &lever, &deepLink,
		&eventID, &skillKey, &codexSlug, &trackID,
		&dismissedAt, &actedAt, &generatedAt, &expiresAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Insight{}, domain.ErrInsightNotFound
		}
		return domain.Insight{}, fmt.Errorf("intelligence.InsightsPostgres.scan: %w", err)
	}
	out := domain.Insight{
		ID:          sharedpg.UUIDFrom(id),
		UserID:      sharedpg.UUIDFrom(userID),
		Surface:     domain.InsightSurface(surface),
		Severity:    domain.InsightSeverity(severity),
		Anchor:      anchor,
		Headline:    headline,
		Evidence:    evidence,
		Interpret:   interpret,
		Lever:       lever,
		DeepLink:    deepLink,
		SkillKey:    skillKey,
		CodexSlug:   codexSlug,
		GeneratedAt: generatedAt,
		ExpiresAt:   expiresAt,
	}
	if eventID.Valid {
		v := sharedpg.UUIDFrom(eventID)
		out.EventID = &v
	}
	if trackID.Valid {
		v := sharedpg.UUIDFrom(trackID)
		out.TrackID = &v
	}
	if dismissedAt.Valid {
		t := dismissedAt.Time
		out.DismissedAt = &t
	}
	if actedAt.Valid {
		t := actedAt.Time
		out.ActedAt = &t
	}
	return out, nil
}

func nullableUUID(id *uuid.UUID) pgtype.UUID {
	if id == nil || *id == uuid.Nil {
		return pgtype.UUID{}
	}
	return sharedpg.UUID(*id)
}

// Compile-time guard.
var _ domain.InsightRepo = (*InsightsPostgres)(nil)
