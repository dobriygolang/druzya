# syntax=docker/dockerfile:1.7
# Web-образ: nginx + встроенный билд фронта.
# Собирается из корня репо: docker build -f infra/web.Dockerfile .
#
# Один образ обслуживает:
#   • статику фронта (Vite build → /usr/share/nginx/html)
#   • TLS-терминацию + reverse-proxy на api/minio/grafana (/etc/nginx/nginx.conf)
#
# В docker-compose.prod.yml сервис `nginx` ссылается именно на этот образ
# (ghcr.io/dobriygolang/druz9-web:<tag>). Пересобирается тем же CI workflow,
# что и api.

# ── Stage 1: vite build.
# Используем yarn 1.x вместо npm: npm 10.x ловит "Exit handler never called!"
# в GHA-раннерах с ограниченной памятью на нашем lockfile (corepack-обновление
# до npm 11 тоже не помогает). Yarn существенно легче по RAM и в CI стабильнее.
# Lockfile синхронизируется через `yarn import` из существующего package-lock.json,
# поэтому источник истины (npm) не теряется.
FROM node:22-slim AS frontend
WORKDIR /src/frontend
ENV NODE_OPTIONS=--max-old-space-size=4096 CI=true
RUN corepack enable && corepack prepare yarn@1.22.22 --activate

# ── Layer 1: manifests only. Changes to .ts/.tsx don't bust this layer,
# so `yarn install` runs once per lockfile change.
COPY frontend/package.json frontend/package-lock.json* ./
# yarn import конвертирует package-lock.json → yarn.lock (одноразово в build-стадии);
# затем install --frozen-lockfile гарантирует бит-в-бит ту же версионную смесь.
# Cache mount on /usr/local/share/.cache/yarn persists across builds — yarn
# reuses tarballs without re-download even when node_modules layer invalidates.
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
    yarn import || true
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
    yarn install --frozen-lockfile --non-interactive --no-progress

# ── Layer 2: source tree. Bust on any frontend change.
COPY frontend ./
ENV VITE_USE_MSW=false
# Зовём vite напрямую через локальный bin, чтобы npx не вздумал качать
# свою свежую версию (как было: npx тянул vite@8 и ломал резолв конфига).
RUN --mount=type=cache,target=/src/frontend/node_modules/.vite \
    ./node_modules/.bin/vite build

# ── Stage 2: nginx с фронтом и нашим конфигом.
FROM nginx:1.27-alpine
# Готовый билд кладём туда, куда смотрит `root /var/www/frontend;` в конфиге.
COPY --from=frontend /src/frontend/dist /var/www/frontend
COPY infra/nginx/nginx.prod.conf /etc/nginx/nginx.conf
EXPOSE 80 443
