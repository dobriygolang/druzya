# druz9

Платформа подготовки к техническим собеседованиям в стиле Dark Fantasy RPG.
Детали продукта и архитектуры — [`druz9-bible.md`](./druz9-bible.md).

- **Локальная разработка** — [LOCAL-DEV.md](./LOCAL-DEV.md)
- **Первичный провижн сервера** — [SERVER-SETUP.md](./SERVER-SETUP.md)
- **CI/CD + деплой + ops** — [DEPLOYMENT.md](./DEPLOYMENT.md)

## Структура репозитория

```
proto/druz9/v1/      Единственный источник правды API (proto3 + google.api.http)
  common.proto       Общие enum'ы (Section, Difficulty, MatchStatus, ...)
  auth.proto ...     14 сервисов × свой .proto файл
docs/
  contract-first-with-buf.md   Как работает кодоген (buf → Go + TS)
  legacy/openapi-v1.yaml       Архивная OpenAPI 3.1 (retired)
backend/
  shared/            druz9/shared — enums, domain events, bus, pkg (logger,
                     config, middleware, eventbus, httperr, metrics)
                     + generated/pb/druz9/v1/*.pb.go + druz9v1connect/*.connect.go
  services/          14 доменов (auth / profile / arena / ai_mock / ai_native /
                     editor / rating / guild / season / daily / slot / podcast /
                     notify / admin) + feed + tools. Каждый — отдельный Go-модуль.
  migrations/        goose SQL миграции (ядро + 00009_seed_content.sql
                     c 50 задачами, 12 подкастами, 5 компаниями)
  cmd/monolith/      Точка входа — все домены в одном бинарнике
frontend/            Vite + React 18 + TS + MSW (mocks под бэк)
infra/
  docker-compose.prod.yml  Production стек (nginx + certbot + prometheus +
                           grafana + loki + pgbackup)
  nginx/nginx.prod.conf    TLS termination + rate limits + WS proxy
  monitoring/              Prometheus / Loki / Promtail / Grafana provisioning
  scripts/                 bootstrap.sh (one-time) + deploy.sh + backup.sh
  api.Dockerfile           Multi-stage build (Go 1.25 → distroless)
.github/workflows/
  ci.yml             backend + frontend + proto + migrations + codegen-drift +
                     image build+push to GHCR
  deploy.yml         По зелёному CI: SSH-деплой на VPS + Telegram уведомления
```

## Быстрый старт (локально)

```bash
cp .env.example .env
make start       # бэк + postgres + redis + minio + clickhouse + judge0 в docker
make front       # фронт натив (MSW включён)
```

Открыть:
- Фронт: http://localhost:5173
- API: http://localhost:8080 (`/health`, `/api/v1/*`, `/druz9.v1.*Service/*`, `/ws/*`)

Подробности — [LOCAL-DEV.md](./LOCAL-DEV.md).

## Contract-first

Единственный источник правды API — `.proto` файлы в `proto/druz9/v1/`. Из них генерятся и Go-сервер (Connect-RPC) и TS-клиент:

```bash
make gen         # gen-proto + gen-sqlc + gen-mocks + gen-ts (TS типы для фронта)
make gen-proto   # только proto
make gen-check   # проверка что коммиченные generated-файлы не дрифтят (CI)
```

Транспорт: **Connect-RPC** (gRPC + gRPC-Web + HTTP+JSON на одном endpoint). Браузер ходит через `fetch` — без envoy/gateway. REST-пути (`/api/v1/*`) сохранены через `vanguard-go` transcoder по `google.api.http` аннотациям в proto.

Доки паттерна: [docs/contract-first-with-buf.md](./docs/contract-first-with-buf.md).

## Полезные команды

```bash
make start       # docker стек бэка
make front       # фронт натив + MSW
make dev         # всё в docker
make stop        # остановить
make logs        # хвост логов api
make lint        # golangci-lint + eslint + tsc
make test        # go test -race + vitest
make migrate-up  # goose up
make check-stubs # grep всех // STUB: комментариев
```

## Архитектурные принципы

- **Модульный монолит → микросервисы.** Домены не импортируют друг друга, общаются через `shared/domain/events.go` и EventBus. Отдельные `go.mod` — при выносе в сервис меняется только `cmd/monolith/main.go`.
- **Enum'ы = типизированные константы.** Никаких `string`/`int`. Все в `shared/enums/` или `proto/common.proto`, каждый с `IsValid()` и `String()`. `switch` по enum — все значения (линтер `exhaustive`).
- **Чистая архитектура**: `ports → app → domain → infra`. `ports` декодируют DTO и зовут use case, `app/<usecase>.go` — оркестрация, `domain/*.go` — чистая логика + интерфейсы, `infra/*.go` — pgx + sqlc + redis.
- **`solution_hint` никогда не отдаётся клиенту** — кроме admin-ручек (там явная role-gate).
- **`// STUB: описание`** — все заглушки помечены. CI показывает список в PR.
- **Оборачивай ошибки**: `fmt.Errorf("arena.StartMatch: %w", err)`.

## Состояние проекта

- ✅ 14 доменов реализованы (auth/profile/daily/rating/arena/ai_mock/ai_native/guild/notify/slot/editor/season/podcast/admin) + feed (публичный WS-стрим)
- ✅ **60 RPC методов** на Connect-RPC, из них 40 — с `google.api.http` REST-паритетом через vanguard
- ✅ **4 WebSocket хаба** — `/ws/arena`, `/ws/mock`, `/ws/editor`, `/ws/feed`
- ✅ **OpenAPI + apigen полностью удалены** (архивная yaml в `docs/legacy/`)
- ✅ Кодоген pipeline — `make gen` = proto + sqlc + mockgen + openapi-typescript (для MSW), генерируемые файлы коммитятся, CI ловит drift
- ✅ Frontend: Vite + React + TS + MSW моки, Atlas PoE2 SVG tree, 14 страниц, Cormorant шрифты (кириллица)
- ✅ Seed: 50 задач (30 algo + 15 SQL + 3 Go + 2 SD), 5 компаний, 12 подкастов, 158 test cases
- ✅ Production: `docker-compose.prod.yml` с nginx+certbot+prometheus+grafana+loki+pgbackup
- ✅ CI/CD: GitHub Actions → GHCR → SSH deploy + Telegram уведомления

## Что не сделано (сознательные STUB'ы)

- Real Judge0 integration (сейчас `FakeJudge0` принимает любое решение)
- Real Google Meet OAuth для слотов (fake URL)
- Real MinIO replay upload для editor (fake presigned URL)
- Real token streaming в `ai_native.SubmitPrompt` (сейчас emit ONE `done`-event)
- Frontend queries на connect-es клиент (пока fetch + MSW)
- Monaco editor во фронте arena/mock (пока `<pre>` фолбэк)

Все помечены `// STUB:` и документированы в соответствующих `WIRING.md` файлах.

## Дальше

См. бибилия §14 (дорожная карта) и `// STUB:` список (`make check-stubs`).
