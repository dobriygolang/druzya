# hone — Desktop Focus Cockpit

Hone — focus cockpit для разраба. AI-плана, фокус-режимы (Pomodoro /
Stopwatch / Free / Plan / Pinned / Countdown), заметки с AI-link,
TaskBoard с auto-categorise. **NO learning content** — учебный layer
(English / Atlas / Codex) живёт в web `druz9.online`.

See [../docs/for_investment/hone.md](../docs/for_investment/hone.md) for the product spec and
[../docs/for_investment/ecosystem.md](../docs/for_investment/ecosystem.md) for how Hone fits with druz9.online (web AI-coach + AI-mock + atlas + Lingua)
and the stealth copilot Cue (`../cue/`).

Electron + Vite + React. macOS-first, Windows/Linux parked for v2.

## Status

Production beta on macOS (arm64 + x64) with notarized DMG, electron-updater,
Sentry. Pages под `src/renderer/src/pages/`: Home (subtle persistent timer),
Today (AI-план + reflection), Notes (Vault 🔒 + AI backlinks), Coach (read-only
past briefs feed + Goal chip), TaskBoard (archive drawer + drag-ghost + inline
edit + auto-categorise), Stats, Settings, Calendar, TutorAssignments,
MemoryTimeline. Все wired via Connect-RPC поверх `@generated/*` aliased
TS stubs.

Editor, SharedBoards, Podcasts мигрированы в web (Stream F W/E + D5 podcasts
delete, 2026-05-12). Phase K Wave 8 (2026-05-13) — English hub
(EnglishOverview / Reading / Writing / Listening / Speaking) переехал в
web `druz9.online/lingua` с PWA-offline vocab review; existing users
получают one-time LinguaMigrationModal с deep-link через `shell.openExternal`.
Hone теперь pure focus-cockpit — никакого learning UI.

Wave J дополнил: ConnectionPanel в Today (Cue session notifications),
F2 GoalEditModal mirror, OfflineBanner 5-state, ConflictModal для outbox 409
conflicts.

## Run

```bash
cd hone
npm install
npm run dev
```

First run takes ~60s to compile the renderer bundle. Subsequent runs are
near-instant via Vite HMR. The window boots with hash-route-style state
owned by React — no router, no deep-links yet.

## Build

```bash
npm run build              # just bundle main/preload/renderer into out/
npm run build:mac          # signed DMG (requires Apple Developer id)
npm run build:mac-dev      # unsigned .app, dev signing only
```

## Layout

```
hone/
├── electron.vite.config.ts      shared main/preload/renderer config
├── electron-builder.yml         packaging (macOS dmg + druz9:// scheme)
├── resources/                   app icon, OG, build assets
└── src/
    ├── main/index.ts            Electron main-process (single window)
    ├── preload/index.ts         contextBridge → window.hone typed API
    ├── shared/ipc.ts            types shared between main and renderer
    └── renderer/
        ├── index.html
        └── src/
            ├── App.tsx          orchestrator (routing + hotkeys + pomodoro)
            ├── main.tsx         createRoot mount
            ├── api/             Connect-RPC transport + typed wrappers
            │   ├── config.ts        API/WEB base (hardcoded prod) + dev-token hatch
            │   ├── transport.ts     singleton Connect transport + auth
            │   └── hone.ts          typed wrappers (getStats, …)
            ├── components/
            │   ├── CanvasBg.tsx     meditative backdrop (3 modes)
            │   ├── Chrome.tsx       Wordmark + Versionmark
            │   ├── Copilot.tsx      mock stealth overlay (promo only)
            │   ├── Dock.tsx         persistent timer pill
            │   ├── Palette.tsx      ⌘K command surface
            │   ├── primitives/      Icon, Kbd
            │   └── stats/           Card, Label, Heatmap, Sparkline, Bars
            ├── pages/               per-page modules (Home, Today, Notes,
            │                         Coach, TaskBoard, Stats, Settings,
            │                         Calendar, TutorAssignments, MemoryTimeline).
            │                         DELETED 2026-05-12: Editor.tsx,
            │                         SharedBoards.tsx, Podcasts.tsx — peer-
            │                         collab + podcasts мигрированы в web.
            │                         DELETED 2026-05-13 (Wave 8): EnglishOverview /
            │                         Reading / Writing / Listening / Speaking —
            │                         English vertical переехал в web /lingua.
            ├── stores/session.ts    zustand auth store (Phase 5b hydrates)
            ├── styles/globals.css   tokens + primitive classes
            └── vite-env.d.ts        typed window.hone
```

## Relationship to `../cue/`

- `cue/` is the **stealth copilot** (Cue). Tray-only, invisible to
  screen share, ⌘⇧Space hotkey. Different product, different UX, same
  monorepo for codegen reuse.
- `hone/` is this app: the quiet focus cockpit, with a normal dock icon
  and a visible main window. No stealth tricks.
- Both share the `druz9://` URL scheme. macOS routes to the
  most-recently-registered handler; that's fine for MVP.
- Connect-RPC TS stubs are emitted into `../frontend/src/api/generated/`
  by `make gen-proto` and aliased here as `@generated/*`.

## Запуск

Адреса прода захардкожены в `src/renderer/src/api/config.ts`:
- API: `https://api.druz9.ru`
- Web: `https://druz9.ru` (для OAuth redirect'а)

```bash
cd hone
npm install
npm run dev
```

Откроется Electron окно → LoginScreen → «Sign in with druz9» открывает
браузер на `/login?desktop=druz9://auth` → после Yandex/Telegram login'а
web редиректит на `druz9://auth?token=...` → hone ловит и шифрует в
keychain (safeStorage). Следующий запуск — session автоматически.

### Dev-token hatch

Если нужно задебажить конкретный сценарий без OAuth-flow, можно подсунуть
токен напрямую:

```bash
export VITE_DRUZ9_DEV_TOKEN=eyJ…       # access_token из druz9.ru
npm run dev
```

Токен читает `transport.ts` поверх keychain-сессии (override). Для
production-билдов не экспортируется.

## Stealth boundary (don't drift)

- **No `BrowserWindow.setContentProtection(true)`** — Hone is meant to be
  visible. The stealth trick lives in `../cue/` (Cue).
- **No global hotkeys.** Hone reacts to keyboard only when focused.
- **No tray icon.** Hone is dock-first.

These lines matter because the day someone adds stealth to Hone "just to
help", the product's mental model breaks (see
[../docs/for_investment/ecosystem.md](../docs/for_investment/ecosystem.md) §«Правило несаморазмывания»).
