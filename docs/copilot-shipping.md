# Druz9 Copilot — Shipping Checklist (macOS MVP)

Step-by-step from "cloned repo" to "`.dmg` the user can install." Run every
command in this file from the repo root unless otherwise noted.

---

## 0. Prerequisites

- macOS 14+ (Sonoma) on an Apple Silicon or Intel Mac.
- Xcode Command Line Tools:
  ```bash
  xcode-select --install
  ```
- Node.js 20 LTS and npm 10+.
- Go 1.25 (`make gen-*` already installs buf/sqlc into `./bin/`).
- A running Druz9 backend (see `docs/LOCAL-DEV.md`). The desktop client
  defaults to `http://localhost:8080`; override with `DRUZ9_API_BASE_URL`.

> Apple Developer Program ($99/year) is **only** required for notarized
> public releases. Local development and internal test builds work without it.

---

## 1. Generate contracts

```bash
make gen-proto     # Go + TS stubs
make gen-sqlc      # typed DB queries
```

TS stubs land in `frontend/src/api/generated/pb/druz9/v1/`. The desktop
build reads them through the `@generated/*` alias configured in
`desktop/electron.vite.config.ts` and `desktop/tsconfig.node.json`.

---

## 2. Apply the database migration

```bash
make migrate-up
```

This creates `copilot_conversations`, `copilot_messages`, `copilot_quotas`.

---

## 3. Start the backend

```bash
make start
```

Verify copilot endpoints are mounted:

```bash
curl -s http://localhost:8080/api/v1/copilot/desktop-config \
  -H "Authorization: Bearer $(cat .druz9-dev-token)" | jq '.rev, .defaultModelId'
```

Expect: `rev: 1`, `defaultModelId: "openai/gpt-4o-mini"`. Without a JWT
the endpoint returns 401 — use the dev auth helper or log in via the
frontend to mint a token.

---

## 4. Install desktop dependencies

```bash
make desktop-install
```

`keytar` compiles a native module against the Electron ABI. If the build
fails, check that Xcode CLT is current (`xcode-select -p`) and that
`node-gyp` is installed (`npm i -g node-gyp`).

---

## 5. Dev run

```bash
make desktop-dev
```

Expected: a compact floating window appears top-right. Status bar shows
"Нужен вход" until Telegram OAuth completes.

### Smoke-test the happy path

1. Complete onboarding (`⌘⇧D` or from the compact window menu).
2. After login, open any app with real content (VS Code, a GitHub PR).
3. Press `⌘⇧S` — the assistant's answer streams in the expanded window.
4. Follow-up: type a question in the expanded chat; the same conversation
   continues.

### Smoke-test stealth (critical, the product's moat)

1. Start a Zoom / Google Meet / Chrome `getDisplayMedia()` screen-share
   with a second device (phone, browser tab) as viewer.
2. Share the primary display.
3. Trigger `⌘⇧S` — confirm on the **viewer** that:
   - The compact and expanded windows are **not visible**.
   - The rest of the desktop (browser, IDE) is visible as normal.
4. Open Settings (`⌘⇧Q` from compact → ⚙) — confirm it **is** visible to
   the viewer (by design: this screen runs before/after sharing).
5. Toggle the "Stealth при демонстрации экрана" row off in Settings;
   confirm the compact window becomes visible to the viewer immediately
   without restart. Flip it back on.

If stealth breaks on a new OS or browser version, capture:

```
macOS version    : system_profiler SPSoftwareDataType | grep -i "System Version"
Chrome version   : "$(mdfind 'kMDItemCFBundleIdentifier == com.google.Chrome')"/Contents/Info.plist
Electron version : cat desktop/node_modules/electron/package.json | jq -r .version
```

…and add an entry to `backend/services/copilot/infra/config.go`
`StealthWarnings` so the client surfaces the known-bad warning.

---

## 6. Type-check before shipping

```bash
make desktop-typecheck
```

Covers both the renderer (`tsconfig.json`) and the main process
(`tsconfig.node.json`).

---

## 7. Build `.dmg`

```bash
make desktop-build
```

Output: `desktop/dist/Druz9 Copilot-0.1.0-arm64.dmg` (and `-x64.dmg`).

### Signing matrix

| Scenario               | Signing key                          | Entitlements                              |
| ---------------------- | ------------------------------------ | ----------------------------------------- |
| Dev laptop only        | `-` (ad-hoc)                         | default                                   |
| Internal team (TestFlight-style) | Developer ID Application     | `resources/entitlements.mac.plist`        |
| Public release         | Developer ID + notarization           | plist + `extendInfo` in electron-builder.yml |

For internal signed builds, set the identity via env:

```bash
export CSC_LINK=/path/to/DeveloperID.p12
export CSC_KEY_PASSWORD=...
make desktop-build
```

For notarization, add `notarize: { teamId: "XXXXXXXXXX" }` to
`electron-builder.yml` and export `APPLE_ID`, `APPLE_ID_PASSWORD`
(an app-specific password).

---

## 8. Ship

- Host the `.dmg` somewhere users can download (object storage + signed URL).
- Point `DRUZ9_UPDATE_FEED_URL` (or `DesktopConfig.update_feed_url`) at the
  electron-updater feed once the first public build is live.
- Document the initial install: users who see "unidentified developer"
  must right-click the `.app` → Open → Open in the warning dialog.

---

## 9. Post-ship monitoring

- **Stealth regression**: any user-reported case of a viewer seeing the
  compact window → immediately add the browser/OS pair to
  `StealthWarnings` and cut a patch release.
- **Rate of "rate_limited" errors** via the quota state emitted on
  every `Analyze.Done` frame → drives plan-pricing conversations.
- **Auto-update feed health** — electron-updater will log to the main
  process console; pipe those into your observability stack.

---

## 10. Phase 6 parking lot (post-MVP)

In rough priority order:

1. Screenshot area-picker (crop overlay before sending).
2. Voice input (proto message already defined; wire up Whisper or equivalent).
3. History panel as a dedicated screen with delete/rename.
4. Masquerade name + icon swap (enable the `masquerade` flag when OS has
   a reliable Activity Monitor spoof).
5. Auto-update (electron-updater + dedicated update-banner in compact).
6. Paywall modal over compact when quota is exhausted.
7. Windows build.
