// insights_summary.go — newInsightsSummaryFn returns the LLMChain-driven
// summary callback wired into MockServer.InsightsSummaryFn. Kept in cmd/
// because the LLM chain + Redis cache are deployment-time decisions, not
// service-domain code.
package ai_mock

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	aimockPorts "druz9/ai_mock/ports"
	"druz9/shared/pkg/llmchain"

	"github.com/redis/go-redis/v9"
)

const (
	insightsSummaryTTL     = 30 * time.Minute
	insightsSummaryTimeout = 8 * time.Second
)

const insightsSummarySystemPrompt = `You are a calm, motivating coach for a software-interview-prep tool.
Given JSON stats of one candidate's last 30 days of practice, write ONE
short English paragraph (3–5 sentences). Tone: factual + supportive,
never shaming. Always end with one concrete next-step suggestion (e.g.
"try 2 system-design mocks this week" or "review your last fail's
feedback"). Do not output bullet points, headings, or JSON — just prose.`

// newInsightsSummaryFn returns a function suitable for
// MockServer.InsightsSummaryFn. nil-safe inputs: missing chain ⇒ template
// fallback; missing redis ⇒ no caching.
func newInsightsSummaryFn(chain llmchain.ChatClient, rdb *redis.Client, log *slog.Logger) func(context.Context, string, aimockPorts.InsightsSummaryInput) string {
	return func(ctx context.Context, userID string, data aimockPorts.InsightsSummaryInput) string {
		if data.TotalSessions30d == 0 {
			return ""
		}
		cacheKey := "mock:insights:summary:" + userID
		if rdb != nil {
			if cached, err := rdb.Get(ctx, cacheKey).Result(); err == nil && cached != "" {
				return cached
			}
		}
		if chain == nil {
			s := templateSummary(data)
			if s != "" && rdb != nil {
				_ = rdb.Set(ctx, cacheKey, s, insightsSummaryTTL).Err()
			}
			return s
		}
		llmCtx, cancel := context.WithTimeout(ctx, insightsSummaryTimeout)
		defer cancel()
		resp, err := chain.Chat(llmCtx, llmchain.Request{
			Task:        llmchain.TaskInsightProse,
			Temperature: 0.4,
			MaxTokens:   220,
			Messages: []llmchain.Message{
				{Role: llmchain.RoleSystem, Content: insightsSummarySystemPrompt},
				{Role: llmchain.RoleUser, Content: buildInsightsSummaryPrompt(data)},
			},
		})
		if err != nil {
			if log != nil {
				log.WarnContext(ctx, "mock.insights: summary chain failed", slog.Any("err", err))
			}
			return ""
		}
		summary := strings.TrimSpace(resp.Content)
		if summary == "" {
			return ""
		}
		if len(summary) > 800 {
			summary = summary[:800] + "…"
		}
		if rdb != nil {
			_ = rdb.Set(ctx, cacheKey, summary, insightsSummaryTTL).Err()
		}
		return summary
	}
}

// templateSummary — deterministic fallback for offline / no-LLM deployments.
func templateSummary(d aimockPorts.InsightsSummaryInput) string {
	if d.TotalSessions30d == 0 {
		return ""
	}
	parts := []string{
		fmt.Sprintf("За 30 дней — %d сессий, pass-rate %d%%.",
			d.TotalSessions30d, d.PipelinePassRate30),
	}
	if len(d.StagePerformance) > 0 {
		var bestKind, worstKind string
		bestRate, worstRate := -1, 101
		for _, s := range d.StagePerformance {
			if s.Total < 2 {
				continue
			}
			if s.PassRate > bestRate {
				bestKind, bestRate = s.StageKind, s.PassRate
			}
			if s.PassRate < worstRate {
				worstKind, worstRate = s.StageKind, s.PassRate
			}
		}
		if bestKind != "" && worstKind != "" && bestKind != worstKind {
			parts = append(parts,
				fmt.Sprintf("Сильнее всего идёт %s (%d%%), труднее всего — %s (%d%%).",
					bestKind, bestRate, worstKind, worstRate))
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
	// Concrete next-step.
	if len(d.StagePerformance) > 0 {
		var weakKind string
		worstRate := 101
		for _, s := range d.StagePerformance {
			if s.Total >= 2 && s.PassRate < worstRate {
				weakKind, worstRate = s.StageKind, s.PassRate
			}
		}
		if weakKind != "" {
			parts = append(parts, fmt.Sprintf("На этой неделе — один mock с фокусом на %s.", weakKind))
		}
	} else {
		parts = append(parts, "Запусти 1-2 mock'а на этой неделе, чтобы цифры стабилизировались.")
	}
	return strings.Join(parts, " ")
}

func buildInsightsSummaryPrompt(d aimockPorts.InsightsSummaryInput) string {
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
