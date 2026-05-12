#!/usr/bin/env bash
# a11y-check.sh — WCAG AA/AAA pass over the main routes via axe-core.
#
# Strategy: spin up the dev server (Vite + MSW) if not already running, then
# point @axe-core/cli at each URL. Output is human-readable + machine-parseable
# (--exit fails on violations). Run as:
#
#   bash frontend/scripts/a11y-check.sh
#
# Or, in CI, set BASE_URL to a deployed preview:
#
#   BASE_URL=https://preview.druz9.online bash frontend/scripts/a11y-check.sh
#
# This script does NOT install @axe-core/cli — it uses npx (downloads on
# first run, cached afterwards). Keeps frontend/package.json clean since we
# don't ship a11y tooling to prod.

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:5173}"

# Routes to audit. Each entry is a path relative to BASE_URL. Pick high-traffic
# public surfaces + key authed routes. Authed routes will redirect to /welcome
# unauthenticated — that's fine, we're auditing the /welcome shell anyway.
ROUTES=(
  "/welcome"
  "/login"
  "/today"
  "/codex"
  "/atlas"
  "/atlas/explore"
  "/profile"
  "/profile/settings"
  "/notifications"
  "/help"
  "/diagnostic"
  "/mock"
  "/pricing"
)

# Tags to test: WCAG 2.1 AA + AAA + best practices. AAA fails are expected to
# be a longer list — review docs/tech/a11y.md for prioritized fixes.
TAGS="wcag2a,wcag2aa,wcag21aa,wcag2aaa,wcag21aaa,best-practice"

echo "a11y-check: BASE_URL=$BASE_URL tags=$TAGS"
echo "Scanning ${#ROUTES[@]} routes…"
echo ""

FAILED=0
for path in "${ROUTES[@]}"; do
  url="$BASE_URL$path"
  echo "── $url ──"
  # --exit returns non-zero on any violation. We don't want one route to abort
  # the whole sweep, so we tolerate failure here and aggregate at the end.
  if ! npx --yes @axe-core/cli@4 "$url" \
        --tags "$TAGS" \
        --timeout 60 \
        --exit 2>&1 | tail -n 40; then
    FAILED=$((FAILED + 1))
    echo "  ↑ violations found on $path"
  else
    echo "  ✓ clean: $path"
  fi
  echo ""
done

echo "═══════════════════════════════════════════════════════════════"
if [[ $FAILED -gt 0 ]]; then
  echo "a11y-check: $FAILED of ${#ROUTES[@]} routes have violations."
  echo "Review docs/tech/a11y.md for severity ranking + fix vs defer."
  exit 1
else
  echo "a11y-check: all ${#ROUTES[@]} routes pass WCAG AA/AAA scan."
  exit 0
fi
