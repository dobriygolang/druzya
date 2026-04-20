# druz9 — Деплой и эксплуатация

Как релиз попадает на прод и что делать если всё сломалось. Сервер уже поднят — инструкция по провижну в [SERVER-SETUP.md](./SERVER-SETUP.md).

## Пайплайн в одной картинке

```
  ┌──────────┐     ┌─────────────────────────┐     ┌────────────────┐
  │ git push │───▶ │  GitHub Actions: CI     │───▶ │ GHCR:                │
  │   main   │     │  (lint+test+build+      │     │ ghcr.io/dobriygolang │
  └──────────┘     │   codegen-drift+image)  │     │  /druz9-api:*        │
                   └──────────┬──────────────┘     └────┬───────────┘
                              │ success                 │
                              ▼                         │
                   ┌─────────────────────────┐          │
                   │ GitHub Actions: Deploy  │          │
                   │  SSH to VPS             │          │
                   │  /opt/druz9/            │          │
                   │    infra/scripts/       │          │
                   │      deploy.sh          │◀─ pulls ─┘
                   └──────────┬──────────────┘
                              │
                              ▼
                   ┌─────────────────────────┐
                   │ docker compose pull     │
                   │ → run migrate           │
                   │ → rolling restart api   │
                   │ → verify /health/ready  │
                   └─────────────────────────┘
```

## Нормальный релиз

1. Пушнуть в `main` (или смержить PR).
2. CI (≈6 мин) — backend/frontend/proto/migrations/codegen-drift/image.
3. По зелёному CI автоматически стартует `Deploy` workflow (`workflow_run` trigger).
4. Deploy подключается по SSH к серверу, тянет новый образ, применяет миграции, делает rolling restart, проверяет `/health/ready` 6×10s.
5. По завершении шлёт уведомление в Telegram (если `TELEGRAM_OPS_CHAT_ID` задан).

Всё это без ручного вмешательства. Время от push до прода: **~8-10 минут**.

## Ручной деплой

### Через GitHub UI

Actions → `Deploy` → Run workflow → указать `image_tag` (например `sha-abc1234`) → Run.

Полезно для:
- Rollback на предыдущий коммит (указать старый `sha-...`)
- Деплой без CI-прогона
- Тест с dev-image (тэг ручной)

### По SSH напрямую

```bash
ssh deploy@druz9.online
cd /opt/druz9
git fetch --all && git reset --hard origin/main
export IMAGE_TAG=sha-abc1234     # или latest
bash infra/scripts/deploy.sh
```

## Откат (rollback)

Последние образы хранятся в GHCR. Откат = деплой старого тэга.

```bash
# Найти последние образы:
gh api /users/dobriygolang/packages/container/druz9-api/versions | jq -r '.[] | .name'

# Откат:
gh workflow run deploy.yml -f image_tag=sha-<old-commit-sha>
```

Если БД сломалась из-за миграции — восстановить из бэкапа (пункт 6 в SERVER-SETUP.md), потом:
```bash
# Откатить N последних миграций:
ssh deploy@druz9.online
cd /opt/druz9
docker compose -f infra/docker-compose.prod.yml run --rm \
  -e POSTGRES_DSN="host=postgres port=5432 user=druz9 password=$POSTGRES_PASSWORD dbname=druz9 sslmode=disable" \
  migrate down-to <version>
```

## Диагностика

### Проверить что живое

```bash
# Публично:
curl -sfL https://druz9.online/health && echo OK
curl -sfL https://druz9.online/health/ready | jq

# На сервере (глубже):
ssh deploy@druz9.online
cd /opt/druz9
docker compose -f infra/docker-compose.prod.yml ps
docker compose -f infra/docker-compose.prod.yml logs --tail=100 api
```

### Метрики

```bash
# SSH-туннель на prometheus:
ssh -N -L 9090:localhost:9090 deploy@druz9.online
open http://localhost:9090

# Или сразу Grafana (с любой сети):
open https://druz9.online/grafana/
# login: admin / GRAFANA_ADMIN_PASSWORD из .env.prod
```

Ключевые метрики (бибилия §12):
- `druz9_http_request_duration_seconds{method,path}` — p99 < 2s алёрт
- `druz9_http_requests_total{status=~"5.."}` — > 1% за 5 мин → алёрт
- `druz9_ws_connections_active{hub}` — > 500 → алёрт
- `druz9_llm_tokens_total` — > 1M/час → $$$
- `druz9_judge0_pending_submissions` — > 50 → backlog

### Логи

Структурированный slog через Loki/Promtail:

```bash
# В Grafana: Explore → Loki → query:
# {container="druzya-api-1"} |= "ERROR"
# {service="api"} | json | latency > 1s
```

Или сырыми логами:
```bash
docker compose -f infra/docker-compose.prod.yml logs -f --tail=0 api
docker compose -f infra/docker-compose.prod.yml logs --since=1h api | grep ERROR
```

## Типичные проблемы

### 1. `/health/ready` возвращает `503`

Что-то из зависимостей упало. В ответе будет:
```json
{"status":"unavailable","checks":{"postgres":{"status":"fail","error":"..."}}}
```

Смотри упавший чек. Чаще всего — postgres/redis (проверить `docker compose ps`), реже — MinIO или Judge0.

### 2. Образ не пуллится на деплое

`Error: denied: installation not allowed to Create organization package`

Проверь:
- В репо `Settings → Actions → General → Workflow permissions` → "Read and write permissions"
- В `Settings → Packages → druz9-api → Manage Actions access` добавить `dobriygolang/druzya` с Admin
- В Secrets: `GITHUB_TOKEN` у CI имеет scope `packages:write` автоматически

### 3. Сертификат протух

Certbot обновляет auto каждые 12 часов. Если сломалось:
```bash
ssh deploy@druz9.online
cd /opt/druz9
docker compose -f infra/docker-compose.prod.yml run --rm certbot \
  renew --webroot -w /var/www/certbot --force-renewal
docker compose -f infra/docker-compose.prod.yml restart nginx
```

### 4. Постгрес засорился, нужен vacuum

```bash
docker compose -f infra/docker-compose.prod.yml exec postgres \
  psql -U druz9 -d druz9 -c "VACUUM FULL ANALYZE;"
```

### 5. Redis полон, eviction

По умолчанию `redis-server --save 60 1` без maxmemory-policy. Если окажется под нагрузкой:
```bash
docker compose -f infra/docker-compose.prod.yml exec redis redis-cli CONFIG SET maxmemory-policy allkeys-lru
```
Потом пропиши в `docker-compose.prod.yml` `command:` для персистентности.

### 6. LLM-токены жгутся

Grafana алёрт по `rate(druz9_llm_tokens_total{direction="prompt"}[1m]) * 60 > 100000`. Если триггернулся — в `admin/config` убавить `ai_max_concurrent_sessions` через админку (Pub/Sub hot-reload, без деплоя).

### 7. Websocket-хаб завис

```bash
docker compose -f infra/docker-compose.prod.yml restart api
# Клиенты переподключатся автоматически (retry с exp backoff, см. useFeed.ts)
```

## Секреты — ротация

| Секрет | Частота | Как ротировать |
|---|---|---|
| `JWT_SECRET` | при компрометации | смена = инвалидация всех access токенов; refresh в Redis тоже протухнет после `JWT_REFRESH_TTL` |
| `ENCRYPTION_KEY` | при компрометации | ⚠️ инвалидирует все зашифрованные OAuth-токены в БД. Нужна re-encryption миграция — задача на ops. |
| `TELEGRAM_BOT_TOKEN` | если слит | `/revoke` в @BotFather, обновить в `.env.prod`, рестарт api |
| `OPENROUTER_API_KEY` | 90 дней | сгенерить новый на openrouter.ai, обновить `.env.prod`, `docker compose restart api` |
| `EDITOR_INVITE_SECRET` | при компрометации | смена инвалидирует только outstanding invite-ссылки — безопасно менять |
| БД пароли | при компрометации | ⚠️ требует остановки — см. ниже |

Ротация БД паролей:
```bash
docker compose -f infra/docker-compose.prod.yml exec postgres \
  psql -U druz9 -c "ALTER USER druz9 WITH PASSWORD 'new-password';"
# обновить POSTGRES_PASSWORD в .env.prod
docker compose -f infra/docker-compose.prod.yml up -d --force-recreate api migrate
```

## Масштабирование (когда пора)

Триггеры из бибилии §5:

| Домен | Когда резать в отдельный сервис |
|---|---|
| `arena` | WebSocket > 500 одновременно → Grafana алёрт на `druz9_ws_connections_active{hub="arena"}` |
| `ai_mock` | LLM-запросы блокируют API (p99 > 5s длительно) |
| `notify` | Очередь > 10k/час (Redis `LLEN queue:notifications`) |
| `editor` | Совместных сессий > 200 |

Каждый домен — отдельный Go-модуль → выносится в отдельный сервис за 1-2 дня. Конкретика — разделы "Когда резать на микросервисы" в бибилии.

## Контакты

- Telegram chat: `TELEGRAM_OPS_CHAT_ID` (уведомления CI/CD)
- Логи: Grafana → `{service="api"} | json`
- Метрики: Grafana → Prometheus datasource
