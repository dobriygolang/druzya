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
cd desktop
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

## What's NOT in Phase 3

UI screens are placeholder components (`Phase 4 placeholder`). The
scaffold proves:

- Electron boots the compact window with stealth enabled.
- Global hotkeys fire and push IPC events to the renderer.
- Connect-RPC client talks to the monolith with a keychain-backed
  Bearer token.
- Streaming Analyze/Chat is translated into IPC events per frame.

Phase 4 fills in the real components against the Claude design output.
