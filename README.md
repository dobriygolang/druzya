# druz9

Экосистема из трёх продуктов для роста разработчика:

- **druz9.online** (`frontend/`) — веб-продукт. AI-coach с памятью, AI-mock с 5-axis radar, Skill Atlas, Codex, Lingua (English hub), free tutor-toolkit.
- **Hone** (`hone/`) — desktop focus-cockpit. AI-план дня, Pomodoro/Stopwatch/Free/Plan/Pinned/Countdown, заметки с AI-link, TaskBoard с auto-categorise.
- **Cue** (`cue/`) — stealth tray-copilot. Невидимый AI поверх ОС, live-транскрипт встреч.

**3 equal tracks** (выбираешь при онбординге, меняешь в Settings): Go senior · ML engineering · English. Все три — first-class, нет «главного». Каждый — свой Atlas-подграф, mock-rubric, AI-coach persona.

Один аккаунт, одна подписка `druz9 Pro` (BYOK escape для tech-юзеров), три поверхности под три состояния разработчика.

## Документация

- **[CLAUDE.md](./CLAUDE.md)** — orientation для AI-агентов: identity, правила (B/W only, free-LLM cascade, offline-first), команды, skills.
- **[docs/feature/identity.md](./docs/feature/identity.md)** — каноническая identity (что мы / что мы НЕ / 3 трека / монетизация).
- **[docs/tech/](./docs/tech/README.md)** — техническая база. Архитектура, бэкенд, фронт, деплой, конвенции, runbook, observability, perf, a11y, stubs.

## Быстрый старт

```bash
cp .env.example .env
make start       # backend stack: postgres + redis + minio + clickhouse + judge0 + api
make front       # web (http://localhost:5173, MSW моки)
cd hone && npm run dev      # Hone Electron
cd cue && npm run dev       # Cue Electron
```

После любых изменений `proto/`:

```bash
make generate
make gen-check   # CI drift-чек
```

Подробнее — [docs/tech/README.md](./docs/tech/README.md).

## Структура

```
druzya/
├── proto/druz9/v1/      Контракт API (~27 .proto)
├── backend/             Go monolith (~25 сервисов)
├── frontend/            Web (Vite + React + TS)
├── hone/                Hone Electron app
├── cue/                 Cue Electron app
├── infra/               docker-compose.prod, nginx, monitoring
├── docs/                Документация (tech/ + feature/)
└── .ai/skills/          Project-specific workflows для AI-агентов
```

## Лицензия

См [LICENSE](./LICENSE).
