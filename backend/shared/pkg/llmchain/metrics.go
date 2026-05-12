package llmchain

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"

	sharedMetrics "druz9/shared/pkg/metrics"
)

// Three metrics tell the whole story of chain health in production:
//
//	druz9_llm_call_total{provider,task,status}
//	    — per-attempt counter. One increment per chain hop; a fallback
//	      chain that eventually succeeds produces multiple increments
//	      (one failed + one ok). Label "task" is the Task constant
//	      ("insight_prose" etc.); "status" is classLabel (ok /
//	      rate_limited / provider_down / timeout / unauthorized /
//	      bad_request / not_supported / unknown).
//
//	druz9_llm_call_duration_seconds{provider,task}
//	    — per-attempt wall clock. Histogram. Buckets are coarse because
//	      we mostly care about p50 vs p99, not sub-second resolution.
//
//	druz9_llm_fallback_total{provider,reason}
//	    — counts every SKIP of a provider because it was cooled at hop
//	      time. Helps distinguish "Groq is slow" (rate_limited calls on
//	      the duration histogram) from "Groq is permanently blacklisted
//	      in our state" (flood of fallback_total with reason=cooled).
var (
	llmCallTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "druz9_llm_call_total",
			Help: "Per-provider LLM attempts grouped by task and outcome.",
		},
		[]string{"provider", "task", "status"},
	)

	llmCallDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "druz9_llm_call_duration_seconds",
			Help:    "Per-provider LLM attempt wall clock.",
			Buckets: []float64{0.5, 1, 2, 5, 10, 20, 45, 90},
		},
		[]string{"provider", "task"},
	)

	llmFallbackTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "druz9_llm_fallback_total",
			Help: "Per-provider chain-skip events (cooled / rate-limited / etc.).",
		},
		[]string{"provider", "reason"},
	)

	// Phase VIII cost telemetry. Tokens + RUB cost уже считаются в
	// shared/pkg/metrics (LLMTokensTotal + LLMCostRubTotal через
	// RecordLLMUsage). Здесь добавляем USD-side с per-task labelling
	// (shared-metrics labellит только по model'и) и счётчик unknown
	// моделей чтобы ops видел когда rate-table cost.go устарел.
	llmCostUSDCentsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "druz9_llm_chain_cost_usd_cents_total",
			Help: "Estimated upstream USD cost in cents per provider+task. Divide by 100 on dashboard.",
		},
		[]string{"provider", "task"},
	)

	llmUnknownModelTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "druz9_llm_chain_unknown_cost_total",
			Help: "Calls hitting a model id with no entry in cost.go costTable. Bump signals stale rates.",
		},
		[]string{"model"},
	)
)

func init() {
	sharedMetrics.Registry.MustRegister(llmCallTotal)
	sharedMetrics.Registry.MustRegister(llmCallDuration)
	sharedMetrics.Registry.MustRegister(llmFallbackTotal)
	sharedMetrics.Registry.MustRegister(llmCostUSDCentsTotal)
	sharedMetrics.Registry.MustRegister(llmUnknownModelTotal)
}

func observeCall(p Provider, task, status string, dur time.Duration) {
	llmCallTotal.WithLabelValues(string(p), task, status).Inc()
	llmCallDuration.WithLabelValues(string(p), task).Observe(dur.Seconds())
}

func incFallback(p Provider, reason string) {
	llmFallbackTotal.WithLabelValues(string(p), reason).Inc()
}

// observeCost — Phase VIII: пишем tokens (через shared RecordLLMUsage) +
// USD cost (per provider+task — оригинал к нашей цепочке). Caller передаёт
// фактически-ушедший model id (Response.Model echo) — для virtual chains
// резолвится в конкретную модель.
//
// Безопасно для нулевых tokens (ранние fail'ы / driver не отдал usage).
func observeCost(p Provider, task, model string, tokensIn, tokensOut int) {
	if tokensIn > 0 || tokensOut > 0 {
		sharedMetrics.RecordLLMUsage(model, tokensIn, tokensOut)
	}
	usd := EstimateCostUSD(model, tokensIn, tokensOut)
	if usd > 0 {
		llmCostUSDCentsTotal.WithLabelValues(string(p), task).Add(usd * 100)
	}
}

func observeUnknownModel(model string) {
	llmUnknownModelTotal.WithLabelValues(model).Inc()
}
