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

| Env var                       | Default     | Notes                                |
|-------------------------------|-------------|--------------------------------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (empty)     | Если пусто — NoopTracerProvider, спанов не пишем. В проде заполняется когда подключим Tempo в Grafana Cloud. |
| `APP_ENV`                     | (empty)     | Tagged onto every span as `deployment.environment.name`. |

Tracing сейчас disabled by default — wiring готов, но collector не настроен. Включается единой env-переменной когда понадобится.

## Propagation

W3C TraceContext + Baggage propagators are installed globally. Frontend
Sentry already sends `traceparent` headers — the chi middleware extracts
them so the backend span joins the browser-side trace.

## Why a custom pgx tracer?

`pgx-contrib/pgxotel` works fine but pulls extra deps; the inline tracer
in `pgx.go` is ~40 lines and uses only the OTel API surface we already
import. Equivalent semantic conventions (`db.system=postgresql`,
`db.statement=<truncated SQL>`).
