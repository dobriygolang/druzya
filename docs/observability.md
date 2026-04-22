# Observability

Full-stack tracing, metrics, and logs for druz9. Built on OpenTelemetry +
Prometheus + Loki + Grafana, with Sentry sitting on the frontend for
error reporting and session replay.

## Architecture

```
                ┌─────────────┐
   Browser ───► │  Frontend   │ ── traceparent ──┐
                │ (Sentry)    │                  │
                └─────────────┘                  ▼
                                         ┌──────────────┐
                                         │ druz9 API    │
                                         │ (chi + OTel) │
                                         └─┬───────┬────┘
                                           │       │
                                  OTLP/HTTP│       │stdout JSON
                                           ▼       ▼
                                  ┌──────────┐  ┌──────────┐
                                  │  Jaeger  │  │ Promtail │
                                  └────┬─────┘  └────┬─────┘
                                       │             ▼
              ┌─ Prometheus scrape ─┐  │        ┌──────┐
              │   /metrics :8080    │  │        │ Loki │
              ▼                     │  │        └──┬───┘
        ┌────────────┐              │  │           │
        │ Prometheus │──────────────┼──┼───────────┤
        └─────┬──────┘              │  │           │
              │                     │  │           │
              ▼                     ▼  ▼           ▼
                          ┌─────────────────────────────┐
                          │           Grafana           │
                          │  dashboards / alerts / logs │
                          └─────────────────────────────┘
```

- **Traces** — Every chi handler is wrapped in a span by
  `shared/pkg/otel.WithTracer`. Every pgx query produces a child span via
  `otel.WrapPool`. W3C `traceparent` headers from the browser are honored,
  so Sentry → backend traces stitch into one waterfall.
- **Metrics** — Existing `/metrics` Prometheus endpoint
  (`shared/pkg/metrics`). Prometheus scrapes `api:8080` every 15s.
- **Logs** — `slog` JSON to stdout, decorated with `service`, `request_id`,
  `trace_id`, `span_id` (the trace_id comes for free from the active span).
  Promtail tails Docker container stdout and ships to Loki.

## Local development

```bash
# Boots app + observability together.
docker-compose -f docker-compose.yml \
               -f infra/observability/docker-compose.obs.yml up
```

| URL                          | Purpose                              |
|------------------------------|--------------------------------------|
| <http://localhost:16686>     | Jaeger UI — search traces            |
| <http://localhost:3000>      | Grafana (admin / admin)              |
| <http://localhost:9090>      | Prometheus UI                        |
| <http://localhost:3100>      | Loki HTTP API (use via Grafana)      |
| <http://localhost:8080/metrics> | API Prometheus endpoint           |

The "druz9 — Overview" dashboard is auto-provisioned in Grafana with HTTP
p99 latency, error rate, recent error logs, and trace search.

### Without the obs stack

If you only `docker-compose up` (no `-f obs.yml`), the API still starts
fine — `InitTracer` warns "otel init failed" and continues. Useful when
iterating on app code without the extra RAM cost.

## Adding traces to a new service

1. Import the package:

   ```go
   import dotel "druz9/shared/pkg/otel"
   ```

2. Init at the top of `main`:

   ```go
   shutdown, err := dotel.InitTracer("druz9-myservice", buildVersion)
   if err != nil { /* warn + continue */ }
   defer shutdown()
   ```

3. Wrap chi router and build a traced pgx pool:

   ```go
   r.Use(dotel.WithTracer(dotel.Tracer("druz9/http")))
   pool, _ := dotel.NewTracedPool(ctx, dsn)
   ```

4. Ship logs through `shared/pkg/logger`:

   ```go
   r.Use(logger.Middleware(logger.Init("druz9-myservice")))
   ```

5. (Optional) custom spans for hot paths:

   ```go
   ctx, span := dotel.Tracer("druz9/myservice").Start(ctx, "DoExpensiveThing")
   defer span.End()
   ```

That's it — Prometheus picks up `/metrics` automatically (add a scrape
job in `infra/observability/prometheus.yml`), Promtail picks up Docker
stdout automatically.

## Frontend `track()`

`frontend/src/lib/observability.ts` exposes:

- `track(event, props?)` — custom user event (Sentry breadcrumb +
  Plausible / GA pageview when those are wired).
- `identifyUser(id, email?)` — sets the user on Sentry scope, becomes a
  tag on every subsequent event.
- `captureError(err, ctx?)` — manual error report (rare; the React
  ErrorBoundary handles unhandled cases).

`@sentry/react` already injects W3C `traceparent` on `fetch` calls when
`tracesSampleRate > 0`, so backend spans automatically join the
browser-side trace.

## Production deployment

1. **Hosted vs self-hosted** — Prefer Grafana Cloud or Honeycomb for
   prod. Set `OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.<vendor>` and add
   the auth header via `OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer ...`.
2. **Sampling** — `InitTracer` uses `ParentBased(AlwaysSample)`. Switch
   to `ParentBased(TraceIDRatioBased(0.1))` once volume justifies it.
3. **PII** — `db.statement` is truncated to 1KiB but raw SQL still leaks.
   Strip query parameters via a custom `SpanProcessor` before exporting
   to a vendor that bills per byte.
4. **Alerts** — wire Grafana / Alertmanager → Telegram bot. Triggers
   from the bible:
   - p99 > 2s for 5m
   - 5xx rate > 1% for 5m
   - LLM tokens > $5/h
   - Disk < 20%
   - Judge0 queue > 50
5. **Secrets** — never commit OTLP auth headers, Sentry DSNs, or Grafana
   admin passwords. Use the existing `.env` flow; CI injects at deploy.

## Frontend errors → Sentry

Activated through `VITE_SENTRY_DSN`. ErrorBoundary in `main.tsx` catches
React errors. See `frontend/src/lib/observability.ts` for the helper API.
