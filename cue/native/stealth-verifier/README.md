# StealthVerifier

Swift CLI tool that asserts `setContentProtection(true)` is working — i.e.
Cue windows ARE NOT visible to `CGWindowListCreateImage` (the public-API
path that Zoom, Meet, OBS, and macOS screenshots use under the hood).

## Build

```bash
./native/stealth-verifier/build.sh
# → cue/resources/native/StealthVerifier
```

Requires Xcode CLI tools (`xcode-select --install`).

## Usage

```bash
# Default 5s sweep, all Cue + alias bundles:
./resources/native/StealthVerifier

# Verbose per-window output:
./resources/native/StealthVerifier --verbose

# Longer sweep:
./resources/native/StealthVerifier --duration 10

# Specific bundle (e.g. Notes-masquerade alias):
./resources/native/StealthVerifier --bundle app.druzya.copilot.alias.notes
```

Exit codes:
- `0` — stealth working (no Cue pixels visible)
- `1` — stealth FAILED (≥10% opaque pixels from a Cue window)
- `2` — error (no Cue windows found, capture failure)

## End-to-end smoke

`cue/scripts/smoke-stealth.sh` orchestrates launch → verify → tear-down.
Run it before every release:

```bash
make cue-build
./cue/scripts/smoke-stealth.sh
```

## What it does NOT cover

`CGWindowListCreateImage` is the public-API path. macOS 12+ also exposes
`ScreenCaptureKit`, which Zoom uses internally. Both honor
`NSWindowSharingNone`, but a regression that ONLY breaks SCK isn't caught
here. To catch that, run the manual stealth matrix below per release.

## Stealth matrix (manual, per release)

Launch Cue, start screen-share via each tool, verify Cue compact +
expanded NOT visible to viewer:

| App | macOS 13 | macOS 14 | macOS 15 | macOS 26 |
|-----|---------|---------|---------|---------|
| Zoom (full-screen share) | | | | |
| Google Meet (Chrome screen-share) | | | | |
| Microsoft Teams | | | | |
| QuickTime Player (screen recording) | | | | |
| OBS Studio | | | | |
| Built-in `⌘⇧3` screenshot | | | | |
| Built-in `⌘⇧4` area screenshot | | | | |
| Built-in `⌘⇧5` recording | | | | |

If any cell fails: file an issue + add entry to
`backend/services/copilot/infra/config.go` `StealthWarnings` so the
client surfaces a banner to affected users.

## Why we don't run this in CI

GitHub-hosted runners headlessly emulate a display via Xvfb-equivalent
shims; their `CGWindowListCreateImage` returns black on every window
regardless of `NSWindowSharingNone`, so we'd get false-pass results.

The Swift compile is still cheap enough that CI could verify it builds.
Actual screen-capture validation = local-only.
