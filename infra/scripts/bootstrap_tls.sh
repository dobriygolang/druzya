#!/usr/bin/env bash
# Первичная выдача TLS-сертификата для druz9.online на свежем VPS.
#
# Проблема: nginx.prod.conf hard-кодит ssl_certificate пути. При отсутствии
# файлов сертификата nginx emerg'ит и не поднимается. Без :80 от nginx —
# certbot webroot-режим не работает (ACME challenge не доходит). Chicken-
# and-egg. Фикс — разово поднять certbot в --standalone режиме (сам слушает
# :80 для ACME, без nginx), получить cert, потом стартануть nginx.
#
# Запускать ОДИН РАЗ на свежем VPS / после потери certbot_conf volume.
# Последующие renew делаются certbot-сервисом из docker-compose.prod.yml
# в ежедневном цикле (`while :; do certbot renew; sleep 12h; done`).
#
# Prereqs:
#   - DNS на druz9.online + www.druz9.online резолвится на IP этого VPS
#   - Порт 80 открыт снаружи (Hetzner Firewall inbound rule)
#   - Nginx контейнер ОСТАНОВЛЕН (или не запущен) — чтобы port 80 был свободен
#   - Переменные DOMAIN и EMAIL либо заданы через env, либо используются defaults

set -euo pipefail

log() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }

APP_DIR=${APP_DIR:-/opt/druz9}
DOMAIN=${DOMAIN:-druz9.online}
DOMAIN_WWW=${DOMAIN_WWW:-www.druz9.online}
EMAIL=${EMAIL:-ops@druz9.online}
COMPOSE="docker compose -f $APP_DIR/infra/docker-compose.prod.yml --env-file $APP_DIR/.env.prod"

cd "$APP_DIR"

log "проверяем что nginx остановлен (port 80 должен быть свободен)"
if $COMPOSE ps nginx 2>/dev/null | grep -q "running\|Up"; then
    log "nginx запущен — останавливаем на время bootstrap'а"
    $COMPOSE stop nginx
fi

log "standalone certbot для первичной выдачи $DOMAIN + $DOMAIN_WWW"
docker run --rm \
    -p 80:80 \
    -v infra_certbot_conf:/etc/letsencrypt \
    -v infra_certbot_www:/var/www/certbot \
    certbot/certbot certonly --standalone \
    -d "$DOMAIN" -d "$DOMAIN_WWW" \
    --email "$EMAIL" --agree-tos --non-interactive \
    --no-eff-email

log "проверяем что сертификат создался"
if ! docker run --rm -v infra_certbot_conf:/etc/letsencrypt alpine \
        ls "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" 2>/dev/null; then
    echo "xx сертификат не найден — certbot упал или volume не тот"
    exit 1
fi

log "стартуем nginx с сертификатом"
$COMPOSE up -d nginx

log "проверяем /health/ready"
for i in $(seq 1 10); do
    if curl -sfk -o /dev/null "https://$DOMAIN/health/ready"; then
        echo "✅ druz9.online отвечает по HTTPS — bootstrap завершён"
        exit 0
    fi
    sleep 3
done
echo "xx /health/ready не отвечает — проверь 'docker compose logs nginx'"
exit 1
