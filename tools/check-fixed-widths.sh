#!/usr/bin/env bash
# Lint advisory — find inline `style={{ width: ... }}` or `width: 'NNNpx'`
# in .tsx/.ts files without an accompanying min/maxWidth in the same block.
#
# Memory rule (feedback_responsive_rule.md):
#   "все UI должны flex на любое разрешение, NO fixed widths без min/max + flex-wrap"
#
# Exit codes:
#   0 — no offenders (or fewer than baseline; baseline lives at .tokens.baseline)
#   1 — count increased vs baseline (CI guard)
#
# Run:
#   tools/check-fixed-widths.sh            # advisory, prints count
#   tools/check-fixed-widths.sh --update   # overwrite baseline (after intentional reduction)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE="$ROOT/tools/.fixed-widths-baseline"

# Search scopes: only renderer/UI directories. Skip generated, node_modules, tests.
SCOPES=(
  "$ROOT/frontend/src"
  "$ROOT/hone/src/renderer/src"
  "$ROOT/cue/src/renderer"
)

# Pattern A — JSX inline style object: `style={{ width: NNN`
# Pattern B — string-literal CSS: `width: 'NNNpx'`
# Both flagged unless the same file contains `minWidth` or `maxWidth` within
# +/-3 lines (heuristic, not strict — designed to catch the common pattern
# `style={{ width: 320 }}` without a clamp).

count=0
offenders=()

for scope in "${SCOPES[@]}"; do
  [ -d "$scope" ] || continue
  while IFS= read -r -d '' file; do
    case "$file" in
      *node_modules*|*.test.*|*.generated.*|*/__generated__/*|*/dist/*) continue ;;
    esac
    # Grep candidate lines with line numbers.
    matches=$(grep -nE "style=\{\{[^}]*\bwidth: *[0-9]+|width: *'[0-9]+px'" "$file" 2>/dev/null || true)
    [ -z "$matches" ] && continue

    while IFS= read -r match; do
      [ -z "$match" ] && continue
      lineno="${match%%:*}"
      # Check +/-3 lines for minWidth/maxWidth clamps.
      start=$(( lineno - 3 ))
      [ "$start" -lt 1 ] && start=1
      end=$(( lineno + 3 ))
      if sed -n "${start},${end}p" "$file" | grep -q -E 'minWidth|maxWidth|min-width|max-width|flex-wrap-row|min-w-0|auto-fit-grid'; then
        continue
      fi
      count=$((count + 1))
      offenders+=("$file:$lineno")
    done <<< "$matches"
  done < <(find "$scope" -type f \( -name '*.tsx' -o -name '*.ts' \) -print0)
done

if [ "${1:-}" = "--update" ]; then
  echo "$count" > "$BASELINE"
  echo "baseline updated: $count fixed-width offenders"
  exit 0
fi

baseline=0
[ -f "$BASELINE" ] && baseline=$(cat "$BASELINE")

echo "fixed-width offenders: $count (baseline: $baseline)"

if [ "$count" -gt "$baseline" ]; then
  echo ""
  echo "NEW fixed-width offenders introduced. Either:"
  echo "  (a) wrap with min-w-0 / max-w / use auto-fit-grid, OR"
  echo "  (b) intentionally accept and bump baseline:"
  echo "      tools/check-fixed-widths.sh --update"
  echo ""
  echo "First few offenders:"
  printf '  %s\n' "${offenders[@]:0:10}"
  exit 1
fi

exit 0
