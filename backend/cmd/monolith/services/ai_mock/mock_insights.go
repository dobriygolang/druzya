// mock_insights.go — chi-direct GET /api/v1/mock/insights/overview.
//
// Powers the /insights page's three live cards:
//
//	stage_performance   — pass rate per stage_kind, last 30 days
//	recurring_patterns  — top recurring missing_points across attempts
//	score_trajectory    — total_score series for last N finished pipelines
//
// All three queries are scoped to the caller's user_id. Empty result
// sets render as "no data yet" cards on the frontend, never as errors.
package ai_mock

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	aimockApp "druz9/ai_mock/app"
	aimockInfra "druz9/ai_mock/infra"
	monolithServices "druz9/cmd/monolith/services"
	"druz9/shared/pkg/llmchain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"
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
	PipelineID string  `json:"pipeline_id"` // for the click→debrief drill-down
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
	// Summary — single-paragraph LLM-generated narrative built from the
	// three aggregations above. Empty when LLMChain is unavailable or
	// when the user has no 30d activity to talk about.
	Summary string `json:"summary,omitempty"`
}

// NewMockInsights wires the public chi-direct insights endpoint.
func NewMockInsights(d monolithServices.Deps) *monolithServices.Module {
	repo := aimockInfra.NewInsights(d.Pool)
	h := &mockInsightsHandler{
		log:   d.Log,
		chain: d.LLMChain,
		rdb:   d.Redis,
	}
	h.uc = &aimockApp.InsightsOverview{
		Repo: repo,
		OnPartialErr: func(ctx context.Context, op string, err error) {
			if h.log == nil {
				return
			}
			if errors.Is(err, http.ErrAbortHandler) {
				return
			}
			h.log.WarnContext(ctx, "mock.insights: query failed",
				slog.String("op", op), slog.Any("err", err))
		},
	}
	return &monolithServices.Module{
		MountREST: func(r chi.Router) {
			r.Get("/mock/insights/overview", h.overview)
		},
	}
}

type mockInsightsHandler struct {
	uc    *aimockApp.InsightsOverview
	log   *slog.Logger
	chain llmchain.ChatClient
	rdb   *redis.Client
}

func (h *mockInsightsHandler) overview(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
		return
	}

	ctx := r.Context()
	res, _ := h.uc.Run(ctx, aimockApp.InsightsOverviewInput{
		UserID:     uid,
		WindowDays: insightsWindowDays,
		ScoreLimit: insightsScoreLimit,
		TopMissing: insightsTopMissing,
	})

	out := insightsOverviewResp{
		WindowDays:         insightsWindowDays,
		StagePerformance:   make([]stagePerformanceRow, 0, len(res.StagePerformance)),
		RecurringPatterns:  make([]recurringPatternRow, 0, len(res.RecurringPatterns)),
		ScoreTrajectory:    make([]scoreTrajectoryRow, 0, len(res.ScoreTrajectory)),
		TotalSessions30d:   res.Headline.TotalSessions,
		PipelinePassRate30: res.Headline.PassRatePct,
	}
	for _, sp := range res.StagePerformance {
		row := stagePerformanceRow{StageKind: sp.StageKind, Total: sp.Total, Passed: sp.Passed}
		if sp.Total > 0 {
			row.PassRate = int(float64(sp.Passed) / float64(sp.Total) * 100.0)
		}
		out.StagePerformance = append(out.StagePerformance, row)
	}
	for _, rp := range res.RecurringPatterns {
		out.RecurringPatterns = append(out.RecurringPatterns, recurringPatternRow{Point: rp.Point, Count: rp.Count})
	}
	for _, st := range res.ScoreTrajectory {
		ts := ""
		if !st.FinishedAt.IsZero() {
			ts = st.FinishedAt.UTC().Format(time.RFC3339)
		}
		out.ScoreTrajectory = append(out.ScoreTrajectory, scoreTrajectoryRow{
			PipelineID: st.PipelineID.String(),
			FinishedAt: ts,
			Score:      st.Score,
			Verdict:    st.Verdict,
		})
	}

	// AI summary — one short paragraph synthesised from the data
	// above. Cached 30min in Redis per user (key: mock:insights:
	// summary:{uid}) so we don't burn the LLM chain on every page
	// refresh. Skipped when there's no activity to talk about.
	if out.TotalSessions30d > 0 {
		out.Summary = h.resolveSummary(ctx, uid.String(), out)
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, max-age=60")
	_ = json.NewEncoder(w).Encode(out)
}

const insightsSummaryTTL = 30 * time.Minute
const insightsSummaryTimeout = 8 * time.Second

func (h *mockInsightsHandler) resolveSummary(ctx context.Context, userID string, data insightsOverviewResp) string {
	cacheKey := "mock:insights:summary:" + userID
	if h.rdb != nil {
		if cached, err := h.rdb.Get(ctx, cacheKey).Result(); err == nil && cached != "" {
			return cached
		}
	}
	if h.chain == nil {
		// No LLMChain configured — synthesise a deterministic summary from
		// the same data so the user still sees a useful paragraph instead
		// of an empty card. Cached too, so we don't re-template on every
		// request (cheap but avoids inconsistencies on stage rebalancing).
		s := templateSummary(data)
		if s != "" && h.rdb != nil {
			_ = h.rdb.Set(ctx, cacheKey, s, insightsSummaryTTL).Err()
		}
		return s
	}
	prompt := buildInsightsSummaryPrompt(data)
	llmCtx, cancel := context.WithTimeout(ctx, insightsSummaryTimeout)
	defer cancel()
	resp, err := h.chain.Chat(llmCtx, llmchain.Request{
		Task:        llmchain.TaskInsightProse,
		Temperature: 0.4,
		MaxTokens:   220,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: insightsSummarySystemPrompt},
			{Role: llmchain.RoleUser, Content: prompt},
		},
	})
	if err != nil {
		if h.log != nil {
			h.log.WarnContext(ctx, "mock.insights: summary chain failed", slog.Any("err", err))
		}
		return ""
	}
	summary := strings.TrimSpace(resp.Content)
	if summary == "" {
		return ""
	}
	// Hard cap — defensive against models that ignore MaxTokens.
	if len(summary) > 800 {
		summary = summary[:800] + "…"
	}
	if h.rdb != nil {
		_ = h.rdb.Set(ctx, cacheKey, summary, insightsSummaryTTL).Err()
	}
	return summary
}

// templateSummary — детерминистический fallback когда LLMChain не
// настроен. Считаем сильнейший / слабейший этапы, тренд по последним 3
// vs первым 3, топ pattern. Текст по-русски, без LLM.
func templateSummary(d insightsOverviewResp) string {
	if d.TotalSessions30d == 0 {
		return ""
	}
	parts := []string{}
	parts = append(parts, fmt.Sprintf("За 30 дней — %d сессий, pass-rate %d%%.",
		d.TotalSessions30d, d.PipelinePassRate30))

	if len(d.StagePerformance) > 0 {
		var best, worst stagePerformanceRow
		bestRate, worstRate := -1, 101
		for _, s := range d.StagePerformance {
			if s.Total < 2 {
				continue
			}
			if s.PassRate > bestRate {
				best, bestRate = s, s.PassRate
			}
			if s.PassRate < worstRate {
				worst, worstRate = s, s.PassRate
			}
		}
		if best.StageKind != "" && worst.StageKind != "" && best.StageKind != worst.StageKind {
			parts = append(parts,
				fmt.Sprintf("Сильнее всего идёт %s (%d%%), труднее всего — %s (%d%%).",
					best.StageKind, best.PassRate, worst.StageKind, worst.PassRate))
		}
	}

	if len(d.ScoreTrajectory) >= 4 {
		head := d.ScoreTrajectory[:len(d.ScoreTrajectory)/2]
		tail := d.ScoreTrajectory[len(d.ScoreTrajectory)/2:]
		var headSum, tailSum float64
		for _, p := range head {
			headSum += p.Score
		}
		for _, p := range tail {
			tailSum += p.Score
		}
		delta := tailSum/float64(len(tail)) - headSum/float64(len(head))
		switch {
		case delta > 5:
			parts = append(parts, fmt.Sprintf("Score растёт: +%.0f к среднему за вторую половину окна.", delta))
		case delta < -5:
			parts = append(parts, fmt.Sprintf("Score просел: %.0f vs первая половина окна.", delta))
		}
	}

	if len(d.RecurringPatterns) > 0 && d.RecurringPatterns[0].Count >= 3 {
		parts = append(parts, fmt.Sprintf("Чаще всего упускаешь «%s» (×%d).",
			d.RecurringPatterns[0].Point, d.RecurringPatterns[0].Count))
	}

	// Концовка — всегда конкретный next-step.
	switch {
	case len(d.StagePerformance) > 0:
		var weakest stagePerformanceRow
		worstRate := 101
		for _, s := range d.StagePerformance {
			if s.Total >= 2 && s.PassRate < worstRate {
				weakest, worstRate = s, s.PassRate
			}
		}
		if weakest.StageKind != "" {
			parts = append(parts, fmt.Sprintf("На этой неделе — один mock с фокусом на %s.", weakest.StageKind))
		}
	default:
		parts = append(parts, "Запусти 1-2 mock'а на этой неделе, чтобы цифры стабилизировались.")
	}
	return strings.Join(parts, " ")
}

const insightsSummarySystemPrompt = `You are a calm, motivating coach for a software-interview-prep tool.
Given JSON stats of one candidate's last 30 days of practice, write ONE
short English paragraph (3–5 sentences). Tone: factual + supportive,
never shaming. Always end with one concrete next-step suggestion (e.g.
"try 2 system-design mocks this week" or "review your last fail's
feedback"). Do not output bullet points, headings, or JSON — just prose.`

func buildInsightsSummaryPrompt(d insightsOverviewResp) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Window: last %d days\n", d.WindowDays)
	fmt.Fprintf(&b, "Total sessions: %d\nPipeline pass rate: %d%%\n", d.TotalSessions30d, d.PipelinePassRate30)
	if len(d.StagePerformance) > 0 {
		b.WriteString("\nStage performance (stage_kind / passed-of-total / pass-rate %):\n")
		for _, s := range d.StagePerformance {
			fmt.Fprintf(&b, "- %s: %d/%d (%d%%)\n", s.StageKind, s.Passed, s.Total, s.PassRate)
		}
	}
	if len(d.RecurringPatterns) > 0 {
		b.WriteString("\nRecurring missing-points across attempts (label × count):\n")
		for _, p := range d.RecurringPatterns {
			fmt.Fprintf(&b, "- %s × %d\n", p.Point, p.Count)
		}
	}
	if len(d.ScoreTrajectory) > 0 {
		b.WriteString("\nScore trajectory (oldest → newest, /100):\n")
		for _, s := range d.ScoreTrajectory {
			fmt.Fprintf(&b, "- %0.1f (%s)\n", s.Score, s.Verdict)
		}
	}
	b.WriteString("\nWrite the paragraph now.")
	return b.String()
}
