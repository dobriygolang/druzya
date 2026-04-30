package infra

import (
	"context"
	"fmt"
	"strconv"

	"druz9/ai_mock/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Insights aggregates pipeline_stages / pipeline_attempts / mock_pipelines
// for the /mock/insights/overview endpoint. SQL is verbatim from the
// pre-refactor monolith handler.
type Insights struct {
	pool *pgxpool.Pool
}

// NewInsights wraps a pool.
func NewInsights(pool *pgxpool.Pool) *Insights {
	return &Insights{pool: pool}
}

// StagePerformance — per-stage pass rate over the trailing window.
func (i *Insights) StagePerformance(ctx context.Context, userID uuid.UUID, windowDays int) ([]domain.StagePerformance, error) {
	rows, err := i.pool.Query(ctx, `
			SELECT s.stage_kind,
			       COUNT(*) AS total,
			       COUNT(*) FILTER (WHERE s.verdict = 'pass') AS passed
			  FROM pipeline_stages s
			  JOIN mock_pipelines p ON p.id = s.pipeline_id
			 WHERE p.user_id = $1
			   AND s.finished_at IS NOT NULL
			   AND s.finished_at >= now() - ($2 || ' days')::interval
			 GROUP BY s.stage_kind
			 ORDER BY total DESC, s.stage_kind ASC`,
		sharedpg.UUID(userID), strconv.Itoa(windowDays))
	if err != nil {
		return nil, fmt.Errorf("ai_mock.Insights.StagePerformance: %w", err)
	}
	defer rows.Close()
	out := make([]domain.StagePerformance, 0)
	for rows.Next() {
		var row domain.StagePerformance
		if scanErr := rows.Scan(&row.StageKind, &row.Total, &row.Passed); scanErr != nil {
			continue
		}
		out = append(out, row)
	}
	return out, nil
}

// RecurringPatterns — top N missing_points across attempts in the window.
func (i *Insights) RecurringPatterns(ctx context.Context, userID uuid.UUID, windowDays, topN int) ([]domain.RecurringPattern, error) {
	rows, err := i.pool.Query(ctx, `
			SELECT lower(trim(point)) AS norm, COUNT(*) AS c
			  FROM pipeline_attempts a
			  JOIN pipeline_stages s ON s.id = a.pipeline_stage_id
			  JOIN mock_pipelines p ON p.id = s.pipeline_id,
			       LATERAL jsonb_array_elements_text(
			         CASE jsonb_typeof(a.ai_missing_points)
			           WHEN 'array' THEN a.ai_missing_points
			           ELSE '[]'::jsonb
			         END
			       ) AS point
			 WHERE p.user_id = $1
			   AND a.ai_judged_at IS NOT NULL
			   AND a.ai_judged_at >= now() - ($2 || ' days')::interval
			   AND length(trim(point)) > 1
			 GROUP BY norm
			 ORDER BY c DESC
			 LIMIT $3`,
		sharedpg.UUID(userID), strconv.Itoa(windowDays), topN)
	if err != nil {
		return nil, fmt.Errorf("ai_mock.Insights.RecurringPatterns: %w", err)
	}
	defer rows.Close()
	out := make([]domain.RecurringPattern, 0)
	for rows.Next() {
		var row domain.RecurringPattern
		if scanErr := rows.Scan(&row.Point, &row.Count); scanErr != nil {
			continue
		}
		out = append(out, row)
	}
	return out, nil
}

// ScoreTrajectory — last N finished pipelines, oldest→newest.
func (i *Insights) ScoreTrajectory(ctx context.Context, userID uuid.UUID, limit int) ([]domain.ScoreTrajectoryPoint, error) {
	rows, err := i.pool.Query(ctx, `
			WITH last_n AS (
			  SELECT id, finished_at, total_score, verdict
			    FROM mock_pipelines
			   WHERE user_id = $1
			     AND finished_at IS NOT NULL
			     AND verdict IN ('pass','fail')
			     AND total_score IS NOT NULL
			   ORDER BY finished_at DESC
			   LIMIT $2
			)
			SELECT id::text, finished_at, total_score, verdict
			  FROM last_n
			 ORDER BY finished_at ASC`,
		sharedpg.UUID(userID), limit)
	if err != nil {
		return nil, fmt.Errorf("ai_mock.Insights.ScoreTrajectory: %w", err)
	}
	defer rows.Close()
	out := make([]domain.ScoreTrajectoryPoint, 0)
	for rows.Next() {
		var (
			pipelineIDStr string
			finishedAt    pgtype.Timestamptz
			score         float32
			verdict       string
		)
		if scanErr := rows.Scan(&pipelineIDStr, &finishedAt, &score, &verdict); scanErr != nil {
			continue
		}
		pid, perr := uuid.Parse(pipelineIDStr)
		if perr != nil {
			continue
		}
		pt := domain.ScoreTrajectoryPoint{
			PipelineID: pid,
			Score:      float64(score),
			Verdict:    verdict,
		}
		if finishedAt.Valid {
			pt.FinishedAt = finishedAt.Time
		}
		out = append(out, pt)
	}
	return out, nil
}

// EnglishHRTrend — Wave 1 of docs/feature/english.md. Aggregates
// English HR mock-rounds (section='english_hr') over the trailing
// window. ai_report stores the LLM grader's JSON; we extract
// overall_score (an int 0..100) for averaging and trajectory.
//
// Defensive on bad data: rows with NULL ai_report or missing
// overall_score key contribute zero to the averages but DO count
// toward total_sessions — matches "you finished 3 sessions, but 1
// wasn't graded yet". Frontend hides the card on TotalSessions == 0.
func (i *Insights) EnglishHRTrend(ctx context.Context, userID uuid.UUID, windowDays, trajectoryLimit int) (domain.EnglishHRTrend, error) {
	out := domain.EnglishHRTrend{Trajectory: []domain.EnglishHRTrendPoint{}}

	var totalSessions int
	var avgScore *float64
	var lastScore *int32
	var lastFinishedAt pgtype.Timestamptz
	if err := i.pool.QueryRow(ctx, `
			SELECT COUNT(*) AS total,
			       AVG((ai_report->>'overall_score')::int)
			           FILTER (WHERE ai_report ? 'overall_score') AS avg_score,
			       (
			         SELECT (ai_report->>'overall_score')::int
			           FROM mock_sessions
			          WHERE user_id = $1
			            AND section = 'english_hr'
			            AND finished_at IS NOT NULL
			            AND finished_at >= now() - ($2 || ' days')::interval
			            AND ai_report ? 'overall_score'
			          ORDER BY finished_at DESC
			          LIMIT 1
			       ) AS last_score,
			       MAX(finished_at) AS last_finished_at
			  FROM mock_sessions
			 WHERE user_id = $1
			   AND section = 'english_hr'
			   AND finished_at IS NOT NULL
			   AND finished_at >= now() - ($2 || ' days')::interval`,
		sharedpg.UUID(userID), strconv.Itoa(windowDays),
	).Scan(&totalSessions, &avgScore, &lastScore, &lastFinishedAt); err != nil {
		return domain.EnglishHRTrend{}, fmt.Errorf("ai_mock.Insights.EnglishHRTrend headline: %w", err)
	}
	out.TotalSessions = totalSessions
	if avgScore != nil {
		out.AvgScore = int(*avgScore + 0.5) // round half-up
	}
	if lastScore != nil {
		out.LastScore = int(*lastScore)
	}
	if lastFinishedAt.Valid {
		out.LastFinishedAt = lastFinishedAt.Time
	}
	if totalSessions == 0 {
		return out, nil
	}

	rows, err := i.pool.Query(ctx, `
			SELECT id, finished_at, (ai_report->>'overall_score')::int AS score
			  FROM mock_sessions
			 WHERE user_id = $1
			   AND section = 'english_hr'
			   AND finished_at IS NOT NULL
			   AND finished_at >= now() - ($2 || ' days')::interval
			   AND ai_report ? 'overall_score'
			 ORDER BY finished_at DESC
			 LIMIT $3`,
		sharedpg.UUID(userID), strconv.Itoa(windowDays), trajectoryLimit,
	)
	if err != nil {
		return domain.EnglishHRTrend{}, fmt.Errorf("ai_mock.Insights.EnglishHRTrend trajectory: %w", err)
	}
	defer rows.Close()
	pts := make([]domain.EnglishHRTrendPoint, 0, trajectoryLimit)
	for rows.Next() {
		var idRaw pgtype.UUID
		var finishedAt pgtype.Timestamptz
		var score int32
		if scanErr := rows.Scan(&idRaw, &finishedAt, &score); scanErr != nil {
			continue
		}
		p := domain.EnglishHRTrendPoint{
			SessionID: sharedpg.UUIDFrom(idRaw),
			Score:     int(score),
		}
		if finishedAt.Valid {
			p.FinishedAt = finishedAt.Time
		}
		pts = append(pts, p)
	}
	// Reverse to ASC so the sparkline reads left-to-right.
	for l, r := 0, len(pts)-1; l < r; l, r = l+1, r-1 {
		pts[l], pts[r] = pts[r], pts[l]
	}
	out.Trajectory = pts
	return out, nil
}

// PipelineHeadline — total + pass-rate aggregates for the page hero.
func (i *Insights) PipelineHeadline(ctx context.Context, userID uuid.UUID, windowDays int) (domain.PipelineHeadline, error) {
	var h domain.PipelineHeadline
	if err := i.pool.QueryRow(ctx, `
			SELECT COUNT(*),
			       COALESCE(
			         (COUNT(*) FILTER (WHERE verdict='pass'))::float
			         / NULLIF(COUNT(*),0) * 100, 0
			       )::int
			  FROM mock_pipelines
			 WHERE user_id = $1
			   AND finished_at IS NOT NULL
			   AND verdict IN ('pass','fail')
			   AND finished_at >= now() - ($2 || ' days')::interval`,
		sharedpg.UUID(userID), strconv.Itoa(windowDays),
	).Scan(&h.TotalSessions, &h.PassRatePct); err != nil {
		return domain.PipelineHeadline{}, fmt.Errorf("ai_mock.Insights.PipelineHeadline: %w", err)
	}
	return h, nil
}
