# Observability

Что мерится, чем смотрится, как алерты долетают.

## Стек

```
backend/api ──┬──> Prometheus (local TSDB 6h) ──> remote_write ──> Grafana Cloud (Mimir)
              │                                                        ↓
              │                                                     dashboards
              │                                                        ↓
              ├──> Loki ──> promtail (логи)                    Alerts & IRM (rules)
              │                                                        ↓
              └──> Sentry (renderer + main process Hone/Cue)   Telegram @druz9_bot
```

Конфиги — в `infra/monitoring/`. Подцепляется `infra/docker-compose.prod.yml`. Локального обсервабилити-стека нет — смотрим прод через Grafana Cloud.

## Метрики

Всё под namespace `druz9_*`, эмитится из `backend/shared/pkg/metrics/`. Подключение — через `middleware.Prometheus` в Connect-RPC chain + per-pgxpool collector.

| Метрика | Что |
|---|---|
| `druz9_http_requests_total{status, method, route}` | RPS + error rate |
| `druz9_http_request_duration_seconds` | Histogram p50/p95/p99 |
| `druz9_ws_connections{endpoint}` | Открытые WS-сессии (arena/mock/editor/whiteboard/feed) |
| `druz9_pgxpool_*` | Postgres pool: acquired / idle / wait_count |
| `druz9_redis_*` | Redis: ops/sec, latency |
| `druz9_llm_requests_total{provider, task, status}` | LLM-вызовы по chain'у |
| `druz9_llm_tokens_total{provider, task, kind}` | Tokens in/out |
| `druz9_llm_latency_seconds{provider, task}` | Latency по провайдерам |

Бизнес-метрики (`druz9_business_*`) приходят из `shared/pkg/bizmetrics/` — match-start rate, mock dropout, ratings churn.

## Grafana dashboards

В `infra/monitoring/grafana-dashboards/` — 6 готовых JSON. Импорт: Grafana Cloud → Dashboards → + Create → Import → Upload JSON.

| Файл | UID | Что показывает |
|---|---|---|
| `druz9-overview.json` | `druz9-overview` | Главный «здорово ли» — p99, error rate, error logs из Loki |
| `druz9-tech.json` | `druz9-tech` | HTTP / WS / Postgres pool / Redis system view |
| `druz9-llm.json` | `druz9-llm` | LLM spend (хоть и free-tier, рейт-лимиты считаем), token throughput, latency by model |
| `druz9-business.json` | `druz9-business` | Match start rate, mock dropout, ratings churn |
| `druz9-arena.json` | `druz9-arena` | Arena RPS, queue depth, match results, win rate |
| `druz9-auth.json` | `druz9-auth` | Login success/fail, OAuth provider mix, DAU |

Правка дашбордов — **в репо первой**, потом re-import. Hand-edit в Grafana UI теряется на следующем импорте.

## Alert rules

В `infra/monitoring/alerts/` — два YAML-файла под Prometheus alerting format. Импорт в Grafana Cloud → Alerts & IRM → Alert rules → From YAML file.

### `critical.yml` — пейджит on-call (SEV1)

| Алерт | Условие | Триггер |
|---|---|---|
| `APIErrorRateHigh` | 5xx rate > 1% за 5m | Что-то поломалось в проде |
| `APILatencyP99High` | p99 > 1s за 5m | Деградация — LLM провайдер тупит, БД залипла |
| `APIDown` | `up{job="druz9-api"} == 0` за 1m | Бинарь упал, healthcheck не отвечает |
| `LLMChainFailure` | Все провайдеры в chain дают error | Free-tier лежит — переключаем kill-switch на degraded mode |
| `PostgresDown` | Postgres unreachable | Прод-БД ушла |
| `RedisDown` | Redis unreachable | Quotas / rate-limits / kill-switches не работают |

### `warning.yml` — notify-only (SEV2)

| Алерт | Условие | Что значит |
|---|---|---|
| `ArenaQueueBacklog` | matchmaker queue > 50 | Не хватает противников / проблема matchmaker'а |
| `KataDifficultyDrift` | Daily kata accuracy < 30% или > 90% | Калибровка taskpool сломана |
| `LLMSlowness` | Groq latency > 5s | Один провайдер деградирует, fallback chain переключается |
| `MockDropoutHigh` | > 40% mock-сессий abandon'ятся | UX-проблема с продуктом |

## Notification channel

Алерты идут в Telegram через `@druz9_bot` (тот же бот, что отвечает за user-notifications):

- **Chat ID**: `TELEGRAM_OPS_CHAT_ID` в `.env.prod` (приватная группа, в ней только on-call).
- **Bot token**: `TELEGRAM_BOT_TOKEN`.
- **Contact point в Grafana Cloud**: `druz9-telegram` (Integration: Telegram).

Routing: `severity=critical` → telegram-ops, `severity=warning` → тот же канал, но с другой темплейтой (без `@oncall` mention).

## Logs (Loki)

`promtail` собирает stdout всех контейнеров из docker-compose, Loki индексирует. Запросы через Grafana Explore:

```logql
{container="druz9-api"} |= "ERROR" | json | line_format "{{.msg}}"
```

Структурированный slog в `shared/pkg/logger/` — все логи с `level=error|warn` парсятся в JSON, поля доступны для фильтрации (`user_id`, `task`, `provider`, `request_id`).

## Sentry

DSN configured per-app:

- `SENTRY_DSN_API` — backend/api main process.
- `HONE_SENTRY_DSN` — Hone main + renderer (init в `hone/src/main/index.ts` и `renderer/src/main.tsx`).
- `CUE_SENTRY_DSN` — Cue, аналогично.

Source-map upload в CI workflow при релизе (см `deployment.md`).

## Что мониторить руками (без алертов)

Не всё стоит автоматизировать — некоторые вещи ловятся только глазами раз в неделю:

- **LLM token-cost trend** — есть free-tier лимиты у Groq/Cerebras/Mistral. Через `druz9_llm_tokens_total` в `druz9-llm.json` видно, не подходим ли мы к 80% от лимита провайдера.
- **Mock-block strict_pct** — сколько mock-сессий в strict mode. < 50% — индикатор что watermark теряет ценность; см admin dashboard.
- **Cue meeting-mode usage** — auto-suggest pill activation rate. Ниже 5% от open-сессий = либо trigger-policy слишком жадная, либо никто не использует.

## Что НЕ покрыто (известные пробелы)

- **Tracing disabled.** OTLP exporter wired (`shared/pkg/otel/`), но `OTEL_EXPORTER_OTLP_ENDPOINT` пуст → NoopTracerProvider. Когда понадобится — Tempo в Grafana Cloud + endpoint в `.env.prod`.
- **Frontend RUM** — нет Real User Monitoring для web/Hone/Cue. Sentry ловит errors, но не performance.
- **Alert на LLM-quota approaching limit** — только на `LLMChainFailure` (когда уже всё). Polling-проверка raw rate-limit headers от провайдеров — TODO.

## Связь с deployment

Alerting wiring и kill-switch операции — в [deployment.md §Аварийные процедуры](./deployment.md#аварийные-процедуры). Тут — что мерится; там — что делать когда мерилка позеленела/покраснела.
