// mock_insights.go — chi-direct GET /api/v1/mock/insights/overview.
//
// Powers the /insights page's three live cards:
//
//	stage_performance   — pass rate per stage_kind, last 30 days
//	recurring_patterns  — top recurring missing_points across attempts
//	score_trajectory    — total_score series for last N finished pipelines
//
// Direct SQL against pipeline_stages / pipeline_attempts / mock_pipelines
// — no new proto, no new domain wiring. The intelligence service stays
// focused on LLM-synthesised content; this is plain numeric aggregation
// that doesn't need a BoundedContext of its own.
//
// All three queries are scoped to the caller's user_id. Empty result
// sets render as "no data yet" cards on the frontend, never as errors.
package services

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	sharedMw "druz9/shared/pkg/middleware"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	insightsWindowDays = 30
	insightsScoreLimit = 10
	insightsTopMissing = 8
)

type stagePerformanceRow struct {
	StageKind string `json:"stage_kind"`
	Total     int    `json:"total"`
	Passed    int    `json:"passed"`
	PassRate  int    `json:"pass_rate"` // 0..100
}

type recurringPatternRow struct {
	Point string `json:"point"`
	Count int    `json:"count"`
}

type scoreTrajectoryRow struct {
	FinishedAt string  `json:"finished_at"` // RFC3339
	Score      float64 `json:"score"`       // 0..100
	Verdict    string  `json:"verdict"`
}

type insightsOverviewResp struct {
	WindowDays         int                   `json:"window_days"`
	StagePerformance   []stagePerformanceRow `json:"stage_performance"`
	RecurringPatterns  []recurringPatternRow `json:"recurring_patterns"`
	ScoreTrajectory    []scoreTrajectoryRow  `json:"score_trajectory"`
	TotalSessions30d   int                   `json:"total_sessions_30d"`
	PipelinePassRate30 int                   `json:"pipeline_pass_rate_30d"` // 0..100
}

// NewMockInsights wires the public chi-direct insights endpoint.
func NewMockInsights(d Deps) *Module {
	h := &mockInsightsHandler{pool: d.Pool, log: d.Log}
	return &Module{
		MountREST: func(r chi.Router) {
			r.Get("/mock/insights/overview", h.overview)
		},
	}
}

type mockInsightsHandler struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

func (h *mockInsightsHandler) overview(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
		return
	}

	ctx := r.Context()
	out := insightsOverviewResp{
		WindowDays:        insightsWindowDays,
		StagePerformance:  []stagePerformanceRow{},
		RecurringPatterns: []recurringPatternRow{},
		ScoreTrajectory:   []scoreTrajectoryRow{},
	}

	// 1. Per-stage pass rate over the trailing 30-day window. We count
	//    finished pipeline_stages owned by the caller and group by
	//    stage_kind; pass = stage.verdict='pass'. Stages that ended in
	//    'fail'/'borderline' or never finished are counted in `total`
	//    but not in `passed`.
	stageRows, err := h.pool.Query(ctx, `
		SELECT s.stage_kind,
		       COUNT(*) AS total,
		       COUNT(*) FILTER (WHERE s.verdict = 'pass') AS passed
		  FROM pipeline_stages s
		  JOIN mock_pipelines p ON p.id = s.pipeline_id
		 WHERE p.user_id = $1
		   AND s.finished_at IS NOT NULL
		   AND s.finished_at >= now() - ($2 || ' days')::interval
		 GROUP BY s.stage_kind
		 ORDER BY total DESC, s.stage_kind ASC`, sharedpg.UUID(uid), strconv.Itoa(insightsWindowDays))
	if err != nil {
		h.fail(r, err, "stage_performance")
	} else {
		for stageRows.Next() {
			var row stagePerformanceRow
			if scanErr := stageRows.Scan(&row.StageKind, &row.Total, &row.Passed); scanErr != nil {
				continue
			}
			if row.Total > 0 {
				row.PassRate = int(float64(row.Passed) / float64(row.Total) * 100.0)
			}
			out.StagePerformance = append(out.StagePerformance, row)
		}
		stageRows.Close()
	}

	// 2. Recurring patterns — top N missing_points across the user's
	//    attempts in the window. ai_missing_points is a jsonb array of
	//    short labels (e.g. "rate limiting", "consistency model"). We
	//    unnest with jsonb_array_elements_text and group case-insensitively.
	patternRows, err := h.pool.Query(ctx, `
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
		sharedpg.UUID(uid), strconv.Itoa(insightsWindowDays), insightsTopMissing)
	if err != nil {
		h.fail(r, err, "recurring_patterns")
	} else {
		for patternRows.Next() {
			var row recurringPatternRow
			if scanErr := patternRows.Scan(&row.Point, &row.Count); scanErr != nil {
				continue
			}
			out.RecurringPatterns = append(out.RecurringPatterns, row)
		}
		patternRows.Close()
	}

	// 3. Score trajectory — last N finished pipelines (any verdict
	//    counts as finished except cancelled). Returned oldest→newest
	//    for direct sparkline rendering.
	scoreRows, err := h.pool.Query(ctx, `
		WITH last_n AS (
		  SELECT finished_at, total_score, verdict
		    FROM mock_pipelines
		   WHERE user_id = $1
		     AND finished_at IS NOT NULL
		     AND verdict IN ('pass','fail')
		     AND total_score IS NOT NULL
		   ORDER BY finished_at DESC
		   LIMIT $2
		)
		SELECT finished_at, total_score, verdict
		  FROM last_n
		 ORDER BY finished_at ASC`,
		sharedpg.UUID(uid), insightsScoreLimit)
	if err != nil {
		h.fail(r, err, "score_trajectory")
	} else {
		for scoreRows.Next() {
			var (
				finishedAt pgtype.Timestamptz
				score      float32
				verdict    string
			)
			if scanErr := scoreRows.Scan(&finishedAt, &score, &verdict); scanErr != nil {
				continue
			}
			ts := ""
			if finishedAt.Valid {
				ts = finishedAt.Time.UTC().Format(time.RFC3339)
			}
			out.ScoreTrajectory = append(out.ScoreTrajectory, scoreTrajectoryRow{
				FinishedAt: ts, Score: float64(score), Verdict: verdict,
			})
		}
		scoreRows.Close()
	}

	// 4. Headline aggregates: total finished sessions + pipeline pass
	//    rate over the same 30d window. Cheap, useful for the page hero.
	if hErr := h.pool.QueryRow(ctx, `
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
		sharedpg.UUID(uid), strconv.Itoa(insightsWindowDays),
	).Scan(&out.TotalSessions30d, &out.PipelinePassRate30); hErr != nil {
		h.fail(r, hErr, "headline")
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, max-age=60")
	_ = json.NewEncoder(w).Encode(out)
}

// fail logs aggregation failures without surfacing partial errors to
// the user. The handler always returns 200 with whatever blocks did
// succeed — better UX than a single bad sub-query nuking the page.
func (h *mockInsightsHandler) fail(r *http.Request, err error, op string) {
	if h.log == nil {
		return
	}
	if errors.Is(err, http.ErrAbortHandler) {
		return
	}
	h.log.WarnContext(r.Context(), "mock.insights: query failed", slog.String("op", op), slog.Any("err", err))
}
