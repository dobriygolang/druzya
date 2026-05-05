// Package infra — Phase 3.5 postgres adapters для curation overrides.
package infra

import (
	"context"
	"errors"
	"fmt"

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
