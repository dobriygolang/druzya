# druz9 — первичная настройка сервера

Одноразовая процедура провижна VPS под продакшн. Занимает ~30 минут.

## 0. Что тебе нужно

- **VPS** — Ubuntu 22.04 / Debian 12, минимум 4 vCPU / 8 GB RAM / 80 GB SSD. Бибилия §7 рекомендует Германию (Hetzner, Contabo, TimeWeb Cloud EU).
- **2 домена**, оба с A/AAAA-записями на IP сервера:
  - `druz9.online` (основной)
  - `druz9.ru` (редиректит на `.online`)
  - `www.druz9.online`, `www.druz9.ru` (опционально, но желательно)
- **GitHub-репозиторий** (у тебя уже: `dobriygolang/druzya`) + SSH-ключ деплоя.
- **Секреты** (смотри `.env.prod.example` — все заполнить).

## 1. Подготовка GitHub

### 1.1 Секреты в репо

В `Settings → Secrets and variables → Actions → Repository secrets` добавить:

| Секрет | Значение |
|---|---|
| `DEPLOY_HOST` | IP или FQDN сервера |
| `DEPLOY_USER` | SSH user (`root` или `deploy` если создал) |
| `DEPLOY_SSH_KEY` | Приватный SSH ключ (одна строка с `\n`; полный PEM) |
| `DEPLOY_PORT` | 22 (если другой — указать) |
| `TELEGRAM_BOT_TOKEN` | Для уведомлений о деплое (опционально) |
| `TELEGRAM_OPS_CHAT_ID` | ID чата куда кидать статусы (опционально) |

### 1.2 GitHub Container Registry

Образ бэка пушится в `ghcr.io/dobriygolang/druz9-api`. Для пуллов на сервере и приватных репо:

```bash
# На сервере (после bootstrap.sh):
echo "<PAT-with-read:packages>" | docker login ghcr.io -u dobriygolang --password-stdin
```

PAT создаётся в `GitHub → Settings → Developer settings → Personal access tokens (classic)`, scope `read:packages`.

### 1.3 Branch protection

`Settings → Branches → Add rule` для `main`:
- ✅ Require pull request before merging
- ✅ Require status checks to pass: `Go — lint + test`, `Frontend — lint + typecheck + build`, `Proto — buf lint`, `Migrations — up/down smoke test`, `Codegen — gen-check`, `Build + push api image`
- ✅ Require branches to be up to date before merging
- ✅ Do not allow bypassing the above settings

## 2. Провижн VPS

### 2.1 Изначальная настройка

```bash
ssh root@<your-server-ip>

# Обновить систему
apt update && apt upgrade -y

# Опционально: создать юзера deploy
adduser deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys

# Отключить root SSH-логин (опционально, для безопасности)
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh
```

### 2.2 Запустить bootstrap

```bash
# Один из способов — напрямую из репо:
curl -fsSL https://raw.githubusercontent.com/dobriygolang/druzya/main/infra/scripts/bootstrap.sh | \
  sudo LETSENCRYPT_EMAIL=ops@druz9.online bash

# Или клонировать и запустить руками (рекомендовано для первого раза):
sudo mkdir -p /opt && sudo chown $USER /opt
git clone https://github.com/dobriygolang/druzya.git /opt/druz9
cd /opt/druz9
sudo LETSENCRYPT_EMAIL=ops@druz9.online bash infra/scripts/bootstrap.sh
```

Что делает `bootstrap.sh`:
1. Ставит docker + ufw + fail2ban + unattended-upgrades
2. Настраивает firewall (22/80/443)
3. Клонит репо в `/opt/druz9`
4. Создаёт `.env.prod` из шаблона (тебе нужно отредактировать ручками!)
5. Стартует `nginx` и `certbot`, выпускает TLS-сертификаты для обоих доменов (HTTP-01 challenge)
6. Поднимает весь стек
7. Применяет миграции

### 2.3 Заполнить секреты

```bash
sudo nano /opt/druz9/.env.prod
```

**Что обязательно заменить** (placeholder'ы помечены `change-me-...`):

- `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `MINIO_ROOT_PASSWORD` — длинные random строки (`openssl rand -base64 32`)
- `JWT_SECRET` — 64-байтный hex (`openssl rand -hex 32`)
- `ENCRYPTION_KEY` — **ровно 32 байта** (`openssl rand -base64 24 | head -c 32`)
- `YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET` — выдаются в [oauth.yandex.ru](https://oauth.yandex.ru/). Redirect URI: `https://druz9.online/api/v1/auth/yandex`
- `TELEGRAM_BOT_TOKEN` — выдаёт @BotFather. Одна команда `/newbot` + домен `/setdomain druz9.online`
- `TELEGRAM_WEBHOOK_SECRET` — random строка (`openssl rand -hex 16`)
- `OPENROUTER_API_KEY` — на [openrouter.ai](https://openrouter.ai/) (выдают $5 бесплатных токенов для старта)
- `EDITOR_INVITE_SECRET` — random (`openssl rand -hex 32`)
- `GRAFANA_ADMIN_PASSWORD` — random

После редактирования:
```bash
sudo chmod 600 /opt/druz9/.env.prod
cd /opt/druz9
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d
docker compose -f infra/docker-compose.prod.yml logs -f api
```

### 2.4 Применить seed-данные

```bash
# 50 задач + 5 компаний + 12 подкастов + 158 test cases
cd /opt/druz9
docker compose -f infra/docker-compose.prod.yml exec postgres psql -U druz9 -d druz9 \
  -c "SELECT section, COUNT(*) FROM tasks GROUP BY section;"
# должно показать: algorithms=30, sql=15, go=3, system_design=2
```

Миграции (в том числе `00009_seed_content.sql`) уже применил `migrate` контейнер. Если пусто — прогнать вручную:
```bash
docker compose -f infra/docker-compose.prod.yml run --rm migrate
```

## 3. DNS

В панели домен-регистратора:

```
druz9.online       A   <server-ip>
www.druz9.online   A   <server-ip>
druz9.ru           A   <server-ip>
www.druz9.ru       A   <server-ip>
```

TTL минимальный (60s) пока тестируешь. Certbot не выпустит сертификат пока DNS не зарезолвится.

## 4. Верификация

```bash
# С локалки:
curl -I https://druz9.online/health              # HTTP/2 200
curl -I https://druz9.online/api/v1/ping         # HTTP/2 401 (публичный ping под auth-роутом)
curl https://druz9.online/health/ready           # {"status":"ok","checks":{...}}
curl https://druz9.ru/ -I                        # HTTP/2 301 → druz9.online

# Connect-RPC (нативно):
curl -X POST -H 'Content-Type: application/json' -H 'Connect-Protocol-Version: 1' \
  -d '{}' https://druz9.online/druz9.v1.AuthService/Logout  # 200

# WebSocket feed (публичный, без auth):
wscat -c wss://druz9.online/ws/feed
```

## 5. Доступ к внутренним сервисам

По безопасности postgres/redis/minio-console/grafana/prometheus не торчат наружу. Доступ — через SSH-туннель:

```bash
# Prometheus (на localhost:9090):
ssh -N -L 9090:localhost:9090 deploy@druz9.online

# Grafana (на localhost:3000 — или через /grafana/ на публичном домене):
# Публичный путь: https://druz9.online/grafana/ (логин admin / GRAFANA_ADMIN_PASSWORD)

# MinIO Console (на localhost:9001):
ssh -N -L 9001:localhost:9001 deploy@druz9.online

# Postgres напрямую:
ssh -N -L 5432:localhost:5432 deploy@druz9.online
psql -h localhost -U druz9 -d druz9
```

## 6. Бэкапы

Контейнер `pgbackup` стартует автоматически, делает `pg_dumpall | gzip` раз в сутки и кладёт в MinIO-бакет `druz9-backups/daily/`. Локально держит последние 14 дампов.

Ручной бэкап:
```bash
docker compose -f infra/docker-compose.prod.yml exec postgres \
  pg_dumpall -U druz9 | gzip > /backups/manual-$(date +%Y%m%d).sql.gz
```

Восстановить:
```bash
gunzip < /backups/XXX.sql.gz | \
  docker compose -f infra/docker-compose.prod.yml exec -T postgres psql -U druz9
```

## 7. Дальше читай [DEPLOYMENT.md](./DEPLOYMENT.md)

Пушнёшь в `main` — GitHub Actions соберёт образ, запушит в GHCR, выкатит на прод через SSH. Детали там.
