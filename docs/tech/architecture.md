# Архитектура

Монорепо: один Go-монолит на бэкенде, три клиента на фронте (web, Hone, Cue), один контракт API через Protocol Buffers.

## Высокоуровневая схема

```
                        ┌────────────────────────────────┐
                        │        proto/druz9/v1/         │
                        │   Источник правды API (34 .proto)
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

WebSocket'ы для real-time:

- `/ws/arena` — арена 1v1/2v2 матчи.
- `/ws/mock` — mock-собеседования.
- `/ws/editor/{id}` — Yjs-сессии редактора.
- `/ws/whiteboard/{id}` — multiplayer Excalidraw (Yjs).
- `/ws/feed` — публичная активность (без auth).

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

**Удалены** (Phase-4 ADR-001 + cleanup):
- `services/friends/` — социальный граф ушёл в TG-канал + circles.
- `services/season/` — incomplete season pass без UI.
- `services/cohort/` — поглощён `circles`.
- `services/achievements/` — gamification cut.
- `services/ai_native/` — legacy mock-round flow.

**Добавлены** (Phase 1-4 + Wave 0-4):
- `services/calendar/` — personal events (Phase 1b).
- `services/sync/` — Yjs CRDT relay для multi-device Hone.
- `services/intelligence/` — AI-coach: daily brief + atomic insights + severity grader + persona/variant overlays + weekly memory consolidation + goal-aware briefs.
- `services/tracks/` — curated learning programmes (Phase 2). Web `/atlas` теперь Tracks ribbon, старый skill-graph под `/atlas/explore`.
- `services/tutor/` — полный tutor-стек: Tier 1 invite/accept (Wave 2) + per-student snapshot с агрегированной English activity (2.4b/c) + AI pre-session brief (2.5) + assignments + broadcast (5.1/5.2a) + 1-on-1 events с reminders + session notes (5.2b/c/d). Один `*Postgres` satisfies 4 интерфейса (Repo/SnapshotRepo/AssignmentRepo/EventRepo).
- `services/clubs/` — Phase 3 MVP. Public catalogue + sessions + RSVP. **REST chi-direct** (read-mostly + одна mutation, не proto).

**Расширены:**
- `services/lobby/` — solo mode + skill_filter (Phase 2c-2): Practice CTA на TrackDetailPage создаёт single-player drill room.
- `services/hone/` — English learning surface: Reading + sessions + Leitner-SRS vocab + AI summary grader (Wave 4) + Writing-as-Focus grader (4.4) + Listening materials с transcript (6.1) + Code-review-coaching grader (3.6). Все LLM-grader'ы — отдельные ports (`SummaryGrader`/`WritingGrader`/`CodeReviewGrader`) с `LLMChain*` real adapter + `NoLLM*` floor (returns ErrLLMUnavailable → 503). Free-tier providers only (Groq/Cerebras/Mistral/OpenRouter/Ollama).
- `services/ai_mock/` — Sysanalyst (Wave 7), Product analyst (Wave 8), QA (Wave 9.2), DevOps/SRE (Wave 9.3). Free-form mock'и с per-section prompts (`domain/{sysanalyst,product_analyst,qa,devops}.go`) и section-specific rubric'ами в `BuildReportPrompt`. Section dispatcher в `service.go` покрывает 7 free-form секций: english_hr, system_design_senior, tech_lead_em, sysanalyst, product_analyst, qa, devops.
- `services/tutor/` — Wave 9.4 multi-tutor (`ListStudentTutors` repo + `ListMyTutors` UC + RPC `/api/v1/tutor/my-tutors`); Wave 9.5 analytics aggregate (`TutorEventStats` repo + `GetTutorActivity` UC + RPC `/api/v1/tutor/activity` — active students / completed / cancelled / minutes_taught / cancellation_rate over trailing window).
- Migrations: `00018_analyst_atlas_seed.sql` (Sysanalyst + Product analyst nodes), `00019_qa_devops_atlas_seed.sql` (QA + DevOps + adds `'devops'` to `track_kind` enum), `00020_tutor_event_rsvps.sql` (group-event RSVPs scaffold), `00021_tutor_listings_scaffold.sql` (marketplace schema scaffold).
