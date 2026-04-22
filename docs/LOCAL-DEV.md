# Локальная разработка

## Быстрый старт

```bash
cp .env.example .env            # заполни ENCRYPTION_KEY минимум
make start                      # backend + postgres + redis + minio + clickhouse + judge0 (в docker)
make front                      # frontend (Vite, MSW включён — работает даже если бэк не поднят)
```

Открой:
- Фронт: http://localhost:5173
- API: http://localhost:8080
- Health: http://localhost:8080/health
- MinIO UI: http://localhost:9001 (только с localhost)

## Режимы

| Команда | Что делает | Когда использовать |
|---|---|---|
| `make start` | backend стек в docker | тестишь API / интеграцию |
| `make front` | frontend натив, `VITE_USE_MSW=true` | дизайн / UI, без бэка |
| `make dev` | всё в docker (включая frontend) | демо / CI-подобная среда |
| `make stop` | остановить все контейнеры | |
| `make logs` | хвост логов API | дебаг |

**MSW-моки во фронте** включены по умолчанию через `VITE_USE_MSW=true`. Фронт запускается и рендерит все экраны с фейковыми данными без реального бэка. Чтобы переключиться на реальный API — убери `VITE_USE_MSW` из `.env`.

## Что должно заработать

После `make start`:
- `curl http://localhost:8080/health` → `{"status":"ok","checks":{}}`
- `curl http://localhost:8080/health/ready` → пингует postgres + redis
- `curl http://localhost:8080/api/v1/ping` → `{"pong":true}`

После `make front` (без бэка, только MSW):
- Sanctum рендерит профиль, Daily Kata, Streak, Missions
- Atlas, Arena, Guild, Profile — с фейковыми данными

## Что не заработает локально без секретов

- Яндекс OAuth — нужен `YANDEX_CLIENT_ID/SECRET`
- Telegram Login Widget — нужен реальный бот с `TELEGRAM_BOT_TOKEN`, домен зарегистрирован у BotFather
- AI-мок (LLM) — нужен `OPENROUTER_API_KEY`. Без него endpoint вернёт ошибку, MSW-моки фронта работают независимо
- Telegram notifications — нужен бот + `TELEGRAM_WEBHOOK_SECRET` + `PUBLIC_BASE_URL` (в `local` env `setWebhook` пропускается намеренно)
- Judge0 — поднимается в docker, но real code execution требует privileged mode и cgroups v1. На M-чипе может не работать — MVP использует `FakeJudge0` который принимает любой код как pass

## Обход auth для тестов

Через MSW фронт эмулирует auth и возвращает `hero` юзера. Для теста реального бэка без OAuth поднимаемой — можно временно пометить эндпоинт как public в [cmd/monolith/main.go](backend/cmd/monolith/main.go) через `publicPaths` map.

## Проверка что всё собирается

```bash
make gen                        # пересобрать кодоген (oapi, sqlc, mocks, TS-types)
make test-go                    # все domain тесты
make test-ts                    # frontend
```

## Типичные проблемы

**"ENCRYPTION_KEY env is required for OAuth token encryption"** — не скопировал `.env.example` в `.env` или забыл заполнить. Любая непустая 32-байтовая строка подойдёт для local.

**Порты заняты** — `lsof -ti:5432,6379,8080,5173,9000,9001,8123 | xargs kill`.

**`make start` падает на migrate** — миграции запускаются отдельным one-shot контейнером. Если упал — `docker compose logs migrate`. Обычно из-за того, что postgres ещё не готов; перезапусти `make start`.

**Frontend не видит API** — проверь `vite.config.ts`, прокси `/api` и `/ws` настроен на `http://api:8080` (в docker) или поправь на `http://localhost:8080` если бэк не в docker.
