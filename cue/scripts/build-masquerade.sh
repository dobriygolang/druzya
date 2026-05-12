#!/usr/bin/env bash
#
# Orchestrator for CI3 masquerade builds. Produces four separate signed
# .app bundles (Notes / Telegram / Slack / Xcode) — each one a fully
# disguised copy of Cue with rewritten CFBundleName + CFBundleExecutable
# so macOS reports them under the alias name in Activity Monitor.
#
# Requires Apple signing env vars when running with a Developer ID:
#   CSC_LINK             path-to-.p12 or base64 cert
#   CSC_KEY_PASSWORD     .p12 password
#   APPLE_ID             notarisation account (optional)
#   APPLE_APP_SPECIFIC_PASSWORD
#
# Without these, electron-builder produces unsigned .app + .dmg — fine
# for local smoke-test but Gatekeeper will block on a fresh machine.
#
# Outputs land in dist/mac-{notes,telegram,slack,xcode}/.

set -euo pipefail

cd "$(dirname "$0")/.."

PRESETS=("notes" "telegram" "slack" "xcode")

# Allow --only <preset> to build just one (handy when iterating on
# afterPack-masquerade.cjs without burning 4× build time).
if [[ "${1:-}" == "--only" ]]; then
  if [[ -z "${2:-}" ]]; then
    echo "usage: build-masquerade.sh [--only <preset>]" >&2
    exit 2
  fi
  PRESETS=("$2")
fi

# Sanity-check icons exist; warn but don't abort — electron-builder will
# fall back to the default icon and the build still produces a usable
# bundle for testing.
for preset in "${PRESETS[@]}"; do
  icon_path="resources/masquerade/${preset}.icns"
  if [[ ! -f "${icon_path}" ]]; then
    echo "warn: ${icon_path} missing — bundle will use default Cue icon" >&2
  fi
done

# Run the renderer/main build ONCE — the same out/ tree is reused across
# all four masquerade builds since the JS payload is identical, only
# Info.plist + icon + executable name differ.
echo "==> building renderer + main (electron-vite)"
npx electron-vite build

for preset in "${PRESETS[@]}"; do
  echo ""
  echo "==> building masquerade bundle: ${preset}"
  # --prepackaged-skip avoids re-running electron-vite (we did it above).
  # We pass the per-preset config; electron-builder reads `extends:` to
  # pull in the base electron-builder.yml.
  npx electron-builder \
    --mac \
    --config "electron-builder.${preset}.yml" \
    --publish never
done

echo ""
echo "All masquerade builds complete."
echo "Output: dist/mac-{notes,telegram,slack,xcode}/"
echo ""
echo "Install one .dmg per identity you want. Each bundle shows up in"
echo "Activity Monitor under its own CFBundleName (Notes / Telegram /"
echo "Slack / Xcode) — runtime dock/tray icon swap is unchanged."
