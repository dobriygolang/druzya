// Package metrics exposes Prometheus-format process metrics on /metrics.
//
// The monolith mounts the handler at /metrics on the main router; nginx
// (see infra/nginx/nginx.prod.conf) restricts access to internal/private
// IPs only — never expose this externally. Bible §12 enumerates which
// metrics MUST be present and the alert thresholds that key off them.
//
// To add a metric:
//  1. Declare a CounterVec/HistogramVec/GaugeVec at package scope below.
//  2. Register it in the init() block.
//  3. Increment from the relevant domain code (use bizmetrics package
//     for business events that also need ClickHouse persistence).
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
)

// Registry is the shared Prometheus registry used across the monolith.
// Domain packages attach their counters/histograms via Register(...).
var Registry = prometheus.NewRegistry()

func init() {
	Registry.MustRegister(collectors.NewGoCollector())
	Registry.MustRegister(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
}

// ── HTTP technical metrics ─────────────────────────────────────────────────

// HTTPRequestsTotal counts every served request.
// Use chi's RoutePattern() (not raw URL) for `path` to avoid cardinality
// explosion from path parameters like /user/{uuid}.
var HTTPRequestsTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_http_requests_total",
		Help: "Total HTTP requests served by the monolith, labelled by method/path/status.",
	},
	[]string{"method", "path", "status"},
)

// HTTPRequestDuration records request latencies per route.
// Histogram buckets target the SLO described in bible §12 (p99 < 2s).
var HTTPRequestDuration = prometheus.NewHistogramVec(
	prometheus.HistogramOpts{
		Name:    "druz9_http_request_duration_seconds",
		Help:    "HTTP request latency in seconds. Alert when p99 > 2s for 5m.",
		Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
	},
	[]string{"method", "path", "status"},
)

// HTTPErrorsTotal counts 4xx/5xx responses. Alert when error rate > 1% / 5m.
var HTTPErrorsTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_http_errors_total",
		Help: "HTTP responses with status >= 400. Alert when ratio > 1% for 5m.",
	},
	[]string{"method", "path", "status"},
)

// ── WebSocket metrics ──────────────────────────────────────────────────────

// WSConnectionsActive tracks live websocket connections per hub.
// Alert when total > 500 (per bible §12).
var WSConnectionsActive = prometheus.NewGaugeVec(
	prometheus.GaugeOpts{
		Name: "druz9_ws_active_connections",
		Help: "Active WebSocket connections per hub (arena|mock|editor|feed).",
	},
	[]string{"hub"},
)

// ── LLM metrics ────────────────────────────────────────────────────────────

// LLMRequestDuration histograms LLM provider latency per model+request type.
// Alert when p99 > 30s.
var LLMRequestDuration = prometheus.NewHistogramVec(
	prometheus.HistogramOpts{
		Name:    "druz9_llm_request_duration_seconds",
		Help:    "Latency of LLM provider requests, per model and type.",
		Buckets: []float64{.5, 1, 2, 5, 10, 20, 30, 60, 120},
	},
	[]string{"model", "type"}, // type: chat|completion|embedding|report
)

// LLMTokensTotal counts tokens consumed per model and direction.
// Alert when token cost > $5/hour (computed via LLMCostRubTotal below).
var LLMTokensTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_llm_tokens_total",
		Help: "Tokens consumed from LLM provider, by model and direction (prompt|completion).",
	},
	[]string{"model", "type"},
)

// LLMCostRubTotal accumulates the rouble cost of LLM calls.
// Calculated from token counts via static price table; see RecordLLMUsage.
var LLMCostRubTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_llm_cost_rub_total",
		Help: "Cumulative LLM spend in roubles, per model.",
	},
	[]string{"model"},
)

// ── Judge0 metrics ─────────────────────────────────────────────────────────

// Judge0PendingSubmissions gauges the submission backlog.
// Alert when > 50 — that's where p99 verdict latency starts blowing up.
var Judge0PendingSubmissions = prometheus.NewGauge(
	prometheus.GaugeOpts{
		Name: "druz9_judge0_pending_submissions",
		Help: "Code submissions awaiting a Judge0 verdict.",
	},
)

// ── Business / product metrics ─────────────────────────────────────────────

// MatchesStartedTotal counts arena matches kicked off, by section + mode.
var MatchesStartedTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_matches_started_total",
		Help: "Arena matches started, by section and mode.",
	},
	[]string{"section", "mode"},
)

// MatchesFinishedTotal counts arena matches that reached a terminal state.
// `result` is win|loss|draw|timeout|abandoned.
var MatchesFinishedTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_matches_finished_total",
		Help: "Arena matches finished, by section, mode and result.",
	},
	[]string{"section", "mode", "result"},
)

// MockSessionsTotal counts AI mock sessions by status (completed|abandoned).
// Used to derive the dropout rate; alert when dropout > 40% (bible §12).
var MockSessionsTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_mock_sessions_total",
		Help: "AI mock sessions, by section and terminal status.",
	},
	[]string{"section", "status"},
)

// QueueWaitSeconds histograms matchmaking wait time per section.
// Alert when avg > 3 min for 10m.
var QueueWaitSeconds = prometheus.NewHistogramVec(
	prometheus.HistogramOpts{
		Name:    "druz9_queue_wait_seconds",
		Help:    "Matchmaking queue wait time per section.",
		Buckets: []float64{1, 5, 10, 30, 60, 120, 180, 300, 600},
	},
	[]string{"section"},
)

// ActiveUsers gauges the rolling DAU per tier (free|premium|trial).
// Updated by a periodic reaper that queries ClickHouse.
var ActiveUsers = prometheus.NewGaugeVec(
	prometheus.GaugeOpts{
		Name: "druz9_active_users",
		Help: "Rolling 24h active user count, per subscription tier.",
	},
	[]string{"tier"},
)

// ── Pgxpool metrics ────────────────────────────────────────────────────────
//
// These gauges are populated by a periodic sampler (see
// RegisterPgxPoolCollector) from pgxpool.Stat() — pgx does not expose
// Prometheus directly. Alert when acquire wait > 100 ms for 5 m.

// PgxPoolAcquiredConns — currently acquired connections (busy).
var PgxPoolAcquiredConns = prometheus.NewGauge(
	prometheus.GaugeOpts{
		Name: "druz9_pgxpool_acquired_connections",
		Help: "Pgxpool connections currently acquired by callers (busy).",
	},
)

// PgxPoolIdleConns — idle connections sitting in the pool.
var PgxPoolIdleConns = prometheus.NewGauge(
	prometheus.GaugeOpts{
		Name: "druz9_pgxpool_idle_connections",
		Help: "Pgxpool idle connections ready to be handed out.",
	},
)

// PgxPoolTotalConns — total live connections (acquired + idle + constructing).
var PgxPoolTotalConns = prometheus.NewGauge(
	prometheus.GaugeOpts{
		Name: "druz9_pgxpool_total_connections",
		Help: "Pgxpool total live connections.",
	},
)

// PgxPoolMaxConns — configured upper bound (rarely changes but exposed
// so dashboards can plot utilization = total / max).
var PgxPoolMaxConns = prometheus.NewGauge(
	prometheus.GaugeOpts{
		Name: "druz9_pgxpool_max_connections",
		Help: "Pgxpool MaxConns configuration value.",
	},
)

// PgxPoolAcquireWaitSeconds — cumulative wait time (counter-like, exposed
// as a gauge because pgx keeps it as a monotonically-increasing Duration).
// Use `rate(...[1m])` in Prometheus to derive per-second wait pressure.
var PgxPoolAcquireWaitSeconds = prometheus.NewGauge(
	prometheus.GaugeOpts{
		Name: "druz9_pgxpool_acquire_wait_seconds_total",
		Help: "Cumulative time callers spent waiting for a pgxpool connection. Derive rate() in alerts.",
	},
)

// PgxPoolCanceledAcquires — Acquire calls cancelled before they got a conn.
var PgxPoolCanceledAcquires = prometheus.NewGauge(
	prometheus.GaugeOpts{
		Name: "druz9_pgxpool_canceled_acquires_total",
		Help: "Pgxpool Acquire calls cancelled by context.",
	},
)

// ── Eventbus metrics ───────────────────────────────────────────────────────
//
// Populated by shared/pkg/eventbus. Labels keep topic cardinality bounded
// by the domain event registry, not user input — safe.

// EventbusPublishedTotal counts Publish() calls per topic.
var EventbusPublishedTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_eventbus_published_total",
		Help: "Domain events published via the in-process bus, by topic.",
	},
	[]string{"topic"},
)

// EventbusHandledTotal counts successful handler invocations per topic.
// One publish may cause N handled (fan-out), so handled can exceed published.
var EventbusHandledTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_eventbus_handled_total",
		Help: "Event handler invocations that returned nil, by topic.",
	},
	[]string{"topic"},
)

// EventbusFailedTotal counts handler errors per topic.
// Alert when failed / handled > 0.5%.
var EventbusFailedTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_eventbus_failed_total",
		Help: "Event handler invocations that returned an error, by topic.",
	},
	[]string{"topic"},
)

// EventbusHandleDuration measures per-handler latency.
var EventbusHandleDuration = prometheus.NewHistogramVec(
	prometheus.HistogramOpts{
		Name:    "druz9_eventbus_handle_duration_seconds",
		Help:    "Latency of event handler execution, by topic.",
		Buckets: []float64{.001, .005, .01, .05, .1, .25, .5, 1, 2.5, 5},
	},
	[]string{"topic"},
)

// ── Connect-RPC metrics ────────────────────────────────────────────────────
//
// Populated by a Connect interceptor (see shared/pkg/metrics.ConnectInterceptor
// — if the interceptor is not yet wired, these stay at zero; Chi middleware
// covers the HTTP layer, but Connect procedures benefit from per-procedure
// labels (package.Service/Method) which the router middleware loses.

// ConnectRequestsTotal counts RPC calls per procedure + code.
var ConnectRequestsTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_connect_requests_total",
		Help: "Connect-RPC calls, by full procedure and Connect error code (ok|unknown|invalid_argument|...).",
	},
	[]string{"procedure", "code"},
)

// ConnectRequestDuration measures RPC latency per procedure.
var ConnectRequestDuration = prometheus.NewHistogramVec(
	prometheus.HistogramOpts{
		Name:    "druz9_connect_request_duration_seconds",
		Help:    "Connect-RPC call latency, by procedure.",
		Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
	},
	[]string{"procedure"},
)

// ── Cache + parser observability ───────────────────────────────────────────

// CacheSetErrorsTotal counts Redis SET failures encountered after a successful
// upstream load. The read still succeeds (we have the value), but the cache
// write was lost — alert when the rate climbs (Redis OOM / failover / bad
// route). Labelled by module so ops can pinpoint the noisy client.
var CacheSetErrorsTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_cache_set_errors_total",
		Help: "Redis SET failures from per-module read-through caches. Read still served; cache write was lost.",
	},
	[]string{"module"},
)

// VacanciesParserErrorsTotal counts hard parser failures (fetch / decode /
// non-2xx) per source. Loud sibling of the previous "log + return []" that
// used to mask broken sources. Alert when one source's rate jumps.
var VacanciesParserErrorsTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_vacancies_parser_errors_total",
		Help: "Hard parser failures (fetch/decode/non-2xx) per source. Sync continues to next source.",
	},
	[]string{"source"},
)

// VacanciesCacheRefreshErrorsTotal counts per-source refresh failures in the
// in-memory vacancies cache. Anti-fallback: a failure does NOT zero the
// bucket; the prior fetch survives so one portal outage doesn't blank the
// catalogue. Alert when one source's rate climbs.
var VacanciesCacheRefreshErrorsTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_vacancies_cache_refresh_errors_total",
		Help: "Per-source vacancies cache refresh failures. Prior bucket retained.",
	},
	[]string{"source"},
)

// VacanciesDetailsFetchErrorsTotal counts per-source detail-endpoint
// failures (Phase 4 lazy detail enrichment). Anti-fallback: on failure the
// detail cache returns the listing snapshot as VacancyDetails — never a
// fabricated description. Alert when one source's rate climbs.
var VacanciesDetailsFetchErrorsTotal = prometheus.NewCounterVec(
	prometheus.CounterOpts{
		Name: "druz9_vacancies_details_fetch_errors_total",
		Help: "Per-source detail enrichment failures (lazy detail cache).",
	},
	[]string{"source"},
)

func init() {
	Registry.MustRegister(
		HTTPRequestsTotal, HTTPRequestDuration, HTTPErrorsTotal,
		WSConnectionsActive,
		LLMRequestDuration, LLMTokensTotal, LLMCostRubTotal,
		Judge0PendingSubmissions,
		MatchesStartedTotal, MatchesFinishedTotal,
		MockSessionsTotal, QueueWaitSeconds, ActiveUsers,
		CacheSetErrorsTotal, VacanciesParserErrorsTotal,
		VacanciesCacheRefreshErrorsTotal,
		VacanciesDetailsFetchErrorsTotal,
		PgxPoolAcquiredConns, PgxPoolIdleConns, PgxPoolTotalConns,
		PgxPoolMaxConns, PgxPoolAcquireWaitSeconds, PgxPoolCanceledAcquires,
		EventbusPublishedTotal, EventbusHandledTotal, EventbusFailedTotal,
		EventbusHandleDuration,
		ConnectRequestsTotal, ConnectRequestDuration,
	)
}

// ── Pricing helpers ─────────────────────────────────────────────────────────

// llmPriceRubPer1k is a coarse pricing table (RUB per 1000 tokens), used to
// translate raw token counts into cost. Update when contracts change.
// Values are illustrative — production should pull from cfg or a CMS table.
var llmPriceRubPer1k = map[string]struct{ prompt, completion float64 }{
	"openai/gpt-4o-mini":   {0.18, 0.72},
	"openai/gpt-4o":        {2.5, 10.0},
	"anthropic/claude-3.5": {2.7, 13.5},
	"yandexgpt/lite":       {0.20, 0.20},
	"yandexgpt/pro":        {1.20, 1.20},
}

// RecordLLMUsage increments the token counter and the RUB cost counter
// for one provider call. `tokensIn` is prompt tokens, `tokensOut` is
// completion tokens. Unknown models are tallied with zero cost.
func RecordLLMUsage(model string, tokensIn, tokensOut int) {
	LLMTokensTotal.WithLabelValues(model, "prompt").Add(float64(tokensIn))
	LLMTokensTotal.WithLabelValues(model, "completion").Add(float64(tokensOut))
	if p, ok := llmPriceRubPer1k[model]; ok {
		cost := (float64(tokensIn)/1000.0)*p.prompt + (float64(tokensOut)/1000.0)*p.completion
		LLMCostRubTotal.WithLabelValues(model).Add(cost)
	}
}
