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
# node:22-alpine — у 20-alpine npm 10.8.2 в контейнере иногда падает с
# "Exit handler never called!" на optional deps (известный баг). 22 везёт
# свежий npm, проблема не воспроизводится.
FROM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json* ./
# Без --no-optional: rollup тянет платформенные нативные бинари
# (@rollup/rollup-linux-x64-musl) как optional deps, и Vite на них падает
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
