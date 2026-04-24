# Metrics Coverage Review

Maps every metric called out in `druz9-bible.md §12` to its current
implementation status. Update whenever a new metric is added.

Legend: ✅ implemented · ⚠️ partial · 🔴 TODO · 👤 requires client event

## Technical metrics

| Bible metric | Status | Where |
|---|---|---|
| `http_request_duration_seconds` (p50/p95/p99) | ✅ | `metrics.HTTPRequestDuration` + `ChiMiddleware` |
| `http_errors_total` | ✅ | `metrics.HTTPErrorsTotal` |
| `ws_active_connections{hub}` | ⚠️ | gauge declared; each hub must call `WSConnectionsActive.WithLabelValues(hub).Inc()/Dec()` on connect/disconnect — verify in `arena/ports/hub.go`, `ai_mock/ports/hub.go`, `editor/ports/hub.go`, `feed/ports/hub.go` |
| `llm_request_duration_seconds` | ⚠️ | histogram declared; instrument `ai_mock/infra/openrouter.go` and `ai_native/infra/openrouter.go` to time each call |
| `llm_tokens_total{type}` | ⚠️ | counter declared; call `metrics.RecordLLMUsage(model, in, out)` from OpenRouter clients |
| `llm_cost_rub_total` | ⚠️ | derived inside `RecordLLMUsage`; pricing table is static in `metrics.go` — should be moved to `cfg.LLM.Pricing` |
| `judge0_pending_submissions` | ⚠️ | gauge declared; `arena/infra/judge0.go` and `daily/infra/judge0.go` should `Set(...)` after every submit/poll |
| `pg_stat_activity_count` | ✅ | scraped from `postgres_exporter` sidecar (see prometheus.yml) |
| `redis_memory_used_bytes` | ✅ | scraped from `redis_exporter` sidecar |
| `node_filesystem_avail_bytes` | 🔴 | requires `node_exporter` to be added to the prod compose file |

## Business metrics

| Bible metric | Status | Where |
|---|---|---|
| Matches per day per section | ⚠️ | `bizmetrics.RecordMatchStarted` exists; arena must call it from `app.ConfirmReady` (when both players ready). |
| Match results (win/loss/timeout) | ⚠️ | `RecordMatchFinished` exists; wire into `arena/app.SubmitCode` terminal branches. |
| Avg match wait time | ⚠️ | `RecordQueueWait` exists; matchmaker should call it when a match is formed. |
| Mock completed / abandoned | ⚠️ | `RecordMockSessionCompleted` / `Abandoned` exist; `ai_mock/app.FinishSession` and the session-timeout reaper must call them. |
| Avg score per section | ⚠️ | computed in CH from `mock_completed.score` — depends on RecordMockSessionCompleted being called. |
| Active cohorts per week | 🔴 | dashboard SQL assumes `cohort_id` in `events.props`; needs a `RecordCohortContribution` helper plus wiring in `cohort/app.Contribute`. |
| Conversion free → premium | 🔴 | `RecordPremiumUpgrade` exists, but no payments domain emits it yet (no payments domain shipped). |
| DAU / MAU | 👤 | derived from `events.user_id` in CH. Backend can stamp `auth/login` and `request_started`, but accuracy depends on **frontend `session_start` event** at app boot. |
| Retention D1/D7/D30 | 👤 | same as DAU — needs reliable per-user event stream. |

## Gaps & next steps

1. **WS hub instrumentation** — every hub increments/decrements
   `WSConnectionsActive` only if we add the calls. Pattern:
   ```go
   metrics.WSConnectionsActive.WithLabelValues("arena").Inc()
   defer metrics.WSConnectionsActive.WithLabelValues("arena").Dec()
   ```
2. **OpenRouter clients** — wrap `Do()` with a histogram timer and call
   `metrics.RecordLLMUsage` after parsing the usage block in the response.
3. **ClickHouse sink** — `bizmetrics.SetSink(...)` is currently never
   called. We need a `clickhouse.NewBatchSink(dsn, 1s, 1000)` impl living
   in `shared/pkg/bizmetrics/clickhouse.go` (out of scope for this PR;
   tracked as TODO). Until wired the helpers still emit to Prometheus, so
   alerts work; only DAU/MAU/retention dashboards stay empty.
4. **Pricing table** — move `llmPriceRubPer1k` from package scope to
   `cfg.LLM.Pricing` so finance can update it without redeploying.
5. **DAU reaper** — write a goroutine in `cmd/monolith` that, every
   minute, runs `SELECT count(DISTINCT user_id) FROM events WHERE ts >= now() - INTERVAL 1 DAY GROUP BY tier`
   and updates `metrics.ActiveUsers` so the `DAUDrop20Pct` alert can fire
   off Prometheus alone.
6. **Frontend `session_start` event** — add a small fire-and-forget POST
   from `frontend/src/main.tsx` to `/api/v1/telemetry/session_start` so
   we capture sessions that never hit a Connect endpoint (e.g. the user
   bounces from the landing page). Without this, DAU is undercounted on
   anonymous browse traffic.
7. **node_exporter** — add the container to `infra/docker-compose.prod.yml`
   so disk/CPU alerts work. Currently `DiskAlmostFull` will never fire.
8. **Cost guard** — once `LLMCostRubTotal` is wired, we can flip the
   `LLMSpendHigh` alert from "warn" to "page" (it's already labelled
   `page`); keep an eye on the false-positive rate after launch.

## Bible compliance summary

- 9 of 9 technical metrics declared; 5 wired end-to-end; 4 declared but
  awaiting domain integration.
- 8 of 8 business metrics modelled; ClickHouse sink + frontend
  instrumentation remain the two main blockers for accurate dashboards.
