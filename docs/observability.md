# Observability — статус

## Что подключено
- ✅ **Frontend errors → Sentry** (`@sentry/react`). Активируется через `VITE_SENTRY_DSN`. ErrorBoundary в `main.tsx` ловит React-ошибки. Хелперы `track()` / `identifyUser()` в `src/lib/observability.ts`.

## TODO для прода

### 1. Backend traces — OpenTelemetry → Jaeger или Tempo
**Зачем:** видеть полный путь запроса через сервисы (HTTP → gRPC → DB → Redis → external API).

**Setup:**
```go
// backend/shared/pkg/otel/init.go
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/sdk/trace"
)
// init exporter pointing to OTEL_EXPORTER_OTLP_ENDPOINT (default http://jaeger:4318)
// add tracer middleware to chi router → spans per HTTP handler
// pgx auto-instrumentation via pgxotel
```

Docker-compose:
```yaml
jaeger:
  image: jaegertracing/all-in-one:1.62
  environment:
    COLLECTOR_OTLP_ENABLED: "true"
  ports:
    - "16686:16686"  # UI
    - "4318:4318"    # OTLP HTTP receiver
```

Frontend → backend trace propagation: `traceparent` header (Sentry уже умеет).

### 2. Backend logs — Loki (структурированные)
Уже в bible. Stdout JSON логи через `slog` → `promtail` → `loki` → Grafana panels.

### 3. Backend metrics — Prometheus
Уже в bible. `/metrics` endpoint в каждом сервисе → Prom scrape → Grafana dashboards.
Ключевые метрики: HTTP latency p99, error rate, WS connections, AI tokens/час, DB pool, Judge0 queue.

### 4. Алерты → Telegram
Grafana/Alertmanager → webhook → Telegram bot. Триггеры:
- p99 > 2s
- error rate > 1% за 5 мин
- LLM tokens > $5/час
- Disk < 20%
- Judge0 queue > 50

## Запуск Sentry в проде
1. `sentry.io` → создай проект (React + Browser).
2. Скопируй DSN.
3. `.env.production`:
   ```
   VITE_SENTRY_DSN=https://abc@123.ingest.sentry.io/456
   VITE_RELEASE=v0.4.0   # коммит/тег для деплоя
   ```
4. CI деплой инжектит — done. Ошибки автоматически летят, Replay работает (10% сэмпл, 100% при ошибке).
