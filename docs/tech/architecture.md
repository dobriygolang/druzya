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
       │ backend/shared/  │  │ frontend/src/api/│  │ hone, cue          │
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
| Cue | `cue/` | Electron + tray. **Делает stealth** — `setContentProtection`, native Swift audio binary, global hotkey |

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

**Добавлены / расширены** (Wave R0-Wave6, Phase 0-12, 2026-05-12 marathon):
- `services/intelligence/` — AI-coach: daily brief + atomic insights + severity grader + memory consolidation + goal-aware briefs + **F2 Goal CRUD** (CreateGoal/GetActiveGoal/UpdateGoal/DeactivateGoal) + **F10 InterviewSession ingestion** (Cue session.end → coach_episodes row) + **F2 LLM milestones** (GenerateMilestones/GetMilestones/MarkMilestoneDone 30d cache) + **R3 NodeCoverage** (per-atlas-node aggregation) + **F1 Memory entries** list/delete с soft-delete (coach_episodes.deleted_at).
- `services/tracks/` — curated learning programmes (Go senior · ML engineering). Web `/atlas` теперь Tracks ribbon. **Arena enum value removed (D8 cleanup).**
- `services/tutor/` — полный tutor toolkit + **role toggle (users.tutor_mode_enabled)** + **tutor_reading_paths** (4-я subsurface curated atlas-node sequences).
- `services/ai_tutor/` — 4-layer memory chat. 7 personas. **AITutorChatPage now has CoachMemoryCard slice + markdown render.**
- `services/ai_mock/` + `services/mock_interview/` — **R2 5 stages: HR / Algo (Judge0 detailed) / Coding (LLM rubric) / SysDesign (Excalidraw + 5-axis rubric) / Behavioral (voice MediaRecorder + STAR grading).** 5-axis radar debrief.
- `services/curation/` — ranking-proxy + **F6 auto-promote daemon** (6h cron, refresh signals + promote ≥0.7 / deprecate ≤0.3).
- `services/learning_state/` — explore/commit/deep mode + ForkProgressReader + RadarReader.
- `services/rooms/` — standalone collab rooms (code/whiteboard) low-key (24h TTL · 3 ppl free-tier).
- `services/sync/` — Yjs CRDT relay для multi-device Hone.
- `services/hone/` — English learning surface (Reading + Writing + Listening + Leitner-SRS) + AI grader ports + AICursor SSE.
- `services/admin/` — observability + audit log + **R7 Phase 1 Company Manager** (Pipeline DnD + StageTemplates + ValidatePipeline) + **Admin Phase 2 Goal Presets CRUD**.
- `services/subscription/` — **Stream C Pro tier** (CheckTier + SetTier) + **BYOK** (AES-256-GCM keys + 5 LLM provider validators: OpenRouter/Groq/Cerebras/Anthropic/OpenAI) + **Stripe checkout** (CreateCheckoutSession + webhook handler + CancelSubscription).
- `services/google_calendar/` — **NEW Stream E**: OAuth flow + token AES encryption + 5-min pull cron + two-way sync (pull events, push new events, etag tracking, mirror в `events_synced` table).
- `services/editor/` + `services/whiteboard_rooms/` — **Stream F: peer-collab WS stripped, solo persistence kept** (web pages `/editor/:id` + `/whiteboard/:id`).
