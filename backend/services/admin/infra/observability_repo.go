// observability_repo.go — read-only aggregations for the admin
// observability panels.
//
// Three queries, one struct:
//   - TrackDistribution — counts per user_persona_tracks.track
//   - EnglishHRStats    — recent English HR mocks: total, avg score,
//     error rate (sessions with NULL ai_report).
//   - MockBlockMetrics  — strict vs ai_assist split over the trailing
//     window. Defense-in-depth «CheckBlock fired N
//     times» counter is intentionally absent —
//     that requires a Redis counter instrumented
//     in services/copilot, not a SQL aggregate.
//
// All queries are deliberately COUNT-based and run against the live
// table — no extra indexes needed. The window for time-bounded queries
// is 30 days (matches the rest of /insights surface).
package infra

import (
	"context"
	"fmt"
	"strconv"

	"druz9/admin/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Observability struct {
	pool *pgxpool.Pool
}

func NewObservability(pool *pgxpool.Pool) *Observability {
	return &Observability{pool: pool}
}

// TrackDistribution returns one row per known track_kind enum value.
// Tracks with zero users still show up — the dashboard renders them
// as «not adopted yet», which is itself useful signal.
func (o *Observability) TrackDistribution(ctx context.Context) ([]domain.TrackDistributionRow, error) {
	rows, err := o.pool.Query(ctx, `
		WITH tracks AS (
			SELECT unnest(enum_range(NULL::track_kind))::text AS track
		)
		SELECT t.track,
		       COALESCE(COUNT(ut.user_id), 0)                                                  AS total,
		       COALESCE(COUNT(ut.user_id) FILTER (WHERE ut.primary_track), 0)                  AS primary_count,
		       COALESCE(COUNT(ut.user_id) FILTER (WHERE ut.last_active_at >= now() - interval '30 days'), 0) AS active_30d
		  FROM tracks t
		  LEFT JOIN user_persona_tracks ut ON ut.track::text = t.track
		 GROUP BY t.track
		 ORDER BY total DESC, t.track ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("admin.Observability.TrackDistribution: %w", err)
	}
	defer rows.Close()
	out := make([]domain.TrackDistributionRow, 0, 8)
	for rows.Next() {
		var r domain.TrackDistributionRow
		if err := rows.Scan(&r.Track, &r.Total, &r.PrimaryCount, &r.Active30d); err != nil {
			return nil, fmt.Errorf("admin.Observability.TrackDistribution: scan: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("admin.Observability.TrackDistribution: iterate: %w", err)
	}
	return out, nil
}

// EnglishHRStats returns aggregate stats over English HR mocks across
// ALL users in the trailing window. Mirrors the per-user
// EnglishHRTrend the user-facing /insights page uses, but
// admin-scoped (no user filter).
//
// `recent` = 10 latest sessions surfaced for the panel's «sample of
// recent» list. PII-scrubbed: only session id, finished_at, score,
// hashed user_id (first 8 chars).
func (o *Observability) EnglishHRStats(
	ctx context.Context,
	windowDays int,
	recentLimit int,
) (domain.EnglishHRStats, error) {
	out := domain.EnglishHRStats{Recent: []domain.EnglishHRRecent{}}

	// Headline aggregates.
	var total int
	var withReport int
	var avgScore *float64
	if err := o.pool.QueryRow(ctx, `
		SELECT COUNT(*)                                         AS total,
		       COUNT(*) FILTER (WHERE ai_report IS NOT NULL)    AS with_report,
		       AVG((ai_report->>'overall_score')::int)
		           FILTER (WHERE ai_report ? 'overall_score')   AS avg_score
		  FROM mock_sessions
		 WHERE section = 'english_hr'
		   AND finished_at IS NOT NULL
		   AND finished_at >= now() - ($1 || ' days')::interval
	`, strconv.Itoa(windowDays)).Scan(&total, &withReport, &avgScore); err != nil {
		return domain.EnglishHRStats{}, fmt.Errorf("admin.Observability.EnglishHRStats headline: %w", err)
	}
	out.TotalSessions = total
	out.WithReport = withReport
	if total > 0 {
		out.ErrorRate = int(float64(total-withReport) / float64(total) * 100)
	}
	if avgScore != nil {
		out.AvgScore = int(*avgScore + 0.5)
	}
	if total == 0 {
		return out, nil
	}

	rows, err := o.pool.Query(ctx, `
		SELECT id, user_id, finished_at,
		       COALESCE((ai_report->>'overall_score')::int, 0) AS score,
		       (ai_report IS NULL) AS errored
		  FROM mock_sessions
		 WHERE section = 'english_hr'
		   AND finished_at IS NOT NULL
		   AND finished_at >= now() - ($1 || ' days')::interval
		 ORDER BY finished_at DESC
		 LIMIT $2
	`, strconv.Itoa(windowDays), recentLimit)
	if err != nil {
		return domain.EnglishHRStats{}, fmt.Errorf("admin.Observability.EnglishHRStats recent: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var idRaw pgtype.UUID
		var userIDRaw pgtype.UUID
		var finishedAt pgtype.Timestamptz
		var score int
		var errored bool
		if err := rows.Scan(&idRaw, &userIDRaw, &finishedAt, &score, &errored); err != nil {
			continue
		}
		rec := domain.EnglishHRRecent{
			SessionID: uuidString(idRaw),
			Score:     score,
			Errored:   errored,
		}
		if finishedAt.Valid {
			rec.FinishedAt = finishedAt.Time
		}
		// Hash to 8 hex chars — enough for a support-rep to disambiguate
		// «that user from yesterday» without exposing the actual UUID.
		rec.UserHash = uuidString(userIDRaw)
		if len(rec.UserHash) > 8 {
			rec.UserHash = rec.UserHash[:8]
		}
		out.Recent = append(out.Recent, rec)
	}
	return out, nil
}

// MockBlockMetrics — strict vs ai_assist split for the trailing
// window. Engineering sections only — English HR / TL / senior SD
// have no Cue overlay so the watermark debate doesn't apply there.
func (o *Observability) MockBlockMetrics(
	ctx context.Context,
	windowDays int,
) (domain.MockBlockMetrics, error) {
	var out domain.MockBlockMetrics
	if err := o.pool.QueryRow(ctx, `
		SELECT COUNT(*)                                          AS total,
		       COUNT(*) FILTER (WHERE ai_assist = TRUE)          AS ai_assist,
		       COUNT(*) FILTER (WHERE ai_assist = FALSE)         AS strict
		  FROM mock_sessions
		 WHERE section IN ('algorithms','sql','go','system_design','behavioral')
		   AND finished_at IS NOT NULL
		   AND finished_at >= now() - ($1 || ' days')::interval
	`, strconv.Itoa(windowDays)).Scan(&out.TotalSessions, &out.AIAssistSessions, &out.StrictSessions); err != nil {
		return domain.MockBlockMetrics{}, fmt.Errorf("admin.Observability.MockBlockMetrics: %w", err)
	}
	if out.TotalSessions > 0 {
		out.StrictPct = int(float64(out.StrictSessions) / float64(out.TotalSessions) * 100)
	}
	return out, nil
}

// uuidString returns the hyphenated form of a pgtype.UUID, or empty
// string for null. Thin wrapper to keep call-sites readable.
func uuidString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return uuid.UUID(u.Bytes).String()
}
