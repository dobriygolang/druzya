#!/usr/bin/env bash
# Build CursorHelper — a tiny CGAssociateMouseAndMouseCursorPosition
# wrapper that Electron main spawns to freeze/thaw the macOS system
# cursor. Без него «virtual cursor inside area-overlay» работает, но
# viewer'ы видят как реальный системный курсор бегает по экрану.
#
# Output: desktop/resources/native/CursorHelper (universal binary).
# Usage: ./build.sh
# Deps: swiftc (Xcode CLI tools), macOS 13+ SDK.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$DESKTOP_DIR/resources/native"
OUT_BIN="$OUT_DIR/CursorHelper"
SRC="$SCRIPT_DIR/Sources/CursorHelper/main.swift"

mkdir -p "$OUT_DIR"

DEPLOYMENT_TARGET=13.0

echo "→ compiling CursorHelper (universal arm64+x86_64)…"
swiftc \
  -O \
  -target arm64-apple-macos$DEPLOYMENT_TARGET \
  -o "$OUT_BIN.arm64" \
  "$SRC"

swiftc \
  -O \
  -target x86_64-apple-macos$DEPLOYMENT_TARGET \
  -o "$OUT_BIN.x86_64" \
  "$SRC"

lipo -create -output "$OUT_BIN" "$OUT_BIN.arm64" "$OUT_BIN.x86_64"
rm "$OUT_BIN.arm64" "$OUT_BIN.x86_64"

echo "→ ad-hoc code signing…"
codesign --force --sign - --timestamp=none "$OUT_BIN"

echo "✓ built $OUT_BIN"
file "$OUT_BIN"
