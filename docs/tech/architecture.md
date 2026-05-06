# Архитектура

Монорепо: один Go-монолит на бэкенде, три клиента на фронте (web, Hone, Cue), один контракт API через Protocol Buffers.

## Высокоуровневая схема

```
                        ┌────────────────────────────────┐
                        │        proto/druz9/v1/         │
                        │   Источник правды API (~27 .proto)
                        └──────────────┬─────────────────┘
                                       │ buf generate
                  ┌────────────────────┼────────────────────┐
                  ▼                    ▼                    ▼
       ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐
       │ backend/shared/  │  │ frontend/src/api/│  │ hone, desktop      │
       │ generated/pb     │  │ generated/       │  │ алиасят через      │
       │ (Go server-side) │  │ (Connect-ES)     │  │ @generated/*       │
       └──────────────────┘  └──────────────────┘  └────────────────────┘

                        ┌────────────────────────────────┐
                        │   backend/cmd/monolith/        │
                        │   Один бинарь, все сервисы     │
                        │   слушают на :8080             │
                        └──────────────┬─────────────────┘
                                       │
                  ┌────────────────────┼────────────────────┐
                  ▼                    ▼                    ▼
        ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
        │  Postgres        │ │  Redis            │ │  ClickHouse       │
        │  Goose migrations│ │  rate limit, KS,  │ │  events sink      │
        │  pgx + sqlc      │ │  quota, locks     │ │  (Insights)       │
        └──────────────────┘ └──────────────────┘ └──────────────────┘
                                       │
                              ┌────────┴────────┐
                              ▼                 ▼
                       ┌─────────────┐  ┌──────────────┐
                       │ MinIO/S3    │  │  Judge0      │
                       │ podcasts,   │  │  code judge   │
                       │ uploads     │  │  (containerized)
                       └─────────────┘  └──────────────┘
```

## Транспорт

**Connect-RPC** — один HTTP-эндпоинт, три способа вызова на одном пути:

- gRPC (нативный protobuf) — для Go-Go сервис-клиентов.
- gRPC-Web — для legacy-клиентов.
- HTTP+JSON через [vanguard-go](https://github.com/connectrpc/vanguard-go) transcoder, читает `google.api.http` аннотации в proto и поднимает REST-альтернативу (`/api/v1/*`).

В браузере используется `@connectrpc/connect-web` через `fetch`. Никакого envoy / API-gateway.

WebSocket'ы / SSE для real-time:

- `/ws/mock` — mock-собеседования.
- `/ws/editor/{id}` — Yjs-сессии редактора.
- `/ws/whiteboard/{id}` — multiplayer Excalidraw (Yjs).
- `/api/v1/hone/cursor/events` — AICursor SSE (TaskBoard auto-categorise events).

## Чистая архитектура внутри сервисов

Каждый сервис в `backend/services/<domain>/` следует одной структуре:

```
services/<domain>/
├── go.mod                   Свой модуль (изоляция зависимостей)
├── domain/                  Чистая логика
│   ├── entity.go            Структуры предметной области
│   ├── repo.go              Интерфейсы репозиториев
│   ├── events.go            Доменные события для EventBus
│   └── errors.go            Sentinel-ошибки
├── app/                     Use cases (оркестрация)
│   └── *.go                 Например plan.go, focus.go
├── infra/                   Внешние зависимости
│   ├── postgres.go          pgx-репозитории
│   ├── redis.go             Кэш / rate limit
│   └── llm.go               LLMChain-адаптеры
└── ports/                   Транспорт
    └── server.go            Connect-RPC handlers
```

Зависимости: `ports → app → domain ← infra`. Domain ничего не импортирует, infra реализует интерфейсы из domain.

## Доменные события

Сервисы общаются **только** через `shared/domain/events.go` + EventBus. Прямых импортов сервис-в-сервис нет. При выносе в отдельный микросервис меняется только wiring в `cmd/monolith/main.go`.

## LLM-стек

Один маршрутизатор `backend/shared/pkg/llmchain/` решает «куда пойти» с приоритетом по падению:

```
Groq (primary) → Cerebras → Mistral → OpenRouter (:free lane) → Ollama (floor)
```

Все — **бесплатные tier'ы**. Никаких платных провайдеров. См [conventions.md §LLM](./conventions.md#llm-провайдеры) — это жёсткое правило.

LLM-задачи описаны как `Task*` constants. Каждый Task знает свой prompt template, JSON-mode policy, fallback chain. Примеры:

- `TaskCopilotStream` — стриминг ответа Cue.
- `TaskDailyPlanSynthesis` — план дня в Hone.
- `TaskSysDesignCritique` — критика whiteboard.
- `TaskCodingHint` — auto-suggest pill в Cue.

Кэш над LLM — `backend/shared/pkg/llmcache/` с семантическим поиском (Ollama embedder + bge-small).

## Auth

Один `druz9 Pro` access token (Yandex / Telegram OAuth). Hone и Cue хранят в keychain через `safeStorage` (без `keytar` нативной зависимости). На сервере проверяется `Bearer` на каждый Connect-вызов.

## Sync

Backend-сервис `backend/services/sync/` обслуживает CRDT-синк для Hone (Y.Doc updates по `/sync/yjs/notes/{id}/(append|updates|compact)`). Для focus-sessions / streak / plans — LWW.

## Безопасность

- **Rate limiting** через `shared/pkg/ratelimit` (Redis token bucket per-user/per-endpoint).
- **Token quota** (`shared/pkg/quota`) — daily cap на LLM-токены (200k/user по умолчанию).
- **Kill switches** (`shared/pkg/killswitch`) — 5 redis-флагов, можно прицельно отключить compromised endpoint без deploy.
- **Prompt-injection guards** — `<<<USER_DOC>>>` / `<<<TRANSCRIPT>>>` delimiters + sanitizers в `services/copilot/app/`.
- **SSRF guard** в `services/documents/infra/url_fetcher.go` — dial-layer blocklist на loopback / RFC1918 / link-local.

## Мониторинг

- **Prometheus + Grafana** (через `infra/monitoring/`).
- **Loki + Promtail** для логов.
- **Sentry DSN** для main-process Hone/Cue + renderer.

## Что где принципиально

| Поверхность | Каталог | Что специфично |
|---|---|---|
| Web | `frontend/` | React + Vite + TS, Connect-ES, MSW для моков |
| Hone | `hone/` | Electron + Vite + React. **Не делает stealth.** Минималистичный focus cockpit |
| Cue | `desktop/` | Electron + tray. **Делает stealth** — `setContentProtection`, native Swift audio binary, global hotkey |

Имя директории `desktop/` ≠ продукт `Cue` — это отложенный rename ради чистоты CI и git-blame. См §6 ниже.

## Контрактная дисциплина

- `proto/` — единственный источник правды контракта.
- Generated файлы коммитятся (CI ловит drift через `make gen-check`).
- Любое изменение API: правишь .proto → `make gen-proto` → правишь сервер и клиент → коммит включает все 4 артефакта (proto + Go-stubs + TS-stubs + ports/server.go).

## Дисциплина «модульный монолит»

Сервисы изолированы friзически (свой `go.mod`) и логически (общение через shared events). Это позволяет в любой момент вынести `services/copilot/` в отдельный бинарь без переписывания.

Анти-pattern: импорт `services/foo/domain` из `services/bar/`. Если возникает соблазн — уточни, что именно тебе нужно: возможно, событие или общий тип в `shared/`.

## История изменений сервисов

Не CHANGELOG — короткий якорь, чтобы новый dev понимал, какие сервисы недавно появились / исчезли. Полная история — git log. При расхождении доверяй коду.

**Удалены** (Wave R0-Wave6 + Phase 4 cleanup):
- `services/arena/` + `services/lobby/` + `services/slot/` + `services/rating/` + `services/review/` + `services/events/` — pivot на single-track AI-coach (mig 00029, 00034).
- `services/friends/` + `services/cohort/` + `services/season/` + `services/achievements/` + `services/ai_native/` — социальный граф ушёл в TG + circles, gamification cut.
- `services/daily/` + `services/quiz/` + `services/feed/` + `services/tg_coach/` + `services/calendar/` (как сервис; personal events дропнуты mig 00080) — заменены Coach next-action + reflection grade.
- `services/clubs/` — TG-mirror удалён в Wave R; circles остался для group reading clubs.
- `services/mentor_session/` — strategic-wire scaffold (build-tagged, never bootstrapped).

**Добавлены / расширены** (Wave R0-Wave6, Phase 0-12):
- `services/intelligence/` — AI-coach: daily brief + atomic insights + severity grader + weekly memory consolidation + goal-aware briefs.
- `services/tracks/` — curated learning programmes (Go senior · ML engineering). Web `/atlas` теперь Tracks ribbon.
- `services/tutor/` — полный tutor toolkit: invite/accept + per-student snapshot + AI pre-session brief + assignments + 1-on-1 events с session_note и reminders + multi-tutor (`ListMyTutors`) + analytics aggregate.
- `services/ai_tutor/` — 4-layer memory chat (snapshot/facts/summary/episodes). 7 personas (algo/sql/sysdesign/english/go/ml/de coach).
- `services/ai_mock/` — Sysanalyst + Product analyst + QA + DevOps/SRE + DE pool. Section dispatcher в `service.go` покрывает 7 free-form секций.
- `services/curation/` — Phase 3.5 ranking-proxy: `external_resources` jsonb + `user_resource_overrides` + auto-promote algorithm.
- `services/learning_state/` — Phase 0/2: explore/commit/deep mode + ForkProgressReader + RadarReader.
- `services/rooms/` — Phase 9a: standalone collab rooms (code/whiteboard) low-key (3 active · 24h TTL · 3 ppl free-tier).
- `services/sync/` — Yjs CRDT relay для multi-device Hone.
- `services/hone/` — English learning surface (Reading + Writing + Listening + Leitner-SRS vocab) + AI grader ports + AICursor SSE.
- `services/admin/` — observability + audit log + admin pages для rooms / LLM rollups.
