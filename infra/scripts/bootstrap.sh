#!/usr/bin/env bash
# One-time server bootstrap. Run on a fresh Ubuntu 22.04 / Debian 12 VPS as a
# sudoer with docker installed. Prepares the host, fetches the repo, issues
# TLS certs, and boots the stack.
#
#   curl -fsSL https://raw.githubusercontent.com/dobriygolang/druzya/main/infra/scripts/bootstrap.sh | sudo bash
#   (OR clone the repo and run it locally)

set -euo pipefail

log() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
err() { printf '\n\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

APP_DIR=${APP_DIR:-/opt/druz9}
REPO_URL=${REPO_URL:-https://github.com/dobriygolang/druzya.git}
PRIMARY_DOMAIN=${PRIMARY_DOMAIN:-druz9.online}
SECONDARY_DOMAIN=${SECONDARY_DOMAIN:-druz9.ru}
LETSENCRYPT_EMAIL=${LETSENCRYPT_EMAIL:-}

if [ "$EUID" -ne 0 ]; then err "run as root (sudo)"; fi
if [ -z "$LETSENCRYPT_EMAIL" ]; then err "set LETSENCRYPT_EMAIL=you@domain.tld"; fi

# ── Packages + docker
log "installing OS packages"
apt-get update -y
apt-get install -y --no-install-recommends \
    curl ca-certificates git gnupg ufw fail2ban jq htop unattended-upgrades

if ! command -v docker >/dev/null 2>&1; then
    log "installing docker"
    curl -fsSL https://get.docker.com | sh
fi

# ── Firewall
log "configuring ufw"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'ssh'
ufw allow 80/tcp comment 'http (certbot + redirect)'
ufw allow 443/tcp comment 'https'
ufw --force enable

# ── Unattended security patches
log "enabling unattended-upgrades"
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null

# ── Repo
log "cloning / updating repo into $APP_DIR"
mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" fetch --all --tags --prune
    git -C "$APP_DIR" reset --hard origin/main
else
    git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# ── Secrets
if [ ! -f .env.prod ]; then
    log "creating .env.prod from template — fill in real secrets!"
    cp .env.prod.example .env.prod
    chmod 600 .env.prod
    echo ""
    echo "  Edit $APP_DIR/.env.prod NOW and re-run this script, or continue"
    echo "  with default placeholders (containers will refuse to boot)."
    echo ""
fi

# ── Bring up minimal deps so nginx can serve the HTTP-01 challenge.
log "starting nginx + certbot (HTTP only)"
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d nginx

# Give nginx a few seconds
sleep 3

# ── Issue TLS certs for both domains (first run only).
log "requesting TLS certs for $PRIMARY_DOMAIN + $SECONDARY_DOMAIN"
for domain in "$PRIMARY_DOMAIN" "$SECONDARY_DOMAIN"; do
    if ! docker compose -f infra/docker-compose.prod.yml run --rm certbot \
        certificates 2>/dev/null | grep -q "$domain"; then
        docker compose -f infra/docker-compose.prod.yml run --rm certbot \
            certonly --webroot -w /var/www/certbot \
            --email "$LETSENCRYPT_EMAIL" --agree-tos --no-eff-email \
            -d "$domain" -d "www.$domain"
    else
        echo "cert for $domain already present — skipping issuance"
    fi
done

# ── Full stack
log "bringing up full stack"
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod up -d
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod restart nginx

# ── Migrations
log "applying database migrations"
docker compose -f infra/docker-compose.prod.yml --env-file .env.prod run --rm migrate || true

log "done. verify health:"
echo "    curl -sS https://$PRIMARY_DOMAIN/health"
echo "    curl -sS https://$PRIMARY_DOMAIN/api/v1/ping"
echo ""
echo "grafana (admin panel via internal):"
echo "    ssh tunnel:  ssh -N -L 3000:localhost:3000 root@$(hostname -I | awk '{print $1}')"
echo "    then open http://localhost:3000 (user: admin, pass: from .env.prod)"
