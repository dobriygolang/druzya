# CLAUDE.md — orientation для AI-агентов

Это монорепо проекта **druz9** — экосистема из трёх продуктов: веб-арена `druz9.online`, desktop focus-cockpit Hone, stealth tray-copilot Cue.

## С чего начинать

1. **Прочитай [docs/tech/README.md](./docs/tech/README.md)** — там быстрый orientation, где что лежит и какие команды.
2. **Если задача затрагивает несколько слоёв** — открой [docs/tech/architecture.md](./docs/tech/architecture.md).
3. **Если задача про конкретный слой** — читай соответствующий файл в `docs/tech/` ([backend.md](./docs/tech/backend.md), [frontend.md](./docs/tech/frontend.md), [deployment.md](./docs/tech/deployment.md), [conventions.md](./docs/tech/conventions.md)).
4. **Для типовых workflow** (новый RPC, миграция, LLM-задача, code review, релиз Electron) — есть готовые скиллы в [.ai/skills/](./.ai/skills/).

## Что нельзя пропустить

- **Свободный LLM only.** Все провайдеры — бесплатные tier'ы (Groq / Cerebras / Mistral / OpenRouter / Ollama). Anthropic / OpenAI / Cloudflare / SambaNova / Gemini напрямую — **запрещены**. См [docs/tech/conventions.md#llm-провайдеры](./docs/tech/conventions.md#llm-провайдеры).
- **Контракт через .proto.** `proto/druz9/v1/` — единственный источник правды API. После любых изменений запускай `make generate` и коммить generated файлы.
- **Работаем в `main`, без worktrees.** Это явное указание Sergey.
- **Отвечай на русском, кратко.** Tradeoff'ы > вода. Что делать руками (deploy/env) — в отдельный блок.

## Как устроены три продукта

| Продукт | Каталог | Что |
|---|---|---|
| **Web (druz9.online)** | `frontend/` | Арена + аналитика. Mock-собесы, 1v1/2v2, Insights, Codex |
| **Hone** | `hone/` | Тихий desktop-кокпит: план дня, фокус, заметки, whiteboard, stats. **Не делает stealth** |
| **Cue** | `desktop/` | Stealth tray-copilot. Невидим при screen-share, live-транскрипт встреч |

Backend — общий Go-монолит в `backend/cmd/monolith/`, ~30 сервисов в `backend/services/`. Контракт API в `proto/druz9/v1/` (34 .proto файла). Подробнее — [docs/tech/architecture.md](./docs/tech/architecture.md).

## Часто нужные команды

```bash
# Backend
make start         # docker стек: postgres + redis + minio + clickhouse + judge0 + api
make stop
make logs

# Frontend
make front         # Vite dev (http://localhost:5173, MSW моки включены)

# Hone / Cue
cd hone && npm run dev
cd desktop && npm run dev

# Codegen — после любого изменения .proto или .sql
make generate
make gen-check     # CI-style drift check

# Тесты + линтер
make lint
make test
make migrate-up
make seed
make check-stubs   # grep всех // STUB:
```

## Где жить

```
druzya/
├── proto/druz9/v1/          Контракт API (источник правды)
├── backend/                 Go monolith
│   ├── cmd/monolith/        Точка входа + bootstrap + wiring
│   ├── services/            ~30 доменных сервисов
│   ├── shared/              Общие пакеты + generated/pb/
│   └── migrations/          Goose SQL
├── frontend/                Web (Vite + React)
├── hone/                    Hone Electron app
├── desktop/                 Cue Electron app (имя директории не переименовано — см architecture.md)
├── infra/                   docker-compose.prod, nginx, monitoring, deploy.sh
├── docs/
│   ├── for_investment/      Инвестор-ориентированное (ecosystem, per-app)
│   └── tech/                Технические доки (читать при работе с кодом)
└── .ai/skills/              Project-specific workflows
```

## Ключевые принципы кода

Полный список — [docs/tech/conventions.md](./docs/tech/conventions.md). Самое важное:

- **Чистая архитектура внутри сервисов:** `ports → app → domain ← infra`.
- **Сервисы не импортируют друг друга** — общаются через `shared/domain/events.go` + EventBus.
- **`@ts-nocheck` запрещён.** Strict TypeScript везде. `any` — только с обоснованием.
- **Conventional Commits** на английском, императив, без «Generated with X» тегов.
- **Чужие credentials никогда в логах / коммитах.** `.env*` — в `.gitignore`.
- **Никаких feature flags / backwards-compat shims «на будущее».** YAGNI.
- **Тестируем где имеет смысл** (use cases, чистые функции). Thin pass-through код не тестим.

## Skills для типовых задач

| Задача | Skill |
|---|---|
| Добавить Connect-RPC endpoint | [.ai/skills/add-rpc.md](./.ai/skills/add-rpc.md) |
| Добавить миграцию | [.ai/skills/add-migration.md](./.ai/skills/add-migration.md) |
| Подключить новую LLM-задачу | [.ai/skills/llmchain-task.md](./.ai/skills/llmchain-task.md) |
| Добавить страницу в web/Hone | [.ai/skills/frontend-page.md](./.ai/skills/frontend-page.md) |
| Code review | [.ai/skills/code-review.md](./.ai/skills/code-review.md) |
| Релиз Electron-приложения | [.ai/skills/electron-app.md](./.ai/skills/electron-app.md) |

## Если что-то стало неактуальным

Документация в этом репо — живая. Если читаешь файл и видишь что код описывает другое (например, упомянут несуществующий сервис) — **доверяй коду, обновляй документ**.

В частности, недавно были удалены: `services/friends`, `services/season`, `services/cohort`, `services/achievements`, `services/ai_native`, и связанные web-страницы (Sanctum, CodeObituary, Necromancy, GhostRuns, и др.). Если встречается ссылка на эти модули — она устаревшая.