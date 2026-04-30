# Деплой и релизы

Разные релизные циклы для трёх артефактов:

- **Web + backend monolith** — continuous deploy на каждый merge в main.
- **Hone DMG** — еженедельно в beta, ежемесячно в stable. electron-updater feed.
- **Cue DMG** — то же, но отдельный канал и cert.

## Backend + Web — пайплайн

```
git push main
    ↓
GitHub Actions: ci.yml
    Lint (golangci-lint + eslint + tsc + buf)
    Test (go test -race + vitest)
    Build (Go binary + frontend dist)
    Codegen drift check (make gen-check)
    Image: ghcr.io/dobriygolang/druz9-api:<sha>
    ↓
GitHub Actions: deploy.yml
    SSH to VPS
    /opt/druz9/infra/scripts/deploy.sh
        - docker compose pull
        - migrate-up (goose)
        - rolling restart
    ↓
Telegram notification
```

## VPS — первичный провижн

**Целевая платформа.** Ubuntu 22.04 / Debian 12, минимум 4 vCPU / 8 GB RAM / 80 GB SSD. Рекомендуется европейская площадка (Hetzner, Contabo, TimeWeb Cloud EU) для стабильности OAuth-провайдеров.

**Домены.**

- `druz9.online` — основной.
- `druz9.ru` — редиректит на `.online`.
- `www.*` — желательно (опционально).

**Что нужно завести в GitHub Secrets:**

| Секрет | Значение |
|---|---|
| `DEPLOY_HOST` | IP или FQDN сервера |
| `DEPLOY_USER` | SSH user (root или deploy) |
| `DEPLOY_SSH_KEY` | Приватный SSH-ключ (PEM, одной строкой через `\n`) |
| `DEPLOY_PORT` | 22 (или другой) |
| `TELEGRAM_BOT_TOKEN` | Опционально — деплой-уведомления |
| `TELEGRAM_OPS_CHAT_ID` | Чат-ID для уведомлений |

**Bootstrap.**

```bash
ssh root@$VPS
git clone https://github.com/dobriygolang/druzya.git /opt/druz9
cd /opt/druz9
cp .env.prod.example .env.prod   # заполнить все секреты
bash infra/scripts/bootstrap.sh  # one-time: docker, certbot, ufw, nginx
```

**Deploy скрипт.** `infra/scripts/deploy.sh` — pull image из GHCR, миграции, rolling restart.

**Стек на проде** (`infra/docker-compose.prod.yml`):

- nginx + certbot (TLS termination + rate-limits + WS proxy)
- api (Go monolith, distroless image)
- postgres + clickhouse + redis + minio
- judge0-server + judge0-workers
- ollama (sidecar для embeddings + floor-LLM)
- prometheus + grafana + loki + promtail
- pgbackup (WAL-G на S3)

## Окружения

| Env | URL | Запуск |
|---|---|---|
| local | http://localhost:8080 | `make start` |
| prod | https://api.druzya.tech | CI auto-deploy |

## Hone & Cue релизы

Каждое из приложений собирается в свой DMG, подписывается через Apple Developer ID, нотарицируется через `notarytool`, публикуется в GitHub Releases и попадает в свой electron-updater feed.

### Pre-flight (один раз для каждого)

- Apple Developer Program ($99/год). Создать Developer ID Application certificate, скачать `.p12`.
- Зафиксировать `TEAM_ID` (10 символов).
- App-specific password для notarytool: `appleid.apple.com → Sign-In and Security → App-Specific Passwords`.
- Sentry проект — `hone-desktop` или `cue-desktop`.
- CDN/S3-bucket — `hone-updates.druzya.tech` или `cue-updates.druzya.tech`.
- OAuth redirect URIs для `druz9://` в Yandex / Telegram OAuth apps.

### GitHub Secrets (для каждого приложения отдельно)

| Секрет | Значение |
|---|---|
| `APPLE_ID` | Apple ID account |
| `APPLE_APP_PASSWORD` | app-specific password (`notarytool-hone` / `notarytool-cue`) |
| `APPLE_TEAM_ID` | 10-символьный ID |
| `CSC_LINK` | Base64-encoded p12 |
| `CSC_KEY_PASSWORD` | Пароль p12 |
| `GH_TOKEN` | Для публикации Release |
| `HONE_SENTRY_DSN` / `CUE_SENTRY_DSN` | Sentry DSN |

### Релиз Hone

Workflow `.github/workflows/hone-release.yml` запускается по тегу:

```bash
git tag hone-v0.1.0
git push origin hone-v0.1.0
```

CI собирает arm64 + x64 DMG, подписывает, нотарицирует, публикует Release. electron-updater читает `latest-mac.yml` оттуда.

### Релиз Cue

Аналогично, но отдельный certificate (если Hone-cert скомпрометирован, Cue не отзовут вместе) + отдельный update-feed channel.

Специфическое для Cue:

- Native Swift binary (`AudioCaptureMac`) должен быть подписан через `afterSign` hook (Gatekeeper отвергнет ad-hoc подписанный бинарь).
- Stealth-функции **тестируются вручную** перед релизом — матрица macOS 13/14/15/26 × {Zoom, Meet, Teams, OBS, QuickTime}.

## Аварийные процедуры

### Kill switches (без деплоя)

```bash
ssh root@$VPS
docker compose exec redis redis-cli SET killswitch:copilot_analyze on
docker compose exec redis redis-cli SET killswitch:copilot_suggestion on
docker compose exec redis redis-cli SET killswitch:transcription on

# Восстановить:
docker compose exec redis redis-cli DEL killswitch:copilot_analyze
docker compose exec redis redis-cli DEL killswitch:copilot_suggestion
docker compose exec redis redis-cli DEL killswitch:transcription

# TTL-режим (auto-unlock через час):
docker compose exec redis redis-cli SET killswitch:transcription on EX 3600
```

### Откат деплоя

```bash
ssh root@$VPS
cd /opt/druz9
docker compose pull api:<previous-sha>
docker compose up -d api
goose -dir backend/migrations postgres "$POSTGRES_DSN" down  # если нужно
```

### Бэкапы

`pgbackup` контейнер делает WAL-G в S3 (env переменные в `.env.prod`). Recovery — стандартный `wal-g backup-fetch + wal-g wal-fetch`.

## Мониторинг

- Grafana dashboards в `infra/monitoring/grafana/dashboards/`. Druz9 + Hone специальные борды.
- Loki ловит api-логи через promtail.
- Sentry для main-process Hone/Cue + renderer-error reporting.

Алерты — Grafana → Telegram (через webhook бот `TELEGRAM_OPS_CHAT_ID`).

## Что должно быть зелёным перед релизом

- **CI:** lint + test + gen-check проходят.
- **Smoke (web):** `/health` отвечает 200, `/api/v1/profile/me` отвечает 401 без токена и 200 с ним.
- **Smoke (Hone):** open → login → Today shows plan → Focus 25 minutes → Stats показал инкремент.
- **Smoke (Cue):** open → ⌘⇧Space → screenshot prompt → ответ за <5s. setContentProtection: тест Zoom screen-share не показывает окно.
