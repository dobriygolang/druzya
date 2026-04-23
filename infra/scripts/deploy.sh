#!/usr/bin/env bash
# Invoked by GitHub Actions (via SSH) after the API image has been pushed to
# GHCR. Pulls the new image, runs migrations, performs a rolling restart of
# the api container (nginx stays up → zero user-visible downtime).
#
# NOTE [WAVE-12]: Judge0 (server + workers + own pg/redis) is part of the prod
# stack now and is started here before migrate runs so the editor service has
# a healthy sandbox at startup. If Judge0 fails to come up the rest of the
# stack still ships — the editor falls back to an honest 503.
#
# Invocation (remote):
#   IMAGE_TAG=sha-abc123 bash /opt/druz9/infra/scripts/deploy.sh

set -euo pipefail

log() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }

APP_DIR=${APP_DIR:-/opt/druz9}
API_IMAGE_BASE=${API_IMAGE:-ghcr.io/dobriygolang/druz9-api}
WEB_IMAGE_BASE=${WEB_IMAGE:-ghcr.io/dobriygolang/druz9-web}
TAG=${IMAGE_TAG:-latest}
COMPOSE="docker compose -f $APP_DIR/infra/docker-compose.prod.yml --env-file $APP_DIR/.env.prod"

cd "$APP_DIR"

log "fetching latest repo state"
git fetch --all --tags --prune
git reset --hard origin/main

log "pulling images api=${API_IMAGE_BASE}:${TAG} web=${WEB_IMAGE_BASE}:${TAG}"
export API_IMAGE="${API_IMAGE_BASE}:${TAG}"
export WEB_IMAGE="${WEB_IMAGE_BASE}:${TAG}"
{
    echo "API_IMAGE=${API_IMAGE}"
    echo "WEB_IMAGE=${WEB_IMAGE}"
} > .deploy.env
# `web` тегаем тем же sha, что и `api`. Если конкретный sha web-образа ещё не
# опубликован (например, в этом коммите фронт не менялся и job-image-web был
# скипнут), фолбэчимся на :latest, чтобы деплой не падал.
if ! docker pull "${WEB_IMAGE}" 2>/dev/null; then
    log "web image ${WEB_IMAGE} not found, falling back to ${WEB_IMAGE_BASE}:latest"
    export WEB_IMAGE="${WEB_IMAGE_BASE}:latest"
    sed -i "s|^WEB_IMAGE=.*|WEB_IMAGE=${WEB_IMAGE}|" .deploy.env
    docker pull "${WEB_IMAGE}"
fi
$COMPOSE pull api migrate nginx

log "starting infra services (postgres/redis/minio/clickhouse) before app"
# api зависит от Redis/MinIO/ClickHouse через сетевой DNS; если они не
# подняты — модули падают с "lookup redis: no such host" и прочим. Поднимаем
# инфру заранее, потом миграции, потом api.
$COMPOSE up -d postgres redis minio clickhouse

# Judge0 isolated stack (own pg + redis + server + workers). Запускаем ДО миграций,
# чтобы editor service не словил ECONNREFUSED при первом probe-запросе. Если
# Judge0 не поднялся — деплой не валим, остальное должно уехать (editor вернёт
# честный 503).
log "starting Judge0 stack (db, redis, server, workers)"
$COMPOSE up -d judge0-db judge0-redis || log "WARN: judge0 db/redis failed to start"
$COMPOSE up -d judge0-server judge0-workers || log "WARN: judge0 server/workers failed to start"

log "waiting for Judge0 healthcheck (max 60s)"
for i in $(seq 1 30); do
    j0_id=$($COMPOSE ps -q judge0-server 2>/dev/null || true)
    if [ -n "$j0_id" ] && docker inspect --format='{{.State.Health.Status}}' "$j0_id" 2>/dev/null | grep -q healthy; then
        log "judge0 healthy (attempt $i)"
        break
    fi
    if [ "$i" = "30" ]; then
        log "WARN: judge0 not healthy after 60s — proceeding (editor will 503 honestly)"
    fi
    sleep 2
done

log "applying migrations"
$COMPOSE run --rm migrate || { echo "migrations FAILED"; exit 1; }

log "rolling restart of api + support services"
$COMPOSE up -d --no-deps --force-recreate api
$COMPOSE up -d --no-deps prometheus loki promtail grafana || true
# nginx тоже force-recreate: образ druz9-web мог обновиться на тот же :latest
# тег, и без --force-recreate compose оставит старый контейнер.
$COMPOSE up -d --no-deps --force-recreate nginx

log "waiting for /health/ready"
# Бьём по nginx через https://localhost с -k: серт у нас на druz9.online,
# поэтому без -k curl упадёт на TLS-name mismatch ещё до того, как увидит
# 200 от api. Содержимое запроса всё равно идёт на тот же loopback.
for i in $(seq 1 30); do
    if curl -sfk -o /dev/null https://localhost/health/ready; then
        log "deploy healthy (attempt $i)"

        # ------------------------------------------------------------------
        # Cleanup — runs ONLY after a successful health check so we never
        # nuke a working image while the new one is still failing rollout.
        #
        #   1. `docker container prune -f` — drop stopped containers from
        #      previous deploys (force-recreate leaves them as Exited).
        #   2. `docker image prune -af` with a label filter so we don't
        #      touch unrelated images on the host. Keeps any image still
        #      referenced by a running container.
        #   3. `docker volume prune -f` is *intentionally omitted* — that
        #      would wipe postgres/minio/redis data. Volumes are forever.
        # ------------------------------------------------------------------
        log "cleaning up stale containers + images + build cache"
        # 1. Exited контейнеры от прошлых force-recreate.
        docker container prune -f >/dev/null || true
        # 2. Образы, не используемые ни одним контейнером, старше 24ч.
        # Это включает старые sha-теги druz9-api/druz9-web после force-recreate.
        docker image prune -af --filter "until=24h" >/dev/null || true
        # 3. Build cache (overlay-слои buildx) — на VPS мы не билдим, но кеш
        # может появиться от ручных docker build. 24ч TTL.
        docker builder prune -af --filter "until=24h" >/dev/null || true
        # 4. Висящие network-объекты от прошлых compose-проектов.
        docker network prune -f >/dev/null || true
        # NB: docker volume prune НЕ запускаем — это снесло бы pg_data, minio_data и т.д.
        log "post-deploy disk usage:"
        docker system df

        exit 0
    fi
    sleep 2
done

echo "xx /health/ready failed after 60s — inspect logs:"
$COMPOSE logs --tail=50 api
exit 1
