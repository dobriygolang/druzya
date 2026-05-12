#!/usr/bin/env bash
# smoke.sh — minimum-viable smoke test for the druz9 web stack.
#
# Validates:
#   1. Backend health endpoint responds 200
#   2. Vite dev server responds on :5173
#   3. Each main public route returns 200 (not 4xx/5xx)
#   4. Each route HTML body is non-empty (catches SPA shell mounting)
#
# Designed to run in < 30s on a fresh dev stack. Not a replacement for
# Playwright e2e — those live in `frontend/tests/e2e/`. This is the
# "did I break the build catastrophically?" sanity check that a new
# contributor can run as their first task.
#
# Usage:
#   make start && make front      # in two terminals
#   bash frontend/scripts/smoke.sh
#
# CI usage (deployed preview):
#   FRONT_URL=https://preview.druz9.online \
#   BACKEND_URL=https://api.druz9.online \
#     bash frontend/scripts/smoke.sh

set -uo pipefail

FRONT_URL="${FRONT_URL:-http://localhost:5173}"
BACKEND_URL="${BACKEND_URL:-http://localhost:8080}"

# Public routes that should render the SPA shell without auth. Authed routes
# (e.g. /today) redirect to /welcome — also 200, just different shell. We
# accept any 2xx/3xx.
ROUTES=(
  "/"
  "/welcome"
  "/login"
  "/today"
  "/codex"
  "/atlas"
  "/profile"
  "/diagnostic"
  "/mock"
  "/pricing"
  "/legal/terms"
  "/legal/privacy"
  "/help"
)

PASS=0
FAIL=0

echo "smoke: FRONT_URL=$FRONT_URL"
echo "smoke: BACKEND_URL=$BACKEND_URL"
echo ""

# ─── 1. Backend health check ───────────────────────────────────────
echo "── Backend health ──"
status=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "$BACKEND_URL/api/v1/health" 2>/dev/null || echo "000")
if [[ "$status" == "200" ]]; then
  echo "  ✓ $BACKEND_URL/api/v1/health → 200"
  PASS=$((PASS + 1))
else
  echo "  ✗ $BACKEND_URL/api/v1/health → $status (expected 200)"
  echo "    hint: backend not running? make start"
  FAIL=$((FAIL + 1))
fi
echo ""

# ─── 2. Vite dev server check ──────────────────────────────────────
echo "── Frontend reachable ──"
status=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "$FRONT_URL/" 2>/dev/null || echo "000")
if [[ "$status" =~ ^(200|301|302)$ ]]; then
  echo "  ✓ $FRONT_URL/ → $status"
  PASS=$((PASS + 1))
else
  echo "  ✗ $FRONT_URL/ → $status (expected 200/301/302)"
  echo "    hint: dev server not running? make front"
  FAIL=$((FAIL + 1))
fi
echo ""

# ─── 3. Routes return 2xx/3xx + non-empty body ────────────────────
echo "── SPA routes ──"
for path in "${ROUTES[@]}"; do
  resp=$(curl -sS -o /tmp/druz9-smoke-body.html -w "%{http_code}" --max-time 10 "$FRONT_URL$path" 2>/dev/null || echo "000")
  body_size=$(wc -c < /tmp/druz9-smoke-body.html 2>/dev/null || echo "0")

  if [[ "$resp" =~ ^(200|301|302|304)$ ]] && [[ $body_size -gt 200 ]]; then
    echo "  ✓ $path → $resp (${body_size}B)"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $path → $resp (body: ${body_size}B)"
    FAIL=$((FAIL + 1))
  fi
done
rm -f /tmp/druz9-smoke-body.html
echo ""

# ─── 4. Verify root HTML contains the SPA mount point ─────────────
echo "── SPA mount point ──"
root_html=$(curl -sS --max-time 10 "$FRONT_URL/" 2>/dev/null || echo "")
if echo "$root_html" | grep -q 'id="root"'; then
  echo "  ✓ <div id=\"root\"> present in $FRONT_URL/"
  PASS=$((PASS + 1))
else
  echo "  ✗ <div id=\"root\"> missing — index.html broken?"
  FAIL=$((FAIL + 1))
fi
echo ""

# ─── Summary ──────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════"
echo "smoke: $PASS passed, $FAIL failed"
if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0
