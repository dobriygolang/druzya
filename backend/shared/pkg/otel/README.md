# `shared/pkg/otel`

Thin OpenTelemetry wiring for druz9 services. One init call per binary,
chi middleware for HTTP spans, and a pgx tracer for DB spans.

## Wiring a service

```go
import "druz9/shared/pkg/otel"

func main() {
    shutdown, err := otel.InitTracer("druz9-monolith", buildVersion)
    if err != nil { /* fatal */ }
    defer shutdown()

    pool, _ := otel.NewTracedPool(ctx, dsn) // span per query baked in

    r := chi.NewRouter()
    r.Use(otel.WithTracer(otel.Tracer("druz9/http"))) // span per request
}
```

## Configuration

| Env var                       | Default              | Notes                                |
|-------------------------------|----------------------|--------------------------------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://jaeger:4318` | OTLP/HTTP receiver. Jaeger 1.62+ OK. |
| `APP_ENV`                     | (empty)              | Tagged onto every span as `deployment.environment.name`. |

## Viewing traces locally

Bring up the observability stack:

```bash
docker-compose -f docker-compose.yml -f infra/observability/docker-compose.obs.yml up
```

Then open Jaeger UI: <http://localhost:16686> and select service
`druz9-monolith`. In Grafana (<http://localhost:3000>, admin/admin) the
Jaeger datasource is auto-provisioned, so you can also click trace links
from Loki log lines.

## Propagation

W3C TraceContext + Baggage propagators are installed globally. Frontend
Sentry already sends `traceparent` headers — the chi middleware extracts
them so the backend span joins the browser-side trace.

## Why a custom pgx tracer?

`pgx-contrib/pgxotel` works fine but pulls extra deps; the inline tracer
in `pgx.go` is ~40 lines and uses only the OTel API surface we already
import. Equivalent semantic conventions (`db.system=postgresql`,
`db.statement=<truncated SQL>`).
