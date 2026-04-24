#!/usr/bin/env bash
# Build AudioCaptureMac — a ScreenCaptureKit-based system-audio binary
# that Electron main spawns to capture meeting audio.
#
# Output: desktop/resources/native/AudioCaptureMac (universal binary,
# arm64+x86_64). Code-signed ad-hoc for dev; production notarization
# goes through electron-builder's afterSign hook instead.
#
# Usage: ./build.sh
# Deps: swiftc (Xcode CLI tools), macOS 13+ SDK.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$DESKTOP_DIR/resources/native"
OUT_BIN="$OUT_DIR/AudioCaptureMac"

mkdir -p "$OUT_DIR"

# macOS 13 is the floor — ScreenCaptureKit audio capture (capturesAudio)
# landed there. We pass -target to lock the deployment version so devs
# on macOS 26 can't accidentally use newer symbols that break on
# customer 13.x laptops.
DEPLOYMENT_TARGET=13.0

# Build universal binary. arm64 is native on Apple Silicon; x86_64 path
# keeps us working on the still-supported Intel fleet (some users on
# old MBPs). Linking both into one file avoids a second binary + launch
# wrapper.
echo "→ compiling AudioCaptureMac (universal arm64+x86_64)…"
swiftc \
  -O \
  -parse-as-library \
  -target arm64-apple-macos$DEPLOYMENT_TARGET \
  -o "$OUT_BIN.arm64" \
  "$SCRIPT_DIR/AudioCapture.swift"

swiftc \
  -O \
  -parse-as-library \
  -target x86_64-apple-macos$DEPLOYMENT_TARGET \
  -o "$OUT_BIN.x86_64" \
  "$SCRIPT_DIR/AudioCapture.swift"

lipo -create -output "$OUT_BIN" "$OUT_BIN.arm64" "$OUT_BIN.x86_64"
rm "$OUT_BIN.arm64" "$OUT_BIN.x86_64"

# Ad-hoc sign so TCC doesn't instantly reject a binary with no signature.
# Production replaces this with --sign "$APPLE_DEVELOPER_ID" via
# electron-builder's afterSign script.
echo "→ ad-hoc code signing…"
codesign --force --sign - --timestamp=none "$OUT_BIN"

echo "✓ built $OUT_BIN"
file "$OUT_BIN"
