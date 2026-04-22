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
# node:22 (debian-based slim) — alpine-варианты страдают от двух багов одновременно:
#   1) npm 10.x в alpine падает с "Exit handler never called!" на больших lockfile
#   2) npm self-upgrade ломается из-за musl/glibc разницы
# debian slim тяжелее на ~30MB, но стабильно работает.
FROM node:22-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json* ./
# Без --no-optional: rollup тянет платформенные нативные бинари
# (@rollup/rollup-linux-x64-gnu) как optional deps, и Vite на них падает
# с MODULE_NOT_FOUND если их пропустить.
RUN npm ci --no-audit --no-fund
COPY frontend ./
ENV VITE_USE_MSW=false
# Зовём vite напрямую через локальный bin, чтобы npx не вздумал качать
# свою свежую версию (как было: npx тянул vite@8 и ломал резолв конфига).
RUN ./node_modules/.bin/vite build

# ── Stage 2: nginx с фронтом и нашим конфигом.
FROM nginx:1.27-alpine
# Готовый билд кладём туда, куда смотрит `root /var/www/frontend;` в конфиге.
COPY --from=frontend /src/frontend/dist /var/www/frontend
COPY infra/nginx/nginx.prod.conf /etc/nginx/nginx.conf
EXPOSE 80 443
