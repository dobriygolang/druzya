# Runbook

Что делать, когда что-то горит. Команды для on-call. Не теория — последовательности шагов.

> Если есть пейджер от Telegram-алертинга — открой, найди алерт, ниже инструкция.

## Содержание

- [Сайт лежит / `APIDown` / `APIErrorRateHigh`](#сайт-лежит)
- [Высокая latency / `APILatencyP99High`](#высокая-latency)
- [LLM-провайдеры лежат / `LLMChainFailure`](#llm-провайдеры-лежат)
- [Postgres недоступен / `PostgresDown`](#postgres-недоступен)
- [Redis недоступен / `RedisDown`](#redis-недоступен)
- [Migration упала на проде](#migration-упала-на-проде)
- [Compromised endpoint / нужно отключить фичу без деплоя](#kill-switches)
- [Откат деплоя](#откат-деплоя)
- [Restore из бэкапа](#restore-из-бэкапа)
- [Sentry заваливает алертами](#sentry-заваливает-алертами)
- [Hone / Cue update-feed сломан](#hone--cue-update-feed-сломан)

---

## Сайт лежит

**Симптом:** `APIDown` или `APIErrorRateHigh` (5xx > 1% за 5m).

```bash
ssh root@$VPS
cd /opt/druz9

# 1. Проверить, что api контейнер вообще живой
docker compose ps api
docker compose logs --tail=200 api

# 2. Если контейнер упал — попробовать поднять
docker compose up -d api
sleep 5
curl -fsS http://localhost:8080/health    # должен ответить 200

# 3. Если падает в краш-loop — смотри stack trace в логах
docker compose logs --tail=500 api | grep -E "panic|fatal|FATAL"

# 4. Если только что был деплой — откатываем (см §Откат деплоя)
```

**Если 4 не помогло**: проверить Postgres/Redis (`docker compose ps`). API падает на старте, если не может подключиться к БД.

**Когда уверенно фиксанул:**

```bash
# Проверить что метрики ожили
curl -fsS http://localhost:8080/metrics | grep druz9_http_requests_total

# Закрыть инцидент в Telegram-канале
```

---

## Высокая latency

**Симптом:** `APILatencyP99High` (p99 > 1s за 5m).

```bash
# 1. Открыть Grafana → druz9-tech.json
#    Смотрим: HTTP latency by route + Postgres pool wait_count + Redis latency.

# 2. Если pgxpool.wait_count растёт — БД залипла. Идём в Postgres:
ssh root@$VPS
docker compose exec postgres psql -U druz9 -d druz9 -c "
  SELECT pid, now() - pg_stat_activity.query_start AS duration, query
  FROM pg_stat_activity
  WHERE state != 'idle' AND now() - pg_stat_activity.query_start > '30 seconds'
  ORDER BY duration DESC
  LIMIT 10;
"

# 3. Если LLM latency высокая — провайдер деградирует. Смотрим druz9-llm.json
#    chain должен auto-fallback'нуться, но иногда залипает один request.
#    Если лимит provider'а близок — включить kill-switch (см §Kill-switches).
```

**Тяжёлые случаи**: если БД лочится — `pg_terminate_backend(pid)` для самого долгого запроса. **Только если уверен**, что это не блокирующий backfill.

---

## LLM-провайдеры лежат

**Симптом:** `LLMChainFailure` — все провайдеры в chain дают error.

Chain: Groq → Cerebras → Mistral → OpenRouter → Ollama. Если упали все 4 верхних — Ollama (sidecar) должен продолжать обслуживать.

```bash
# 1. Проверить что Ollama живой
ssh root@$VPS
docker compose ps ollama
docker compose exec ollama ollama list

# 2. Если Ollama не отвечает — рестарт
docker compose restart ollama

# 3. Включить kill-switch на дорогие LLM-фичи, чтобы не нагружать floor:
docker compose exec redis redis-cli SET killswitch:copilot_analyze on EX 1800
docker compose exec redis redis-cli SET killswitch:copilot_suggestion on EX 1800
docker compose exec redis redis-cli SET killswitch:transcription on EX 1800

# 4. Проверить статус провайдеров вручную:
curl -s -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models | head
curl -s https://status.mistral.ai/  # если есть статус-страница

# 5. Когда верхние провайдеры починятся — снять kill-switch'и:
docker compose exec redis redis-cli DEL killswitch:copilot_analyze
docker compose exec redis redis-cli DEL killswitch:copilot_suggestion
docker compose exec redis redis-cli DEL killswitch:transcription
```

**TTL EX 1800** = автоматически снимутся через 30 минут, чтобы не забыть.

---

## Postgres недоступен

**Симптом:** `PostgresDown`.

```bash
ssh root@$VPS
docker compose ps postgres
docker compose logs --tail=100 postgres

# Частые причины:
# (a) Диск кончился. Проверить:
df -h /var/lib/docker

# (b) Процесс убит OOM-killer'ом:
dmesg | grep -i "killed process"

# (c) Сам контейнер упал. Просто подняли:
docker compose up -d postgres

# Если БД не стартует и видим corruption:
#   - НЕ дёргать `docker compose down -v` (стирает volume).
#   - Запускать в single-user mode для recovery:
#     docker compose run --rm postgres postgres --single -D /var/lib/postgresql/data druz9
#   - Если совсем плохо — restore из бэкапа (см §Restore).
```

API сам не стартует без Postgres — после восстановления Postgres подними api: `docker compose up -d api`.

---

## Redis недоступен

**Симптом:** `RedisDown`.

Redis держит kill-switches, quotas, rate-limits, distributed locks. Без него:

- Quota-проверки fail-open (пропускаем все запросы — НЕ безопасно при долгом outage).
- Rate-limits отключены (DDoS-vulnerability).
- Kill-switches игнорируются (опасно если фича уже compromise'нута).

```bash
ssh root@$VPS
docker compose ps redis
docker compose restart redis

# Если данные в Redis — это только кэш, можно дропать:
docker compose exec redis redis-cli FLUSHALL    # ОПАСНО, только если уверен

# После восстановления — пересоздать критичные kill-switch'и если они были включены
```

**Если outage > 15 минут** — рассмотреть включение глобального degraded mode (если такой есть в коде) или ручную остановку приёма новых регистраций / heavy-LLM эндпоинтов.

---

## Migration упала на проде

**Симптом:** деплой завис на `goose up`, либо `make migrate-up` локально показал ERROR.

```bash
ssh root@$VPS
cd /opt/druz9

# 1. Посмотреть, на какой миграции встали
docker compose exec postgres psql -U druz9 -d druz9 -c "SELECT * FROM goose_db_version ORDER BY id DESC LIMIT 5;"

# 2. Прочитать сам файл миграции и понять, что сломалось
cat backend/migrations/00013_xxx.sql

# 3. Если упали в середине транзакции — Postgres откатил всё в этом файле.
#    Но goose-record может остаться "applying" — проверить:
docker compose exec postgres psql -U druz9 -d druz9 -c "SELECT * FROM goose_db_version WHERE is_applied = false;"

# 4. Зафиксить файл локально → коммит → новый деплой.
#    НЕ редактировать миграцию которая уже применилась — добавить новый файл с фиксом.

# 5. Если очень припёрло (только staging!) — откат:
goose -dir backend/migrations postgres "$POSTGRES_DSN" down
```

**Down-блоки в наших миграциях — `SELECT 1;` no-op** (см `backend/migrations/README.md`). На проде катаем forward-only. Поломали что-то — фикс новой миграцией.

---

## Kill switches

5 фичей, которые можно отключить без деплоя через Redis-флаг.

```bash
ssh root@$VPS

# Включить (всегда с TTL — auto-cleanup через час):
docker compose exec redis redis-cli SET killswitch:copilot_analyze on EX 3600
docker compose exec redis redis-cli SET killswitch:copilot_suggestion on EX 3600
docker compose exec redis redis-cli SET killswitch:transcription on EX 3600
docker compose exec redis redis-cli SET killswitch:documents_upload on EX 3600
docker compose exec redis redis-cli SET killswitch:documents_url on EX 3600

# Постоянное включение (без TTL) — только если планируется длинный downtime:
docker compose exec redis redis-cli SET killswitch:transcription on

# Снять:
docker compose exec redis redis-cli DEL killswitch:transcription

# Проверить какие включены:
docker compose exec redis redis-cli KEYS 'killswitch:*'
```

При активном kill-switch фича возвращает `503 Service Unavailable` с `X-KillSwitch: <feature>` header.

Источник правды: `backend/shared/pkg/killswitch/redis.go` — список Feature constants.

---

## Откат деплоя

```bash
ssh root@$VPS
cd /opt/druz9

# 1. Найти предыдущий sha (по тегам в GHCR):
docker images | grep druz9-api | head -5

# 2. Перетянуть прошлую версию:
PREV_SHA=8aabb95   # подставить прошлый sha из git log
docker compose pull api:${PREV_SHA}    # если такой тег есть в registry
# Или, если работаем с :latest — пропустить и сразу указать sha в compose-file
sed -i "s|druz9-api:.*|druz9-api:${PREV_SHA}|" docker-compose.prod.yml

# 3. Поднять прошлую версию:
docker compose up -d api

# 4. ВАЖНО: если новая версия успела накатить миграции — нужен `goose down`?
#    Только если миграция ломает совместимость со старой версией кода (drop column).
#    Большинство миграций forward-compatible — НЕ откатываем по умолчанию.

# 5. Проверить:
curl -fsS http://localhost:8080/health
# В Telegram-канале: "rolled back to <prev_sha>"
```

После отката — fix root cause локально, новый деплой через CI.

---

## Restore из бэкапа

`pgbackup` контейнер делает WAL-G в S3 каждый день.

```bash
ssh root@$VPS
cd /opt/druz9

# 1. Зайти в backup container
docker compose exec pgbackup bash

# 2. Список доступных бэкапов:
wal-g backup-list

# 3. Восстановить последний:
wal-g backup-fetch /var/lib/postgresql/restore LATEST
wal-g wal-fetch <WAL_FILE> /var/lib/postgresql/restore/pg_wal/

# 4. Поднять Postgres из restored data dir:
#    (см детали в backup.sh; зависит от того, как настроен restore-flow)
```

Полный recovery — задача на 30-60 минут. **Тестировать раз в квартал** (не в продакшене — на staging dump'е).

---

## Sentry заваливает алертами

Если один и тот же error льётся тысячами:

1. **Найти issue в Sentry UI** — кликнуть на алерт, открыть issue.
2. **Mute** на час пока разбираемся (Resolve / Mute → for 1 hour).
3. **Найти root cause**: смотри stack trace, breadcrumbs.
4. **Если критично** — kill-switch + откат деплоя.
5. **Если cosmetic** — фикс в новом деплое.

**Не отключать Sentry полностью** — потеряем алерты на новые real проблемы.

---

## Hone / Cue update-feed сломан

**Симптом:** пользователи пишут «не обновляется», electron-updater молчит.

```bash
# 1. Проверить latest-mac.yml в S3-бакете update-feed:
curl https://hone-updates.druzya.tech/latest-mac.yml

# Должен вернуть YAML с version + sha512 + size. Если 403/404 — bucket policy сломалась.

# 2. Проверить что DMG доступен:
curl -I https://github.com/dobriygolang/druzya/releases/download/hone-v0.1.5/druz9-Hone-0.1.5-arm64.dmg
# 200 / 302 → ОК. 404 → release удалён.

# 3. Локально протестировать обновление:
cd hone
npm run build
# Открыть DMG из dist/, проверить что update detection работает.

# 4. Если CI workflow упал на notarize — смотри Apple Developer status page.
#    Нотарицация может зависать на 5-30 минут — нормально. > 1 часа — отдельный issue.
```

---

## Эскалация

Если runbook не помог:

- **Прод-incident** — пинг в Telegram ops-чат с тегом `@oncall`. Не молчим.
- **Утечка данных / security** — отдельный канал, ручной вызов Sergey.
- **Финансовый ущерб (биллинг)** — отдельный escalation path после wiring ЮKassa (TODO).

## Чек-лист после инцидента

- [ ] Алерт closed в Grafana / Telegram.
- [ ] Root cause зафиксирован (1-2 предложения в TG-канал).
- [ ] Создан фикс-PR / задача (если не immediate fix).
- [ ] Если был >30 минут downtime — короткий postmortem (impact, timeline, action items).
