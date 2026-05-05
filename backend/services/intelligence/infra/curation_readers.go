// curation_readers.go — Phase 3.5d producer readers.
//
// Поставляет cron'у 4 producer'ам сигналы из user_resource_log + atlas_nodes:
//
//   - CoverageEventReader   — finished/reflection_submitted с quality ≥ 0.7
//   - GapDetectionReader    — для current step prereqs без confirmed coverage
//   - RedundancyReader      — clusters topics with ≥3 high-quality finishes
//   - ConfusionEventReader  — recent reflections с confusion_flag=true
//
// Все readers идут через user_resource_log (00055 + 00065 columns).
package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/intelligence/app/producers"

	"github.com/jackc/pgx/v5/pgxpool"
)

type CurationReader struct {
	pool *pgxpool.Pool
}

func NewCurationReader(p *pgxpool.Pool) *CurationReader { return &CurationReader{pool: p} }

// RecentCoverageEvents — last N days reflection_submitted events с
// quality_score ≥ threshold + non-empty atlas_node_id (otherwise nothing
// to confirm).
func (r *CurationReader) RecentCoverageEvents(ctx context.Context, since time.Time, minQuality float32) ([]producers.CoverageEvent, error) {
	rows, err := r.pool.Query(ctx, `
SELECT atlas_node_id, resource_url, COALESCE(reflection_quality_score, 0), occurred_at
FROM user_resource_log
WHERE kind = 'reflection_submitted'
  AND atlas_node_id IS NOT NULL
  AND COALESCE(reflection_quality_score, 0) >= $1
  AND occurred_at >= $2
ORDER BY occurred_at DESC
LIMIT 500
`, minQuality, since)
	if err != nil {
		return nil, fmt.Errorf("curation_readers.RecentCoverageEvents: %w", err)
	}
	defer rows.Close()
	var out []producers.CoverageEvent
	for rows.Next() {
		var e producers.CoverageEvent
		if err := rows.Scan(&e.AtlasNodeID, &e.ResourceURL, &e.QualityScore, &e.OccurredAt); err != nil {
			return nil, fmt.Errorf("curation_readers.RecentCoverageEvents scan: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("curation_readers.RecentCoverageEvents rows: %w", err)
	}
	return out, nil
}

// RecentConfusionEvents — recent reflections с confusion_flag=true.
func (r *CurationReader) RecentConfusionEvents(ctx context.Context, since time.Time) ([]producers.ConfusionEvent, error) {
	rows, err := r.pool.Query(ctx, `
SELECT user_id::text, COALESCE(atlas_node_id,''), resource_url, COALESCE(reflection_text,''), occurred_at
FROM user_resource_log
WHERE kind = 'reflection_submitted'
  AND confusion_flag = TRUE
  AND occurred_at >= $1
ORDER BY occurred_at DESC
LIMIT 200
`, since)
	if err != nil {
		return nil, fmt.Errorf("curation_readers.RecentConfusionEvents: %w", err)
	}
	defer rows.Close()
	var out []producers.ConfusionEvent
	for rows.Next() {
		var e producers.ConfusionEvent
		if err := rows.Scan(&e.UserID, &e.AtlasNodeID, &e.ResourceURL, &e.ConfusionText, &e.OccurredAt); err != nil {
			return nil, fmt.Errorf("curation_readers.RecentConfusionEvents scan: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("curation_readers.RecentConfusionEvents rows: %w", err)
	}
	return out, nil
}

// HighQualityClustersByTopic — для weekly redundancy_signal. Group by
// atlas_node_id, count finishes с quality ≥ 0.85.
func (r *CurationReader) HighQualityClustersByTopic(ctx context.Context, since time.Time) ([]producers.RedundancyCluster, error) {
	rows, err := r.pool.Query(ctx, `
SELECT atlas_node_id,
       array_agg(resource_url),
       AVG(reflection_quality_score)::real
FROM user_resource_log
WHERE kind = 'reflection_submitted'
  AND atlas_node_id IS NOT NULL
  AND COALESCE(reflection_quality_score, 0) >= 0.85
  AND occurred_at >= $1
GROUP BY atlas_node_id
HAVING COUNT(*) >= 3
LIMIT 100
`, since)
	if err != nil {
		return nil, fmt.Errorf("curation_readers.HighQualityClustersByTopic: %w", err)
	}
	defer rows.Close()
	var out []producers.RedundancyCluster
	for rows.Next() {
		var c producers.RedundancyCluster
		if err := rows.Scan(&c.Topic, &c.Resources, &c.AvgQuality); err != nil {
			return nil, fmt.Errorf("curation_readers.HighQualityClustersByTopic scan: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("curation_readers.HighQualityClustersByTopic rows: %w", err)
	}
	return out, nil
}

// PrereqGaps — для daily gap_detection. Для каждого user'а в active learning
// session находим current_step.skill_keys (≈ atlas-node ids) без confirmed
// coverage в last 30d.
//
// MVP: не хитрит — берёт all-users-with-recent-activity и returns
// {user_id, atlas_node_id} pairs где НЕТ row в user_resource_log с
// reflection_quality_score ≥ 0.7 за last 30d.
func (r *CurationReader) PrereqGaps(ctx context.Context, lookback time.Duration) ([]producers.GapEvent, error) {
	cutoff := time.Now().UTC().Add(-lookback)
	rows, err := r.pool.Query(ctx, `
WITH active_users AS (
  SELECT DISTINCT user_id FROM user_resource_log WHERE occurred_at >= $1
),
confirmed AS (
  SELECT DISTINCT user_id, atlas_node_id
  FROM user_resource_log
  WHERE kind = 'reflection_submitted'
    AND atlas_node_id IS NOT NULL
    AND COALESCE(reflection_quality_score, 0) >= 0.7
    AND occurred_at >= $1
),
recently_touched AS (
  SELECT user_id, atlas_node_id, MAX(occurred_at) AS last_at
  FROM user_resource_log
  WHERE atlas_node_id IS NOT NULL AND occurred_at >= $1
  GROUP BY user_id, atlas_node_id
)
SELECT au.user_id::text, ARRAY_AGG(rt.atlas_node_id) AS missing
FROM active_users au
JOIN recently_touched rt USING(user_id)
LEFT JOIN confirmed c ON c.user_id = au.user_id AND c.atlas_node_id = rt.atlas_node_id
WHERE c.atlas_node_id IS NULL
GROUP BY au.user_id
LIMIT 200
`, cutoff)
	if err != nil {
		return nil, fmt.Errorf("curation_readers.PrereqGaps: %w", err)
	}
	defer rows.Close()
	var out []producers.GapEvent
	for rows.Next() {
		var e producers.GapEvent
		if err := rows.Scan(&e.UserID, &e.MissingNodes); err != nil {
			return nil, fmt.Errorf("curation_readers.PrereqGaps scan: %w", err)
		}
		// MVP: NextStep label — generic. Будущая итерация может пойти в
		// learning_state и резолвить current_step.title.
		e.NextStep = "next step"
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("curation_readers.PrereqGaps rows: %w", err)
	}
	return out, nil
}
