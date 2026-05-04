# CLAUDE.md — orientation для AI-агентов

Это монорепо проекта **druz9** — экосистема из трёх продуктов: web `druz9.online` (AI-coach + arena + atlas), desktop focus-cockpit Hone, stealth tray-copilot Cue.

**Identity (Sergey 2026-05-04):** AI-coach с памятью + free tutor-toolkit + Hone для подготовки senior IT-разрабов. **3 трека:** Go senior · ML engineering · English (opt-in toggle). НЕ LeetCode / НЕ Skyeng / НЕ paid marketplace. См [docs/feature/identity.md](./docs/feature/identity.md).

## С чего начинать

1. **Прочитай [docs/tech/README.md](./docs/tech/README.md)** — там быстрый orientation, где что лежит и какие команды.
2. **Если задача затрагивает несколько слоёв** — открой [docs/tech/architecture.md](./docs/tech/architecture.md).
3. **Если задача про конкретный слой** — читай соответствующий файл в `docs/tech/` ([backend.md](./docs/tech/backend.md), [frontend.md](./docs/tech/frontend.md), [deployment.md](./docs/tech/deployment.md), [conventions.md](./docs/tech/conventions.md)).
4. **Для типовых workflow** (новый RPC, миграция, LLM-задача, code review, релиз Electron) — есть готовые скиллы в [.ai/skills/](./.ai/skills/).

## Что нельзя пропустить

- **Свободный LLM only.** Cascade order (Sergey 2026-05-05): `groq → cerebras → google → cloudflare → zai → mistral → openrouter → deepseek → ollama`. Free-tier приоритетны. Anthropic / OpenAI напрямую для production-чейна — **запрещены**. См [memory/feedback_providers.md](./memory/feedback_providers.md).
- **B/W only design.** `#FF3B30` — точка-индикатор / 1.5px stripe / single SVG stroke. Никогда в bg/fill/gradient.
- **Offline-first Hone.** Любая новая client-initiated write → outbox-able. См memory/feedback_offline_rule.md.
- **Responsive everywhere.** Все surfaces flex на любое разрешение — `flex-wrap`, `minWidth: 0`, auto-fit grid. См memory/feedback_responsive_rule.md.
- **Curation = ranking-proxy.** Не клонируем Strang/mlcourse/DDIA — линкуем через `external_resources` jsonb. Build только unique слой (AI-mock + Codex + AI-tutor + Hone + Intelligence). См memory/project_curation_model.md.
- **Контракт через .proto.** `proto/druz9/v1/` — единственный источник правды API. После любых изменений запускай `make generate` и коммить generated файлы.
- **Работаем в `main`, без worktrees.** Это явное указание Sergey.
- **Отвечай на русском, кратко.** Tradeoff'ы > вода. Что делать руками (deploy/env) — в отдельный блок.

## Как устроены три продукта

| Продукт | Каталог | Что |
|---|---|---|
| **Web (druz9.online)** | `frontend/` | AI-coach + AI-mock (5-axis radar) + AI-tutor (4-layer memory) + Skill Atlas + Codex + tutor toolkit |
| **Hone** | `hone/` | Тихий desktop-кокпит: AI-план, фокус, заметки с AI-link, taskboard с auto-categorise, English hub. **Не делает stealth** |
| **Cue** | `desktop/` | Stealth tray-copilot. Невидим при screen-share, live-транскрипт встреч |

Backend — общий Go-монолит в `backend/cmd/monolith/`, ~30 сервисов в `backend/services/`. Контракт API в `proto/druz9/v1/`. Подробнее — [docs/tech/architecture.md](./docs/tech/architecture.md).

**Local dev login:** Hone Vite (`localhost:5173`) → LoginScreen → username «sergey» → DEV LOGIN button (visible только при `import.meta.env.DEV` + backend `DEV_AUTH=true`). Bypass'ит TG flow.

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

В частности, удалены за 2026-04 / 05:
- **Arena/Lobby/Slot/Rating/Review/Events** — pivot на single-track AI-coach
- **services/friends/season/cohort/achievements/ai_native** — социальный слой через TG channel + circles
- **Sanctum / CodeObituary / Necromancy / GhostRuns** web-страницы — RPG-витрина свёрнута
- **Boosty marketplace** — заменён на free tutor toolkit (двусторонний рынок без денежного шага)
- **Quiz / Daily** — заменены Coach next-action + reflection grade

Если встречается ссылка на эти модули — она устаревшая.

## Текущие миграции (2026-05-05)

- **DB v65** — Phase 3.5: `user_resource_overrides` + `resource_promotion_signals` + `domain_reputation` + ALTER `user_resource_log` (4 cols)
- **DB v66** — Phase 9a: ALTER `editor_rooms` / `whiteboard_rooms` (archived_at + free_tier) + `user_room_quota`
- **DB v67** — Phase 10 fix: расширил `hone_focus_mode_valid` CHECK с `free|plan|pinned` до `pomodoro|stopwatch|free|plan|pinned|countdown`

## Phase progress (2026-05-05)

См [docs/feature/implementation-plan.md](./docs/feature/implementation-plan.md) status table. Phase 3.5 / 5 / 6 / 7 §7a / 9a / 10 / 11a / 11b / 12.5 (REST + 2 admin pages) — done. Phase 8 / 9 cursor labels / 10 mockup full / 12 Welcome — partial / deferred.