# docs/tech — техническая база

Точка входа для разработчика, который видит проект впервые. Каждый файл — самодостаточный, без внутреннего раздувания.

## Файлы

| Файл | Когда читать |
|---|---|
| [architecture.md](./architecture.md) | Первое, что читать. Общая картина: что где живёт, как поверхности связаны, ключевые паттерны |
| [backend.md](./backend.md) | Перед работой с `backend/`. Структура монолита, сервисы, llmchain, БД, события |
| [frontend.md](./frontend.md) | Перед работой с `frontend/`, `hone/`, `desktop/`. Codegen, transport, state, страницы |
| [deployment.md](./deployment.md) | Перед деплоем / провижном. CI/CD, VPS setup, релизы Electron-приложений |
| [observability.md](./observability.md) | Что мерится (метрики/логи/Sentry), какие dashboard'ы и алерты, куда они приходят |
| [runbook.md](./runbook.md) | Когда что-то горит. Команды для on-call: сайт лежит, LLM упали, миграция сломалась, kill-switch'и |
| [stubs.md](./stubs.md) | Известные `// STUB:` точки в проде, ранжированные по риску (🔴 блокеры → 🟡 UX → 🟢 техдолг) |
| [conventions.md](./conventions.md) | Перед первым коммитом. Стиль коммитов, Go-style, кодоген, правило free-only LLM |

## Быстрый старт

```bash
cp .env.example .env
make start       # backend (postgres + redis + minio + clickhouse + judge0 + api)
make front       # web (Vite, http://localhost:5173)
cd hone && npm run dev    # Hone Electron
cd desktop && npm run dev # Cue Electron
```

После любых изменений в `proto/`:

```bash
make generate   # gen-proto + gen-sqlc + gen-mocks + gen-ts
make gen-check  # CI-style проверка drift
```

## Состояние проекта

- ~25 backend-сервисов в монолите (`backend/services/`). Все wired через `cmd/monolith/services/<svc>.go`.
- 27 .proto файлов в `proto/druz9/v1/` → Go server (Connect-RPC) + TS-клиент через `make gen-proto`.
- 30+ страниц в `frontend/` (web): `/atlas`, `/mock`, `/codex`, `/tutor` dashboard, `/onboarding`, `/insights`, и т.д.
- 16 страниц в `hone/` (focus cockpit): Today, Focus, Notes, Coach, TaskBoard, Stats, Settings, EnglishOverview (Reading/Writing/Listening), Calendar, Editor, SharedBoards, Podcasts, TutorAssignments.
- Cue (`desktop/`) — tray-only, native Swift binary под macOS audio.
- 64 миграции (`backend/migrations/`) — consolidated baseline + ~60 patch'ей. См [README](../../backend/migrations/README.md). Создавай новые через `make migrate-new NAME=<snake_name>`.

## Где что

```
druzya/
├── proto/druz9/v1/           Контракт API (~27 .proto). Источник правды
├── backend/
│   ├── cmd/monolith/         Точка входа. Вся wiring здесь
│   ├── services/             Доменные сервисы (~25 шт)
│   ├── shared/               Общие пакеты: pkg/{llmchain,llmcache,quota,...}
│   │   └── generated/pb/     Генерированные Go-стубы
│   └── migrations/           Goose SQL миграции
├── frontend/                 Web (Vite + React + TS)
│   └── src/api/generated/    Генерированные TS-стубы (Connect-ES)
├── hone/                     Focus cockpit (Electron + Vite + React)
├── desktop/                  Cue (Electron + Vite + React + Swift binary)
├── infra/                    docker-compose.prod, nginx, monitoring, deploy.sh
├── docs/
│   ├── for_investment/       Инвестор-ориентированные тексты
│   └── tech/                 ← вы здесь
└── .ai/skills/               Project-specific skills для Claude
```

## Общие правила

- **Free-only LLM.** Все провайдеры — бесплатные tier'ы (Groq / Cerebras / Mistral / OpenRouter / Ollama). См [conventions.md §LLM](./conventions.md#llm-провайдеры).
- **Monorepo, не полирепо.** `go.work` собирает все сервисы. Frontend/Hone/Cue имеют свои `package.json`.
- **Connect-RPC, не gRPC и не REST.** Один транспорт, браузер ходит через `fetch`.
- **Generated файлы коммитятся.** CI ловит drift через `make gen-check`.
- **Никогда не amending published commits.** История чистая.

См [conventions.md](./conventions.md) для деталей.
