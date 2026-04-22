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
FROM node:20-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY frontend ./
ENV VITE_USE_MSW=false
RUN npx vite build

# ── Stage 2: nginx с фронтом и нашим конфигом.
FROM nginx:1.27-alpine
# Готовый билд кладём туда, куда смотрит `root /var/www/frontend;` в конфиге.
COPY --from=frontend /src/frontend/dist /var/www/frontend
COPY infra/nginx/nginx.prod.conf /etc/nginx/nginx.conf
COPY infra/nginx/snippets /etc/nginx/snippets
EXPOSE 80 443
