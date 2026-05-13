// Package app — admin observability dashboard reader.
//
// Surfaces per-task LLM volume + cost из `dynamic_config_metrics` (00060)
// + latest eval_runs results.
//
// MVP read shape: возвращает агрегированный rollup за last N days. Admin
// UI рендерит как table «task · calls · avg latency · est cost».
package app

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ObservabilityReader — postgres-backed reader.
type ObservabilityReader struct {
	Pool *pgxpool.Pool
}

// TaskRollup — one row per LLM task (TaskCurateResource / TaskAITutorML / ...).
type TaskRollup struct {
	Task          string
	Calls         int64
	TokensIn      int64
	TokensOut     int64
	AvgLatencyMs  int64
	ErrorRate     float32 // 0..1
	EstCostCents  float32 // best-effort из tokens × per-provider rate
	LastBucketDay time.Time
}

// EvalRunSnapshot — latest eval suite result.
type EvalRunSnapshot struct {
	Dataset    string
	Passed     int
	Total      int
	RanAt      time.Time
	Regression bool // true если passed < previous_passed на этом dataset
}

// ListTaskRollups — last N days rollup. days <= 0 → last 7.
func (r *ObservabilityReader) ListTaskRollups(ctx context.Context, days int) ([]TaskRollup, error) {
	if days <= 0 {
		days = 7
	}
	rows, err := r.Pool.Query(ctx, `
SELECT task,
       SUM(calls)                              AS calls,
       SUM(tokens_in_sum)                      AS tokens_in,
       SUM(tokens_out_sum)                     AS tokens_out,
       COALESCE(AVG(latency_ms_sum / NULLIF(calls,0)),0)::bigint AS avg_lat,
       COALESCE(SUM(errors)::float / NULLIF(SUM(calls),0),0)     AS err_rate,
       MAX(bucket_day)                         AS last_day
FROM dynamic_config_metrics
WHERE bucket_day >= CURRENT_DATE - $1::int
GROUP BY task
ORDER BY calls DESC
`, days)
	if err != nil {
		return nil, fmt.Errorf("admin.ListTaskRollups: %w", err)
	}
	defer rows.Close()
	var out []TaskRollup
	for rows.Next() {
		var t TaskRollup
		var lastDay *time.Time
		if err := rows.Scan(&t.Task, &t.Calls, &t.TokensIn, &t.TokensOut,
			&t.AvgLatencyMs, &t.ErrorRate, &lastDay); err != nil {
			return nil, fmt.Errorf("admin.ListTaskRollups scan: %w", err)
		}
		if lastDay != nil {
			t.LastBucketDay = *lastDay
		}
		// Free-tier: cost ≈ 0. Placeholder для future paid-tier rate cards.
		t.EstCostCents = 0
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("admin.ListTaskRollups rows: %w", err)
	}
	return out, nil
}

// LatestEvalRuns — последняя строка per dataset.
func (r *ObservabilityReader) LatestEvalRuns(ctx context.Context) ([]EvalRunSnapshot, error) {
	rows, err := r.Pool.Query(ctx, `
SELECT DISTINCT ON (dataset) dataset, passed, total, ran_at
FROM eval_runs
ORDER BY dataset, ran_at DESC
`)
	if err != nil {
		return nil, fmt.Errorf("admin.LatestEvalRuns: %w", err)
	}
	defer rows.Close()
	var out []EvalRunSnapshot
	for rows.Next() {
		var e EvalRunSnapshot
		if err := rows.Scan(&e.Dataset, &e.Passed, &e.Total, &e.RanAt); err != nil {
			return nil, fmt.Errorf("admin.LatestEvalRuns scan: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("admin.LatestEvalRuns rows: %w", err)
	}
	return out, nil
}
