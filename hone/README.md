# hone — Desktop Focus Cockpit

Hone is a minimal dark desktop app for programmers in the druz9 ecosystem.
See [../hone-bible.md](../hone-bible.md) for the product spec and
[../ecosystem.md](../ecosystem.md) for how Hone fits with druz9.ru (the
arena) and the stealth copilot (`../desktop/`).

Electron + Vite + React. macOS-first, Windows/Linux parked for v2.

## Status

**Phase 5a — vertical slice landed, v0.0.1.** The design is split into
per-page modules under `src/renderer/src/pages/` and per-widget
components under `components/`, all strictly typed. `App.tsx` is a ~140-
line orchestrator (routing + hotkeys + pomodoro tick). The Stats page is
wired to the real backend over Connect-RPC (`/api/v1/hone/stats`) as the
vertical slice — the other pages stay on mock data until Phase 5b auth
lands.

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
            ├── pages/               per-page modules (Home/Today/Focus/
            │                         Notes/Whiteboard/Stats)
            ├── stores/session.ts    zustand auth store (Phase 5b hydrates)
            ├── styles/globals.css   tokens + primitive classes
            └── vite-env.d.ts        typed window.hone
```

## Relationship to `../desktop/`

- `desktop/` is the **stealth copilot** (Cue). Tray-only, invisible to
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

## Phase 5b next steps

Tracked in [../hone-bible.md §7](../hone-bible.md). Highlights:

1. **Auth via keychain** — mirror `../desktop/` with `keytar` + a one-shot
   browser OAuth hand-off through `druz9://`. Drops `VITE_DRUZ9_DEV_TOKEN`.
2. **Wire Today / Focus / Notes / Whiteboard** to their real endpoints.
   Today is the next highest-value one — `GenerateDailyPlan` produces
   something the mock can't.
3. **Pomodoro persistence** — dock timer currently resets on reload; put
   state in localStorage or bounce through the main process so a quit +
   relaunch inside a session doesn't lose progress.
4. **tldraw for Whiteboard** — replace the static SVG with the real editor.
5. **Global ⌘K** — OS-level hotkey registration so the palette opens even
   when the app isn't focused.

## Stealth boundary (don't drift)

- **No `BrowserWindow.setContentProtection(true)`** — Hone is meant to be
  visible. The stealth trick lives in `../desktop/`.
- **No global hotkeys.** Hone reacts to keyboard only when focused.
- **No tray icon.** Hone is dock-first.

These lines matter because the day someone adds stealth to Hone "just to
help", the product's mental model breaks (see
[../ecosystem.md](../ecosystem.md) §2).
