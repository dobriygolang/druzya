# druz9

Экосистема из трёх продуктов для роста разработчика:

- **[druz9.online](./docs/for_investment/druz9.md)** — веб-арена + аналитика. Mock-собеседования, 1v1/2v2 матчи, Insights.
- **[Hone](./docs/for_investment/hone.md)** — desktop focus-cockpit. План дня, фокус-сессии, заметки, whiteboard.
- **[Cue](./docs/for_investment/cue.md)** — stealth tray-copilot. Невидимый AI поверх ОС.

Один аккаунт, одна подписка `druz9 Pro`, три поверхности под три состояния разработчика.

## Документация

- **[docs/for_investment/](./docs/for_investment/ecosystem.md)** — продуктовый обзор, как продукты связаны, монетизация.
- **[docs/tech/](./docs/tech/README.md)** — техническая база. Архитектура, бэкенд, фронт, деплой, конвенции.
- **[CLAUDE.md](./CLAUDE.md)** — orientation для AI-агентов, работающих в репо.

## Быстрый старт

```bash
cp .env.example .env
make start       # backend stack: postgres + redis + minio + clickhouse + judge0 + api
make front       # web (http://localhost:5173, MSW моки)
cd hone && npm run dev      # Hone Electron
cd desktop && npm run dev   # Cue Electron
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
├── proto/druz9/v1/      Контракт API (34 .proto)
├── backend/             Go monolith (~30 сервисов)
├── frontend/            Web (Vite + React + TS)
├── hone/                Hone Electron app
├── desktop/             Cue Electron app
├── infra/               docker-compose.prod, nginx, monitoring
├── docs/                Документация (for_investment/ + tech/)
└── .ai/skills/          Project-specific workflows для AI-агентов
```

## Лицензия

См [LICENSE](./LICENSE).
