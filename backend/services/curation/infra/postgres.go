// Package infra — Phase 3.5 postgres adapters для curation overrides.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/curation/app"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── OverrideRepo ────────────────────────────────────────────────────────

type Overrides struct {
	pool *pgxpool.Pool
}

func NewOverrides(p *pgxpool.Pool) *Overrides { return &Overrides{pool: p} }

func (r *Overrides) Insert(ctx context.Context, ov app.Override) (app.Override, error) {
	var (
		nodeID *string
		trkID  *uuid.UUID
		stpIdx *int16
	)
	if ov.Target.AtlasNodeID != "" {
		s := ov.Target.AtlasNodeID
		nodeID = &s
	}
	if ov.Target.StepTrackID != nil {
		trkID = ov.Target.StepTrackID
	}
	if ov.Target.StepIndex != nil {
		stpIdx = ov.Target.StepIndex
	}
	row := r.pool.QueryRow(ctx, `
INSERT INTO user_resource_overrides
  (user_id, atlas_node_id, step_track_id, step_index, url, action, payload, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
ON CONFLICT DO NOTHING
RETURNING id, created_at
`, ov.UserID, nodeID, trkID, stpIdx, ov.URL, string(ov.Action), ov.Payload, ov.CreatedAt)
	if err := row.Scan(&ov.ID, &ov.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Conflict — лoad the existing row.
			loadRow := r.pool.QueryRow(ctx, `
SELECT id, created_at FROM user_resource_overrides
WHERE user_id=$1 AND COALESCE(atlas_node_id,'')=COALESCE($2,'')
  AND COALESCE(step_track_id::text,'')=COALESCE($3::text,'')
  AND COALESCE(step_index,-1)=COALESCE($4,-1)
  AND url=$5 AND action=$6
`, ov.UserID, nodeID, trkID, stpIdx, ov.URL, string(ov.Action))
			if err2 := loadRow.Scan(&ov.ID, &ov.CreatedAt); err2 != nil {
				return app.Override{}, fmt.Errorf("curation.Overrides.Insert (load on conflict): %w", err2)
			}
			return ov, nil
		}
		return app.Override{}, fmt.Errorf("curation.Overrides.Insert: %w", err)
	}
	return ov, nil
}

func (r *Overrides) List(ctx context.Context, userID uuid.UUID, t app.Target) ([]app.Override, error) {
	// Phase R5: hard LIMIT 500 cap as a defensive guard. Per-user
	// per-target overrides typically count under 50 (a single user has
	// O(skills) overrides, not O(users)). Cap protects against runaway
	// growth from bulk-import or test fixtures.
	rows, err := r.pool.Query(ctx, `
SELECT id, user_id, atlas_node_id, step_track_id, step_index,
       url, action, payload, auto_promoted_at, created_at
FROM user_resource_overrides
WHERE user_id=$1
  AND ($2::text IS NULL OR atlas_node_id=$2)
  AND ($3::uuid IS NULL OR step_track_id=$3)
  AND ($4::int  IS NULL OR step_index=$4)
ORDER BY created_at ASC
LIMIT 500
`, userID, nullableNode(t.AtlasNodeID), t.StepTrackID, t.StepIndex)
	if err != nil {
		return nil, fmt.Errorf("curation.Overrides.List: %w", err)
	}
	defer rows.Close()
	var out []app.Override
	for rows.Next() {
		var (
			ov     app.Override
			nodeID *string
			trkID  *uuid.UUID
			stpIdx *int16
			action string
		)
		if err := rows.Scan(&ov.ID, &ov.UserID, &nodeID, &trkID, &stpIdx,
			&ov.URL, &action, &ov.Payload, &ov.AutoPromotedAt, &ov.CreatedAt); err != nil {
			return nil, fmt.Errorf("curation.Overrides.List scan: %w", err)
		}
		if nodeID != nil {
			ov.Target.AtlasNodeID = *nodeID
		}
		ov.Target.StepTrackID = trkID
		ov.Target.StepIndex = stpIdx
		ov.Action = app.OverrideAction(action)
		out = append(out, ov)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("curation.Overrides.List rows: %w", err)
	}
	return out, nil
}

func (r *Overrides) DeleteByURL(ctx context.Context, userID uuid.UUID, t app.Target, url string, action app.OverrideAction) error {
	_, err := r.pool.Exec(ctx, `
DELETE FROM user_resource_overrides
WHERE user_id=$1 AND url=$2 AND action=$3
  AND ($4::text IS NULL OR atlas_node_id=$4)
  AND ($5::uuid IS NULL OR step_track_id=$5)
  AND ($6::int  IS NULL OR step_index=$6)
`, userID, url, string(action), nullableNode(t.AtlasNodeID), t.StepTrackID, t.StepIndex)
	if err != nil {
		return fmt.Errorf("curation.Overrides.DeleteByURL: %w", err)
	}
	return nil
}

func nullableNode(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ─── PromotionTracker ────────────────────────────────────────────────────

type Promotion struct {
	pool *pgxpool.Pool
}

func NewPromotion(p *pgxpool.Pool) *Promotion { return &Promotion{pool: p} }

func (p *Promotion) BumpAdded(ctx context.Context, url, atlasNodeID string) error {
	_, err := p.pool.Exec(ctx, `
INSERT INTO resource_promotion_signals (url, atlas_node_id, user_count, last_user_added_at)
VALUES ($1, $2, 1, now())
ON CONFLICT (url) DO UPDATE
SET user_count = resource_promotion_signals.user_count + 1,
    last_user_added_at = now()
`, url, atlasNodeID)
	if err != nil {
		return fmt.Errorf("curation.Promotion.BumpAdded: %w", err)
	}
	return nil
}

func (p *Promotion) UpdateQuality(ctx context.Context, url string, quality float32) error {
	// Running average: avg' = (avg*n + new) / (n+1) реализуем на SQL.
	_, err := p.pool.Exec(ctx, `
UPDATE resource_promotion_signals
SET avg_quality = COALESCE(
    (avg_quality * GREATEST(user_count - 1, 0) + $2) / GREATEST(user_count, 1),
    $2
  )
WHERE url = $1
`, url, quality)
	if err != nil {
		return fmt.Errorf("curation.Promotion.UpdateQuality: %w", err)
	}
	return nil
}

// PromoteCandidates — для auto_promote producer'а.
type PromotionCandidate struct {
	URL             string
	AtlasNodeID     string
	UserCount       int
	AvgQuality      float32
	LastUserAddedAt string
}

func (p *Promotion) Candidates(ctx context.Context, minUsers int, minQuality float32) ([]PromotionCandidate, error) {
	rows, err := p.pool.Query(ctx, `
SELECT url, atlas_node_id, user_count, COALESCE(avg_quality,0), last_user_added_at::text
FROM resource_promotion_signals
WHERE promoted_at IS NULL
  AND blocked_reason IS NULL
  AND user_count >= $1
  AND COALESCE(avg_quality,0) >= $2
  AND last_user_added_at < now() - interval '24 hours'
ORDER BY user_count DESC, avg_quality DESC
LIMIT 100
`, minUsers, minQuality)
	if err != nil {
		return nil, fmt.Errorf("curation.Promotion.Candidates: %w", err)
	}
	defer rows.Close()
	var out []PromotionCandidate
	for rows.Next() {
		var c PromotionCandidate
		if err := rows.Scan(&c.URL, &c.AtlasNodeID, &c.UserCount, &c.AvgQuality, &c.LastUserAddedAt); err != nil {
			return nil, fmt.Errorf("curation.Promotion.Candidates scan: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("curation.Promotion.Candidates rows: %w", err)
	}
	return out, nil
}

func (p *Promotion) MarkPromoted(ctx context.Context, url string) error {
	_, err := p.pool.Exec(ctx, `
UPDATE resource_promotion_signals SET promoted_at = now() WHERE url=$1
`, url)
	if err != nil {
		return fmt.Errorf("curation.Promotion.MarkPromoted: %w", err)
	}
	return nil
}

func (p *Promotion) MarkBlocked(ctx context.Context, url, reason string) error {
	_, err := p.pool.Exec(ctx, `
UPDATE resource_promotion_signals SET blocked_reason=$2 WHERE url=$1
`, url, reason)
	if err != nil {
		return fmt.Errorf("curation.Promotion.MarkBlocked: %w", err)
	}
	return nil
}

// ─── DomainReputationRepo ────────────────────────────────────────────────

type Reputation struct {
	pool *pgxpool.Pool
}

func NewReputation(p *pgxpool.Pool) *Reputation { return &Reputation{pool: p} }

func (r *Reputation) BumpUnhelpful(ctx context.Context, host string) error {
	_, err := r.pool.Exec(ctx, `
INSERT INTO domain_reputation (domain, unhelpful_count) VALUES ($1, 1)
ON CONFLICT (domain) DO UPDATE
SET unhelpful_count = domain_reputation.unhelpful_count + 1,
    last_seen = now(),
    blocked = (domain_reputation.unhelpful_count + 1 >= 10)
`, host)
	if err != nil {
		return fmt.Errorf("curation.Reputation.BumpUnhelpful: %w", err)
	}
	return nil
}

func (r *Reputation) IsBlocked(ctx context.Context, host string) (bool, error) {
	var blocked bool
	err := r.pool.QueryRow(ctx, `SELECT COALESCE(blocked, false) FROM domain_reputation WHERE domain=$1`, host).Scan(&blocked)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("curation.Reputation.IsBlocked: %w", err)
	}
	return blocked, nil
}

// ─── AutoPromoteRepo (F6 daemon) ─────────────────────────────────────────
//
// Postgres-backed Reader + Writer implementations for
// curation/app.AutoPromote. The repo intentionally exposes the union of
// both port surfaces — same pool, same table — so the cron wiring takes
// a single *AutoPromoteRepo.

type AutoPromoteRepo struct {
	pool *pgxpool.Pool
}

func NewAutoPromoteRepo(p *pgxpool.Pool) *AutoPromoteRepo { return &AutoPromoteRepo{pool: p} }

// RecentLoggedURLs — distinct (url, atlas_node_id) pairs touched since
// `since` with kind in ('finished','reflection_submitted'). reflection
// rows are included because reflection_quality_score travels with them
// and AggregateSignal needs to fold it into avg_quality.
//
// MAX(atlas_node_id) picks the last seen node for an orphan-or-bound
// resource; the cron's UC will leave it blank when the resource is
// orphan throughout.
func (r *AutoPromoteRepo) RecentLoggedURLs(ctx context.Context, since time.Time) ([]app.LoggedResource, error) {
	rows, err := r.pool.Query(ctx, `
SELECT resource_url, COALESCE(MAX(atlas_node_id), '')
FROM user_resource_log
WHERE occurred_at >= $1
  AND kind IN ('finished','reflection_submitted')
GROUP BY resource_url
LIMIT 1000
`, since)
	if err != nil {
		return nil, fmt.Errorf("curation.AutoPromoteRepo.RecentLoggedURLs: %w", err)
	}
	defer rows.Close()
	var out []app.LoggedResource
	for rows.Next() {
		var lr app.LoggedResource
		if err := rows.Scan(&lr.URL, &lr.AtlasNodeID); err != nil {
			return nil, fmt.Errorf("curation.AutoPromoteRepo.RecentLoggedURLs scan: %w", err)
		}
		out = append(out, lr)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("curation.AutoPromoteRepo.RecentLoggedURLs rows: %w", err)
	}
	return out, nil
}

// AggregateSignal — full-history aggregate per URL.
//   - user_count   = distinct users who logged kind='finished'
//   - avg_quality  = AVG(reflection_quality_score) over rows that have it
//   - atlas_node_id = MAX(atlas_node_id) (last seen wins; "" if always NULL)
//   - last_logged_at = MAX(occurred_at) across both kinds
func (r *AutoPromoteRepo) AggregateSignal(ctx context.Context, url string) (app.SignalRefresh, error) {
	var (
		out         app.SignalRefresh
		avgQuality  *float32
		nodeID      *string
		lastLogged  *time.Time
		userCount   int
	)
	err := r.pool.QueryRow(ctx, `
SELECT
  COUNT(DISTINCT user_id) FILTER (WHERE kind = 'finished'),
  AVG(reflection_quality_score)::real
    FILTER (WHERE reflection_quality_score IS NOT NULL),
  MAX(atlas_node_id),
  MAX(occurred_at)
FROM user_resource_log
WHERE resource_url = $1
`, url).Scan(&userCount, &avgQuality, &nodeID, &lastLogged)
	if err != nil {
		return out, fmt.Errorf("curation.AutoPromoteRepo.AggregateSignal: %w", err)
	}
	out.URL = url
	out.UserCount = userCount
	if avgQuality != nil {
		out.AvgQuality = *avgQuality
		out.HasQuality = true
	}
	if nodeID != nil {
		out.AtlasNodeID = *nodeID
	}
	if lastLogged != nil {
		out.LastLoggedAt = *lastLogged
	}
	return out, nil
}

// RefreshSignal — upsert into resource_promotion_signals.
//
// On conflict we overwrite user_count + avg_quality + last_user_added_at
// from the aggregate. atlas_node_id is set on first insert only — once a
// row is established the BumpAdded path keeps it stable; the daemon
// avoids stomping a curated mapping with a possibly-stale log value.
//
// avg_quality is left NULL when the aggregate has no quality samples
// (HasQuality=false). Promote/deprecate filters use COALESCE so a NULL
// row falls below the threshold either way.
func (r *AutoPromoteRepo) RefreshSignal(ctx context.Context, in app.SignalRefresh) error {
	if in.URL == "" {
		return fmt.Errorf("curation.AutoPromoteRepo.RefreshSignal: empty url")
	}
	// atlas_node_id is NOT NULL in the table — if we have neither a log
	// value nor a prior row to inherit from, we skip the upsert (logged
	// for visibility). Real flow: AddResource path always seeds the row
	// with a node, so this only triggers for orphan finishes on URLs
	// no one ever added — nothing to promote anyway.
	if in.AtlasNodeID == "" {
		_, err := r.pool.Exec(ctx, `
UPDATE resource_promotion_signals
SET user_count         = $2,
    avg_quality        = CASE WHEN $4 THEN $3::real ELSE avg_quality END,
    last_user_added_at = COALESCE($5::timestamptz, last_user_added_at)
WHERE url = $1
`, in.URL, in.UserCount, in.AvgQuality, in.HasQuality, nullableTime(in.LastLoggedAt))
		if err != nil {
			return fmt.Errorf("curation.AutoPromoteRepo.RefreshSignal update: %w", err)
		}
		return nil
	}
	_, err := r.pool.Exec(ctx, `
INSERT INTO resource_promotion_signals
  (url, atlas_node_id, user_count, avg_quality, last_user_added_at)
VALUES ($1, $2, $3, CASE WHEN $5 THEN $4::real ELSE NULL END, COALESCE($6::timestamptz, now()))
ON CONFLICT (url) DO UPDATE
SET user_count         = EXCLUDED.user_count,
    avg_quality        = CASE WHEN $5 THEN EXCLUDED.avg_quality ELSE resource_promotion_signals.avg_quality END,
    last_user_added_at = COALESCE(EXCLUDED.last_user_added_at, resource_promotion_signals.last_user_added_at)
`, in.URL, in.AtlasNodeID, in.UserCount, in.AvgQuality, in.HasQuality, nullableTime(in.LastLoggedAt))
	if err != nil {
		return fmt.Errorf("curation.AutoPromoteRepo.RefreshSignal upsert: %w", err)
	}
	return nil
}

// PromoteCandidates — F6 heuristic: enough users + good avg quality +
// not promoted, not deprecated, not blocked.
func (r *AutoPromoteRepo) PromoteCandidates(ctx context.Context, minUsers int, minQuality float32) ([]app.PromotionSignal, error) {
	rows, err := r.pool.Query(ctx, `
SELECT url, atlas_node_id, user_count, COALESCE(avg_quality,0)::real
FROM resource_promotion_signals
WHERE promoted_at      IS NULL
  AND deprecated_at    IS NULL
  AND blocked_reason   IS NULL
  AND user_count       >= $1
  AND COALESCE(avg_quality,0) >= $2
ORDER BY user_count DESC, avg_quality DESC NULLS LAST
LIMIT 200
`, minUsers, minQuality)
	if err != nil {
		return nil, fmt.Errorf("curation.AutoPromoteRepo.PromoteCandidates: %w", err)
	}
	defer rows.Close()
	var out []app.PromotionSignal
	for rows.Next() {
		var c app.PromotionSignal
		if err := rows.Scan(&c.URL, &c.AtlasNodeID, &c.UserCount, &c.AvgQuality); err != nil {
			return nil, fmt.Errorf("curation.AutoPromoteRepo.PromoteCandidates scan: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("curation.AutoPromoteRepo.PromoteCandidates rows: %w", err)
	}
	return out, nil
}

// DeprecateCandidates — F6 heuristic: enough users have voted but the
// rolling avg is bad, and we haven't deprecated yet. blocked rows are
// skipped (they were already pulled out of catalogue).
func (r *AutoPromoteRepo) DeprecateCandidates(ctx context.Context, minUsers int, maxBadQuality float32) ([]app.PromotionSignal, error) {
	rows, err := r.pool.Query(ctx, `
SELECT url, atlas_node_id, user_count, COALESCE(avg_quality,0)::real
FROM resource_promotion_signals
WHERE deprecated_at IS NULL
  AND blocked_reason IS NULL
  AND user_count    >= $1
  AND avg_quality   IS NOT NULL
  AND avg_quality   <= $2
ORDER BY avg_quality ASC, user_count DESC
LIMIT 200
`, minUsers, maxBadQuality)
	if err != nil {
		return nil, fmt.Errorf("curation.AutoPromoteRepo.DeprecateCandidates: %w", err)
	}
	defer rows.Close()
	var out []app.PromotionSignal
	for rows.Next() {
		var c app.PromotionSignal
		if err := rows.Scan(&c.URL, &c.AtlasNodeID, &c.UserCount, &c.AvgQuality); err != nil {
			return nil, fmt.Errorf("curation.AutoPromoteRepo.DeprecateCandidates scan: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("curation.AutoPromoteRepo.DeprecateCandidates rows: %w", err)
	}
	return out, nil
}

// MarkPromoted — idempotent set of promoted_at. The partial-index filter
// on PromoteCandidates ensures we never call this on an already-promoted
// row, but the UPDATE itself is also safe (sets the column to now()
// unconditionally, but the row is filtered out next tick anyway).
func (r *AutoPromoteRepo) MarkPromoted(ctx context.Context, url string) error {
	_, err := r.pool.Exec(ctx, `
UPDATE resource_promotion_signals
SET promoted_at = now()
WHERE url = $1
  AND promoted_at IS NULL
`, url)
	if err != nil {
		return fmt.Errorf("curation.AutoPromoteRepo.MarkPromoted: %w", err)
	}
	return nil
}

// MarkDeprecated — idempotent set of deprecated_at + reason.
func (r *AutoPromoteRepo) MarkDeprecated(ctx context.Context, url, reason string) error {
	_, err := r.pool.Exec(ctx, `
UPDATE resource_promotion_signals
SET deprecated_at     = now(),
    deprecated_reason = $2
WHERE url = $1
  AND deprecated_at IS NULL
`, url, reason)
	if err != nil {
		return fmt.Errorf("curation.AutoPromoteRepo.MarkDeprecated: %w", err)
	}
	return nil
}

// AppendAtlasResource — jsonb append into atlas_nodes.external_resources.
// Identical shape to the LLM-validated cron's writer, but with
// `auto_promoted=true` AND `heuristic=true` so admin can tell the two
// flows apart in the catalogue.
//
// Idempotent: NOT EXISTS subquery skips when the URL is already present.
func (r *AutoPromoteRepo) AppendAtlasResource(ctx context.Context, atlasNodeID, url string, userCount int, avgQuality float32) error {
	if atlasNodeID == "" {
		return nil
	}
	entry := map[string]any{
		"url":           url,
		"why":           fmt.Sprintf("user-promoted (heuristic, %d users, q=%.2f)", userCount, avgQuality),
		"priority":      "supplement",
		"auto_promoted": true,
		"heuristic":     true,
	}
	raw, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("curation.AutoPromoteRepo.AppendAtlasResource marshal: %w", err)
	}
	_, err = r.pool.Exec(ctx, `
UPDATE atlas_nodes
SET external_resources = COALESCE(external_resources, '[]'::jsonb) || $2::jsonb
WHERE id = $1
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(external_resources, '[]'::jsonb)) e
    WHERE e->>'url' = $3
  )
`, atlasNodeID, raw, url)
	if err != nil {
		return fmt.Errorf("curation.AutoPromoteRepo.AppendAtlasResource: %w", err)
	}
	return nil
}

func nullableTime(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}
