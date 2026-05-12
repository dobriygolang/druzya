#!/usr/bin/env bash
# Build StealthVerifier — Swift CLI tool that captures a snapshot of a
# running Cue window via CGWindowListCreateImage and reports whether
# setContentProtection is working (returns clear/black pixels) or not.
#
# Output: cue/resources/native/StealthVerifier (arm64-only — Cue ships
# arm64 + x64 DMGs, but the verifier is a local-dev / smoke-test tool
# that runs on the developer's M-series Mac. If we ever build it for
# Intel CI runners, add the lipo step from CursorHelper/build.sh.).
#
# Usage: ./build.sh
# Deps: swiftc (Xcode CLI tools), macOS 13+ SDK.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="$CUE_DIR/resources/native"
OUT_BIN="$OUT_DIR/StealthVerifier"
SRC="$SCRIPT_DIR/main.swift"

mkdir -p "$OUT_DIR"

DEPLOYMENT_TARGET=13.0

# Detect arch — Apple Silicon by default, Intel if Rosetta'd.
ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  TARGET="arm64-apple-macos$DEPLOYMENT_TARGET" ;;
  x86_64) TARGET="x86_64-apple-macos$DEPLOYMENT_TARGET" ;;
  *)
    echo "unsupported arch: $ARCH" >&2
    exit 1
    ;;
esac

echo "→ compiling StealthVerifier ($TARGET)..."
swiftc \
  -O \
  -target "$TARGET" \
  -o "$OUT_BIN" \
  "$SRC"

echo "→ ad-hoc code signing..."
codesign --force --sign - --timestamp=none "$OUT_BIN"

echo "✓ built $OUT_BIN"
file "$OUT_BIN"
