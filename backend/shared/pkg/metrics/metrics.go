// Package metrics exposes Prometheus-format process metrics on /metrics.
// The monolith registers the handler at boot; nginx restricts access to
// internal/private IPs only (see infra/nginx/nginx.prod.conf).
package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Registry is the shared Prometheus registry used across the monolith.
// Domain packages attach their counters/histograms via Register(...).
var Registry = prometheus.NewRegistry()

func init() {
	Registry.MustRegister(collectors.NewGoCollector())
	Registry.MustRegister(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
}

// HTTPRequestsTotal is the canonical per-route counter. Use it from middleware.
var HTTPRequestsTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_http_requests_total",
		Help: "Total HTTP requests served by the monolith, labelled by method/path/status.",
	},
	[]string{"method", "path", "status"},
)

// HTTPRequestDuration records request durations per route.
var HTTPRequestDuration = prometheus.NewHistogramVec(
	prometheus.HistogramOpts{
		Name:    "druz9_http_request_duration_seconds",
		Help:    "HTTP request latency in seconds.",
		Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
	},
	[]string{"method", "path"},
)

// WSConnectionsActive tracks live websocket connections per hub.
var WSConnectionsActive = prometheus.NewGaugeVec(
	prometheus.GaugeOpts{
		Name: "druz9_ws_connections_active",
		Help: "Active WebSocket connections per hub (arena|mock|editor|feed).",
	},
	[]string{"hub"},
)

// LLMTokensTotal is a counter for OpenRouter token usage per model+direction.
// Critical for cost-per-session tracking (bible §12).
var LLMTokensTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_llm_tokens_total",
		Help: "Tokens consumed from LLM provider, by model and direction.",
	},
	[]string{"model", "direction"}, // direction: prompt|completion
)

// Judge0PendingSubmissions gauges the submission backlog.
var Judge0PendingSubmissions = prometheus.NewGauge(
	prometheus.GaugeOpts{
		Name: "druz9_judge0_pending_submissions",
		Help: "Code submissions awaiting a Judge0 verdict.",
	},
)

func init() {
	Registry.MustRegister(HTTPRequestsTotal, HTTPRequestDuration, WSConnectionsActive, LLMTokensTotal, Judge0PendingSubmissions)
}

// Handler returns the http.Handler that renders metrics in Prometheus format.
// Mount at /metrics in the root chi router; rely on nginx to restrict access.
func Handler() http.Handler {
	return promhttp.HandlerFor(Registry, promhttp.HandlerOpts{
		Registry:          Registry,
		EnableOpenMetrics: true,
	})
}
