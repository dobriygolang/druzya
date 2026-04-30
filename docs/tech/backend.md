# Backend

Go 1.25, монолит из ~30 сервисов, Connect-RPC, Postgres + Redis + ClickHouse + MinIO + Judge0.

## Структура

```
backend/
├── cmd/monolith/             Точка входа: main.go + bootstrap + wiring
│   ├── main.go               Реальный main
│   ├── bootstrap/            Инициализация зависимостей
│   └── services/             Wiring per-domain (e.g. hone.go, copilot.go)
├── services/                 Доменные сервисы
├── shared/
│   ├── domain/               События (events.go) + общие enum'ы
│   ├── enums/                Section, Difficulty, MatchStatus, ...
│   ├── pkg/                  Reusable packages
│   └── generated/pb/         Generated protobuf (не редактируем руками)
├── migrations/               Goose SQL (00001_baseline.sql, ...)
└── tools/                    CLI-утилиты (миграции, seed и т.п.)
```

## Сервисы (актуальный список)

```
admin            ai_mock         arena           auth          calendar
circles          clubs           copilot         daily         documents
editor           events          feed            hone          intelligence
lobby            mock_interview  notify          podcast       profile
quiz             rating          review          slot          storage
subscription     sync            tg_coach        tracks        transcription
tutor            vacancies       whiteboard_rooms
```

Каждый сервис — отдельный Go-модуль (`go.mod` внутри `services/<name>/`), с replace-директивой на `druz9/shared`.

### Что делает каждый (одной строкой)

| Сервис | Назначение |
|---|---|
| `auth` | OAuth (Yandex/Telegram) + Bearer auth + token refresh |
| `profile` | Skill Atlas, settings, percentiles, AI preferences |
| `arena` | 1v1 / 2v2 матчи на алгоритмических задачах + WS-хаб |
| `ai_mock` | Mock-сессии (HR/Algo/SD/Behavioral) с AI-toggle |
| `mock_interview` | Pipeline бронирования mock-собеседований |
| `daily` | Daily kata + streak |
| `editor` | Yjs editor rooms + WS-хаб |
| `whiteboard_rooms` | Yjs multiplayer Excalidraw + WS-хаб |
| `circles` | Сообщества |
| `events` | Ивенты внутри circles |
| `calendar` | Personal events |
| `podcast` | Podcasts CMS + плеер |
| `slot` | Бронь интервьюера |
| `vacancies` | AI-разбор вакансий |
| `copilot` | Cue chat + auto-suggest + RAG + mock-block protocol |
| `documents` | RAG-store: extract + chunk + embed (CV / JD / URL) |
| `transcription` | Whisper STT (Groq turbo) для Cue |
| `hone` | Backend для Hone: plans, focus, notes, whiteboards, stats |
| `intelligence` | AI-coach: daily brief, atomic insights, severity grader, persona/variant overlays, weekly memory consolidation |
| `sync` | Yjs CRDT relay для Hone notes (multi-device) |
| `notify` | Push / email / Telegram уведомления |
| `feed` | Публичный WS-стрим активности |
| `rating` | Elo + лидерборды |
| `subscription` | Pro-billing (Yookassa wiring TBD) |
| `storage` | MinIO/S3 wrapper + presigned URLs |
| `lobby` | Custom lobby для арены (1v1 + solo с skill_filter) |
| `quiz` | Quiz-формат вопросов |
| `review` | Code review поток |
| `tg_coach` | Telegram-бот команды (`/streak` etc) |
| `tracks` | Curated learning programmes (catalogue + per-user enrolment) |
| `tutor` | Полный tutor-стек: invites/accept/list (Wave 2), snapshot + AI brief (2.4b/2.5), assignments + broadcast (5.1/5.2a), 1-on-1 events с session_note и reminders (5.2b/c/d). `*Postgres` сейчас satisfies 4 интерфейса: `Repo` + `SnapshotRepo` + `AssignmentRepo` + `EventRepo` |
| `clubs` | Phase 3 MVP — структурированная витрина TG-mirror в circles. Catalogue + sessions + RSVP. **REST chi-direct** (не proto — read-mostly + одна mutation, см `cmd/monolith/services/clubs/clubs.go`) |
| `admin` | Admin-панель |

## Shared packages

```
backend/shared/pkg/
├── llmchain/        Маршрутизатор LLM-провайдеров (Groq → Cerebras → ...)
├── llmcache/        Семантический кэш (Ollama embedder + bge-small)
├── quota/           Daily token cap per-user (Redis)
├── ratelimit/       Token bucket per-user/per-endpoint (Redis)
├── killswitch/      Redis-флаги для аварийного отключения endpoint
├── eventbus/        In-process pub-sub (потом → NATS/Redis)
├── compaction/      Compaction для длинных диалогов / транскриптов
├── pg/              pgx connection pool + helpers
├── httperr/         Connect-RPC error wrapping
├── logger/          Slog wrapper
├── otel/            OpenTelemetry init
├── metrics/         Prometheus metrics
├── middleware/      Auth, rate-limit, logging interceptors
├── bizmetrics/      Business KPI emitters (ClickHouse sink)
├── subclient/       Subscription tier reader (Pro / Team / Enterprise)
├── synctomb/        Sync watermark / tombstone helpers
└── config/          Env loader (env-decode based)
```

## LLM-стек подробнее

Конкретный fallback chain в `llmchain.Chain`:

1. **Groq** — primary. `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `whisper-large-v3-turbo`. Free-tier с лимитами.
2. **Cerebras** — secondary. `llama-3.3-70b`, super-fast inference.
3. **Mistral** — tertiary. `mistral-large-latest`, `pixtral-12b` для vision.
4. **OpenRouter `:free`** — лучшие открытые модели в free-lane (Gemini Flash через :free и т.п.).
5. **Ollama** — floor. Локальный sidecar в docker-compose. `llama3.1:8b`, `bge-small` для embeddings.

**Запрещено** платные провайдеры (Anthropic / OpenAI / Cloudflare / SambaNova / Gemini directly). См [conventions.md](./conventions.md#llm-провайдеры).

LLM-задачи (`shared/pkg/llmchain/tasks.go`) — список именованных Task'ов с конкретной маршрутизацией. Добавление новой задачи: в [.ai/skills/llmchain-task.md](../../.ai/skills/llmchain-task.md).

## Базы данных

### Postgres

Основная БД. pgx + sqlc для типизированных query, Goose для миграций.

Миграции в `backend/migrations/`. Бейслайн `00001_baseline.sql` объединяет первые 50+ исторических миграций. На текущем рабочем дереве также присутствуют:

- `00002_mock_schema_align.sql`
- `00003_personal_events.sql` (calendar — Phase 1b)
- `00004_remove_friends.sql` (cleanup)
- `00005_insights.sql` (intelligence atomic insight cards — Phase 1.5)
- `00006_event_reminders_sent.sql` (calendar reminder ledger — Phase 1.8b)
- `00006_user_persona_tracks.sql` (career-track persona enum)
- `00007_skill_atlas_tracks.sql` (atlas_nodes.track_kind)
- `00007_tracks.sql` (curated learning tracks — Phase 2a)
- `00008_tracks_seed.sql` (5 курируемых треков, 43 шага)
- `00009_english_atlas_seed.sql` (english HR atlas)
- `00010_lobby_skill_filter.sql` (solo lobby + tasks.skill_keys — Phase 2c-2)
- `00011_user_goals.sql` (goal-aware coach briefs — Phase 4.3)

Каждый сервис имеет свои таблицы с префиксом, например `hone_*`, `arena_*`, `copilot_*`.

### Redis

- Rate limiting (token bucket per-user).
- Quotas (daily token cap).
- Kill switches (5 флагов).
- Distributed locks для wiring заданий.

### ClickHouse

Sink для аналитических событий. Используется в `services/intelligence/` для Insights-агрегатов (weekly digest, readiness forecast).

### MinIO / S3

- `podcasts` bucket для аудио.
- Presigned URLs для editor replay (TODO — сейчас FakeJudge0 stub).

### Judge0

Containerized code execution. `judge0-server` + `judge0-workers` в docker-compose. Сейчас обёрнут в `FakeJudge0` для большинства тестовых сценариев — реальная интеграция не везде покрыта.

## Wiring

`backend/cmd/monolith/bootstrap/bootstrap.go` собирает все зависимости (db, redis, llmchain, eventbus). Затем `services/<name>.go` в `cmd/monolith/services/` соединяет конкретный сервис со всем нужным. Пример паттерна `pick-real-vs-floor`:

```go
// Из cmd/monolith/services/hone.go (упрощено)
if d.LLMChain != nil {
    planSynth = LLMChainPlanSynthesiser(d.LLMChain)
} else {
    planSynth = NoLLMPlanSynthesiser{} // → 503 при вызове
}
```

Это даёт graceful degradation: если LLM-роутер не настроен, конкретный endpoint возвращает 503 вместо краша всего бинаря.

## EventBus (in-process)

`shared/pkg/eventbus` — простой pub/sub. Сервисы публикуют события из `shared/domain/events.go`, подписчики обрабатывают. Никакого NATS/Kafka — пока не нужно. Когда понадобится — меняется только провайдер, контракт остаётся.

## Команды

```bash
make start         # Поднять стек + миграции + api
make stop          # Остановить
make logs          # Хвост логов
make lint-go       # golangci-lint
make test-go       # go test ./...
make migrate-up    # goose up
make seed          # Загрузить seed-data
make gen-proto     # Сгенерировать Go + TS стубы
make gen-sqlc      # Сгенерировать sqlc query code
make gen-mocks     # mockgen по //go:generate директивам
make gen-check     # CI-style drift check
```

## Тесты

- Unit-тесты в `app/<usecase>_test.go` — hand-rolled fakes реализующие domain интерфейсы.
- Интеграционные через testcontainers (postgres / redis) — где есть.
- Тесты на ports/ — Connect-RPC handler-тесты с mock app-layer'ом.

`go test -race ./...` должен быть зелёным перед merge. Линтеры: `golangci-lint run` + `gofmt` + `go vet ./...`.

## Известные стабы

- `FakeJudge0` принимает любое решение (не вшит реальный judge на all paths).
- Real Google Meet OAuth для слотов (fake URL).
- Real MinIO replay upload для editor (fake presigned URL).
- Real token streaming в `ai_native.SubmitPrompt` (одно `done`-event).

Все помечены `// STUB:` — ищется через `make check-stubs`.

## Куда смотреть, если

- **Добавить новый Connect-RPC endpoint** → [.ai/skills/add-rpc.md](../../.ai/skills/add-rpc.md)
- **Добавить миграцию** → [.ai/skills/add-migration.md](../../.ai/skills/add-migration.md)
- **Подключить новую LLM-задачу** → [.ai/skills/llmchain-task.md](../../.ai/skills/llmchain-task.md)
- **Code review** → [.ai/skills/code-review.md](../../.ai/skills/code-review.md)
