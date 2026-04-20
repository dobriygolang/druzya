#!/usr/bin/env bash
# Invoked by GitHub Actions (via SSH) after the API image has been pushed to
# GHCR. Pulls the new image, runs migrations, performs a rolling restart of
# the api container (nginx stays up → zero user-visible downtime).
#
# Invocation (remote):
#   IMAGE_TAG=sha-abc123 bash /opt/druz9/infra/scripts/deploy.sh

set -euo pipefail

log() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }

APP_DIR=${APP_DIR:-/opt/druz9}
IMAGE=${API_IMAGE:-ghcr.io/dobriygolang/druz9-api}
TAG=${IMAGE_TAG:-latest}
COMPOSE="docker compose -f $APP_DIR/infra/docker-compose.prod.yml --env-file $APP_DIR/.env.prod"

cd "$APP_DIR"

log "fetching latest repo state"
git fetch --all --tags --prune
git reset --hard origin/main

log "pulling image ${IMAGE}:${TAG}"
export API_IMAGE="${IMAGE}:${TAG}"
echo "API_IMAGE=${API_IMAGE}" > .deploy.env
$COMPOSE pull api migrate

log "applying migrations"
$COMPOSE run --rm migrate || { echo "migrations FAILED"; exit 1; }

log "rolling restart of api + support services"
$COMPOSE up -d --no-deps --force-recreate api
$COMPOSE up -d --no-deps prometheus loki promtail grafana || true
$COMPOSE up -d --no-deps nginx

log "waiting for /health/ready"
for i in $(seq 1 30); do
    if curl -sfo /dev/null https://localhost/health/ready; then
        log "deploy healthy (attempt $i)"
        exit 0
    fi
    sleep 2
done

echo "xx /health/ready failed after 60s — inspect logs:"
$COMPOSE logs --tail=50 api
exit 1
