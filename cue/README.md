# Druz9 Copilot — Desktop

Stealthy AI assistant. macOS-first (Phase 1 ships Mac only).

## Prerequisites

- Node.js 20+
- Xcode Command Line Tools (`xcode-select --install`) — required for
  code-signing and `keytar` native module.
- Apple Developer Program membership ($99/year) — only needed when you're
  ready to ship notarized `.dmg` builds. Dev runs work without it.

## Setup

```bash
cd cue
npm install
```

Regenerate TS proto stubs (emits into `../frontend/src/api/generated`,
consumed here via the `@generated/*` alias):

```bash
# from repo root
make gen-proto
```

## Run

```bash
# backend (repo root)
make dev

# desktop (this directory)
npm run dev
```

Environment:

| Variable              | Default (dev)           | Purpose                               |
| --------------------- | ----------------------- | ------------------------------------- |
| `DRUZ9_API_BASE_URL`  | `http://localhost:8080` | Backend Connect-RPC host              |
| `DRUZ9_UPDATE_FEED_URL` | empty                 | electron-updater feed; empty disables |

## Build `.app` / `.dmg`

```bash
npm run build:mac
```

Output in `dist/`. Without a Developer ID certificate configured in
`electron-builder.yml`, the `.dmg` is dev-signed only and users will need
to right-click → Open on first launch.

## Layout

```
src/
├── main/          Electron main process (Node)
│   ├── api/       Connect-RPC client + auth interceptor
│   ├── auth/      Keychain, deep-link handler (druz9://)
│   ├── capture/   Screenshot helpers (desktopCapturer)
│   ├── config/    Runtime config loader
│   ├── hotkeys/   Global shortcut registry
│   ├── ipc/       Typed invoke handlers + streaming bridge
│   ├── permissions/ macOS permission probes
│   └── windows/   Window manager + stealth wiring
├── preload/       contextBridge → window.druz9 typed API
├── renderer/      React + Vite (one HTML, hash-routed per window)
│   ├── screens/   compact / expanded / settings / onboarding
│   ├── hooks/     useConfig, useHotkeyEvents, …
│   ├── stores/    zustand (Phase 4)
│   └── styles/    tokens.css + globals
└── shared/        types.ts + ipc.ts (shared main+renderer)
```

## Masquerade builds

Runtime `masquerade.applyPreset()` swaps the Dock + tray icons + window
titles, but **macOS reads the process name in Activity Monitor and
Cmd+Tab from the signed `.app` bundle's `Info.plist`** — that field is
baked at build time and JS cannot rewrite it for a running process.

To give an observer "Notes" / "Telegram" / "Slack" / "Xcode" in Activity
Monitor we ship a separate signed `.app` per alias. The user installs
whichever bundle matches their preferred disguise; runtime UI still
swaps the same as before.

```bash
# Builds all four alias bundles (Notes, Telegram, Slack, Xcode).
# Requires Apple signing env (CSC_LINK + CSC_KEY_PASSWORD) for a
# notarisable .dmg — without them the result is unsigned and Gatekeeper
# will block on a fresh machine.
npm run build:masquerade:all

# Or one at a time:
npm run build:masquerade:notes
npm run build:masquerade:telegram
npm run build:masquerade:slack
npm run build:masquerade:xcode
```

Outputs land in `dist/mac-{notes,telegram,slack,xcode}/`. Each bundle:

- has `CFBundleName` / `CFBundleDisplayName` / `CFBundleExecutable` set
  to the alias (rewritten by `scripts/afterPack-masquerade.cjs`),
- has `LSUIElement=true` so it does **not** surface a tile in Cmd+Tab /
  Mission Control / Dock — only the menu-bar tray remains (critical:
  otherwise the observer sees "two Notes" running),
- drops the `druz9-cue://` URL scheme so only the real Cue bundle owns
  deeplink routing.

Icons live in `resources/masquerade/*.icns`. If a file is missing the
build still succeeds with the default Cue icon and prints a warning —
see `resources/masquerade/README.md` for the `iconutil` recipe to
generate `.icns` from a 1024×1024 source PNG.

## Stealth testing

Once running, open Zoom / Meet / Chrome's `getDisplayMedia` demo, start
screen-sharing, and verify:

- The **compact** and **expanded** windows are **invisible** to the viewer.
- The **settings** and **onboarding** windows **are** visible (by design).
- Toggling "Stealth" in Settings flips the compact window visibility in
  real time without restart.

If a browser update starts rendering our window to viewers, file an
update to `DesktopConfig.StealthWarnings` on the backend so the client
displays a known-bad warning.

## Status

Production beta on macOS (arm64 + x64). Notarized DMG, electron-updater,
Sentry. Native Swift binary (`AudioCaptureMac`) under ScreenCaptureKit
for system-audio capture. Real components shipped: compact / expanded /
picker / settings / area-overlay / english-polish screens.

Windows native module (WASAPI) parked for Q3 2026.
