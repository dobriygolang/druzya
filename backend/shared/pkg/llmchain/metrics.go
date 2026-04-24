package llmchain

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"

	sharedMetrics "druz9/shared/pkg/metrics"
)

// Three metrics tell the whole story of chain health in production:
//
//   druz9_llm_call_total{provider,task,status}
//       — per-attempt counter. One increment per chain hop; a fallback
//         chain that eventually succeeds produces multiple increments
//         (one failed + one ok). Label "task" is the Task constant
//         ("vacancies_json" etc.); "status" is classLabel (ok /
//         rate_limited / provider_down / timeout / unauthorized /
//         bad_request / not_supported / unknown).
//
//   druz9_llm_call_duration_seconds{provider,task}
//       — per-attempt wall clock. Histogram. Buckets are coarse because
//         we mostly care about p50 vs p99, not sub-second resolution.
//
//   druz9_llm_fallback_total{provider,reason}
//       — counts every SKIP of a provider because it was cooled at hop
//         time. Helps distinguish "Groq is slow" (rate_limited calls on
//         the duration histogram) from "Groq is permanently blacklisted
//         in our state" (flood of fallback_total with reason=cooled).
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
)

func init() {
	sharedMetrics.Registry.MustRegister(llmCallTotal)
	sharedMetrics.Registry.MustRegister(llmCallDuration)
	sharedMetrics.Registry.MustRegister(llmFallbackTotal)
}

func observeCall(p Provider, task, status string, dur time.Duration) {
	llmCallTotal.WithLabelValues(string(p), task, status).Inc()
	llmCallDuration.WithLabelValues(string(p), task).Observe(dur.Seconds())
}

func incFallback(p Provider, reason string) {
	llmFallbackTotal.WithLabelValues(string(p), reason).Inc()
}
