# metrics

Prometheus metric registry for the druz9 monolith. Mounted at `/metrics`
by `cmd/monolith/main.go`. Access is gated by nginx (private IPs only) —
**do not expose externally**.

See `druz9-bible.md §12` for SLOs and alert thresholds.

## Technical metrics

| Name | Type | Labels | Purpose / Alert |
|------|------|--------|-----------------|
| `druz9_http_requests_total` | counter | method, path, status | Request volume per route. |
| `druz9_http_request_duration_seconds` | histogram | method, path, status | Latency. Alert when p99 > 2s for 5m. |
| `druz9_http_errors_total` | counter | method, path, status | 4xx/5xx count. Alert when error ratio > 1% for 5m. |
| `druz9_ws_active_connections` | gauge | hub | WS sockets per hub. Alert when sum > 500. |
| `druz9_llm_request_duration_seconds` | histogram | model, type | LLM call latency. Alert when p99 > 30s. |
| `druz9_llm_tokens_total` | counter | model, type | Tokens consumed (prompt/completion). |
| `druz9_llm_cost_rub_total` | counter | model | Cumulative spend in RUB. Alert when delta > 5 USD/h. |
| `druz9_judge0_pending_submissions` | gauge | – | Submission backlog. Alert when > 50. |

System resource metrics (`pg_stat_activity_count`, `redis_memory_used_bytes`,
`node_filesystem_avail_bytes`) are exported by sidecar exporters (postgres_exporter,
redis_exporter, node_exporter) and scraped directly — see `infra/monitoring/prometheus.yml`.

## Business metrics (also written to ClickHouse)

| Name | Type | Labels | Purpose |
|------|------|--------|---------|
| `druz9_matches_started_total` | counter | section, mode | Matches per day per section. |
| `druz9_matches_finished_total` | counter | section, mode, result | Win/loss/abandon ratios. |
| `druz9_mock_sessions_total` | counter | section, status | Mock completion vs abandonment. Alert when dropout > 40%. |
| `druz9_queue_wait_seconds` | histogram | section | Matchmaking wait. Alert when avg > 3 min for 10m. |
| `druz9_active_users` | gauge | tier | DAU by tier (updated by background reaper). |

## Adding a new metric

1. Declare it in `metrics.go` at package scope.
2. Register it in the `init()` block.
3. Increment from domain code, OR — if it represents a business event that
   also needs ClickHouse persistence — call the appropriate
   `bizmetrics.Record*` helper.

Always use **chi route patterns** (not raw URLs) for HTTP labels to avoid
cardinality explosion from path parameters like `/user/{uuid}`.
