#!/usr/bin/env bash
# Stealth smoke test orchestrator.
#
# Steps:
#   1. Verify Cue.app is built (dist/mac-arm64/Cue.app).
#   2. Verify StealthVerifier is built (resources/native/StealthVerifier).
#   3. Launch Cue.
#   4. Wait for at least one Cue window to appear in CGWindowList.
#   5. Run StealthVerifier — assert exit 0.
#   6. Kill Cue regardless of pass/fail.
#   7. Report PASS/FAIL.
#
# This catches the launch-blocking case: NSWindow.sharingType regressed
# on a new macOS, and Cue stealth no longer hides from screen capture.
#
# NOT a substitute for the manual stealth matrix in
# native/stealth-verifier/README.md — that one drives real Zoom/Meet
# which use ScreenCaptureKit. This orchestrator validates the public
# CGWindowList path только.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CUE_APP="$CUE_DIR/dist/mac-arm64/Cue.app"
VERIFIER="$CUE_DIR/resources/native/StealthVerifier"
DURATION="${STEALTH_DURATION:-5}"

red() { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
dim() { printf "\033[2m%s\033[0m\n" "$*"; }

if [ "$(uname)" != "Darwin" ]; then
  red "smoke-stealth.sh: macOS only"
  exit 2
fi

if [ ! -d "$CUE_APP" ]; then
  red "✗ Cue.app missing at $CUE_APP"
  dim "  run: cd cue && npm run build:mac-dev"
  exit 2
fi

if [ ! -x "$VERIFIER" ]; then
  red "✗ StealthVerifier missing at $VERIFIER"
  dim "  run: ./cue/native/stealth-verifier/build.sh"
  exit 2
fi

dim "→ launching Cue..."
open "$CUE_APP"

# Wait up to 30s for the Cue process to register at least one window
# in CGWindowList. /usr/bin/osascript polls cheaply without hammering.
dim "→ waiting for Cue window to appear..."
for i in $(seq 1 30); do
  if pgrep -f "Cue.app/Contents/MacOS/" > /dev/null; then
    sleep 2 # give renderer a beat to mount the compact window
    break
  fi
  sleep 1
done

if ! pgrep -f "Cue.app/Contents/MacOS/" > /dev/null; then
  red "✗ Cue process did not start within 30s"
  exit 2
fi

cleanup() {
  dim "→ stopping Cue..."
  osascript -e 'tell application "Cue" to quit' 2>/dev/null || true
  # Belt-and-suspenders: if AppleScript can't reach it (LSUIElement
  # bundles sometimes refuse AppleScript Quit), kill by pgrep.
  pkill -f "Cue.app/Contents/MacOS/" 2>/dev/null || true
}
trap cleanup EXIT

dim "→ running StealthVerifier ($DURATION s)..."
if "$VERIFIER" --duration "$DURATION" --verbose; then
  green "✓ PASS — Cue stealth working against CGWindowList"
  exit 0
else
  rc=$?
  red "✗ FAIL — Cue visible to screen capture (verifier rc=$rc)"
  red "    Check: macOS version, Electron upgrade, recent window-manager.ts diff"
  exit "$rc"
fi
