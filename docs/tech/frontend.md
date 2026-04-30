# Фронтенды

Три клиента — web, Hone Electron, Cue Electron — все React 18 + TypeScript + Vite.

## Web — `frontend/`

Десктопная SPA, продакшн на `druz9.online`.

```
frontend/
├── package.json              React 18 + Vite + Connect-ES + MSW + Tailwind/CSS
├── vite.config.ts
├── src/
│   ├── api/
│   │   ├── apiClient.ts      Connect transport + auth interceptor
│   │   └── generated/        Generated через `make gen-ts` — НЕ редактировать
│   ├── pages/                ~60 страниц (Arena, Mock, Atlas, Insights, Codex, ...)
│   ├── components/           Reusable
│   ├── hooks/                useQuery wrappers, кастомные хуки
│   ├── lib/                  Utility, datetime, constants
│   └── mocks/                MSW handlers — мокают backend в development
└── public/
```

**Транспорт:** `@connectrpc/connect-web` через `fetch`. Без envoy / API gateway. Все клиенты типизированы через `frontend/src/api/generated/pb/druz9/v1/*_connect.ts`.

**Состояние:** zustand для глобального стейта (auth, user), `@tanstack/react-query` для server-state.

**Стили:** Tailwind + custom CSS variables. После ADR-001 Phase-4 веб переведён в Hone-эстетику (чистый чёрный, hairlines, единственный акцент `#FF3B30`).

**MSW моки:** включены по умолчанию в development, дают возможность работать без backend. Отключить — `VITE_MSW=off`.

**Запуск:**

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173 с MSW
```

**Билд:** `npm run build` → static в `dist/`. Деплой через CI (см [deployment.md](./deployment.md)).

## Hone — `hone/`

Electron + Vite + React. macOS-first (arm64 + x64), Windows запланирован Q3 2026.

```
hone/
├── package.json              Electron 41 + electron-vite + react 18 + connect-rpc
├── electron.vite.config.ts   main / preload / renderer + @generated алиас
├── electron-builder.yml      DMG + druz9:// scheme
├── src/
│   ├── main/
│   │   ├── index.ts          Одно окно, druz9:// deep-link forwarder, Sentry init
│   │   └── ...               Updater, IPC handlers, OAuth flow
│   ├── preload/index.ts      contextBridge → window.hone
│   ├── shared/ipc.ts         HoneAPI типы
│   └── renderer/
│       ├── index.html        CSP whitelist: api.druzya.tech + localhost:8080
│       └── src/
│           ├── App.tsx       ~140 строк оркестратора (routing + hotkeys + pomodoro)
│           ├── api/          Connect-RPC layer
│           │   ├── config.ts   VITE_DRUZ9_API_BASE + dev-token
│           │   ├── transport.ts singleton + auth interceptor
│           │   └── *.ts      Per-service typed wrappers
│           ├── components/   CanvasBg, Chrome, Dock, Palette, Copilot, ...
│           ├── pages/        Home, Today, Focus, Notes, Whiteboard, Stats,
│           │                 Podcasts, Editor, BoardsHub, SharedBoards,
│           │                 Events, Coach (read-only past briefs feed),
│           │                 Reading (R), Writing (W), Listening (L),
│           │                 CodeReview (G), TutorAssignments (A),
│           │                 Calendar (M)
│           ├── stores/       zustand (session, focus, ...)
│           └── styles/globals.css
└── resources/                Icons, splash images
```

**Принципы:**

- **Не делает stealth.** Никаких `setContentProtection`, никаких global hotkeys. Только in-focus letter-shortcuts: `T` Today, `N` Notes, `B` Boards, `C` Code editor, `E` Events, `S` Stats, `P` Podcasts, `R` Reading, `W` Writing, `L` Listening, `A` Assignments (от тутора), `M` Calendar (тутор-сессии), `G` Code review, `,` Settings. ⌘K — palette, ⌘S — sidebar toggle. На канвасных страницах (boards/editor) plain-letter shortcuts отключены, только палитра.
- **Без `keytar`.** Токены через Electron `safeStorage` (без native build).
- **Auth через Telegram code flow** в main-process (без drush9:// browser dance).
- **strict TypeScript.** `@ts-nocheck` запрещён.

**Запуск:**

```bash
cd hone
export VITE_DRUZ9_API_BASE=http://localhost:8080
npm install
npm run dev          # запускает electron-vite dev
npm run typecheck    # tsc --noEmit
npm run build        # build для notarize
```

**Релиз:** GitHub Action `.github/workflows/hone-release.yml` собирает DMG + electron-updater feed. См [deployment.md](./deployment.md#hone-cue-релизы).

## Cue — `desktop/`

Electron + tray-only + native Swift binary для macOS системного аудио.

```
desktop/
├── package.json              "productName": "Cue"
├── native/
│   └── audio-mac/
│       ├── AudioCapture.swift   ScreenCaptureKit → PCM16 + VAD + BOUNDARY
│       └── build.sh             swiftc universal arm64+x86_64
├── src/
│   ├── main/
│   │   ├── capture/
│   │   │   ├── audio-mac.ts        spawn Swift binary, chunk + WAV wrap
│   │   │   └── screenshot.ts       desktopCapturer area / full
│   │   ├── coach/trigger-policy.ts rolling 60s transcript + question detect
│   │   ├── api/                    REST clients
│   │   ├── ipc/                    zod-validated IPC schemas
│   │   ├── windows/window-manager.ts  setContentProtection, always-on-top
│   │   └── masquerade.ts           Runtime swap dock icon / titles
│   ├── preload/
│   └── renderer/
│       ├── screens/
│       │   ├── compact/    460×92 полоска (модель, persona, ввод)
│       │   ├── expanded/   Чат + transcript + auto-suggest pill
│       │   ├── picker/     Floating persona/model picker
│       │   ├── settings/   Документы (RAG attach)
│       │   ├── area-overlay/  Screenshot area-selector
│       │   ├── toast/      Floating error/info
│       │   └── english-polish/ Wave 6.2 — ⌃⇧L: clipboard → AI feedback
│       └── stores/         audio-capture, coach, session, conversation, persona, documents
```

**Принципы:**

- **Tray-only.** Нет dock-иконки. UX: «вызвал → ответил → исчез».
- **Stealth при screen-share.** `setContentProtection(true)` → `NSWindowSharingNone` на macOS, `WDA_EXCLUDEFROMCAPTURE` на Win (Electron 30+).
- **Mock-block protocol.** `copilot.CheckBlock` RPC + serverside enforcement в `Answer` (см [architecture.md](./architecture.md)).
- **Native audio macOS.** ScreenCaptureKit → PCM16 → VAD → batch chunks → Whisper Turbo.
- **IPC zod-валидирован.** `main/ipc/schemas.ts` — 15+ каналов с runtime-валидацией renderer-input.

**Запуск:**

```bash
cd desktop
npm install
# Соберём Swift binary (один раз, нужен Xcode CLI):
./native/audio-mac/build.sh
npm run dev
```

**Релиз:** аналогичен Hone, отдельный CI workflow + отдельный update-feed.

## Codegen контракта

Один раз для всех трёх клиентов:

```bash
make gen-proto   # buf generate в backend и в frontend/src/api/generated
make gen-ts      # отдельная цель для TS
make gen-check   # CI drift check
```

Hone и Cue **алиасят** `frontend/src/api/generated/` через `@generated/*` в их `tsconfig.json` — не дублируют codegen.

## Принципы для всех трёх клиентов

- **`@ts-nocheck` запрещён.** Strict TypeScript везде.
- **Generated файлы коммитятся.** CI ловит drift.
- **Никакого `any`** без явного `eslint-disable-next-line` с обоснованием в комментарии.
- **Auth — один токен** (keychain в Electron, localStorage в web).
- **Состояние локально → server.** Optimistic updates через TanStack Query.
- **CSS — utility-first** (Tailwind в web, custom variables в Hone/Cue).
- **Иконки** — Lucide React или кастомные SVG. Нет иконочных шрифтов.

## Tooling

| Инструмент | Web | Hone | Cue |
|---|---|---|---|
| Bundler | Vite | electron-vite | electron-vite |
| Test | Vitest + RTL | (нет — vibe-tested) | (нет) |
| Lint | ESLint + tsc | ESLint + tsc | ESLint + tsc |
| Style | Tailwind + CSS vars | CSS vars + globals.css | CSS vars |
| State | zustand + react-query | zustand | zustand |

## Куда смотреть, если

- **Добавить страницу в frontend/** или Hone → [.ai/skills/frontend-page.md](../../.ai/skills/frontend-page.md)
- **Подключить новый RPC к клиенту** → [.ai/skills/add-rpc.md](../../.ai/skills/add-rpc.md)
- **Релиз Hone/Cue (notarize, sign, update-feed)** → [.ai/skills/electron-app.md](../../.ai/skills/electron-app.md)
