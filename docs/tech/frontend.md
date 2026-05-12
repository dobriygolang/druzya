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
│   ├── pages/                ~70 страниц (Today, Mock pipeline, Atlas, Insights, Codex, Memory, Podcasts, Whiteboard, Editor, ...)
│   ├── components/           Reusable + new: ErrorBoundary, DataLoader, ConflictModal (Hone), ProGate, TierBadge, GoogleCalendarSection
│   ├── hooks/                useQuery wrappers, кастомные хуки
│   ├── lib/                  Utility, datetime, constants + new: goal, activity, readiness, miniMock, cueSessions, diagnostic, dailyPlan, insights, milestones, atlasCoverage, onboardingFlag, dataExport, codexHelpers, useReadiness
│   └── mocks/                MSW handlers — мокают backend в development
└── public/
```

**2026-05-12 marathon — новые surfaces:**
- `/today` (enriched: Streak/Milestones/Trajectory/WeeklySnapshot/ActivityFeed/CueSessions/DailyPlan/Readiness/Insights/Hero)
- `/podcasts`, `/profile/memory`, `/profile/settings`, `/whiteboard/:id`, `/editor/:id`, `/mock/diagnostic`
- `/auth/google-calendar-callback`
- Mock pipeline stages: AlgoStage / CodingStage / SysDesignStage / BehavioralStage (voice MediaRecorder)
- Admin: ObservabilityDashboard (D9), CompanyManagerPage (R7), GoalPresetsPanel (Phase 2)

**CI1 pattern:** Все backend-driven сurfaces wrapped в `<ErrorBoundary section="X"><DataLoader state={query} skeleton={...} empty={...} emptyContent={...}>{(data) => <Real />}</DataLoader></ErrorBoundary>`. 9 surfaces migrated 2026-05-12 (AITutorChatPage / ProfilePage / InsightsPage / CodexPage / AtlasPage / AtlasExplorePage / MockSessionPage / WeeklyReportPage / NotificationsPage). Mock pipeline stages кастомно handle inline state.

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
│           ├── components/   CanvasBg, Chrome, Dock, Palette, Copilot,
│           │                 ConflictModal (CI4), OfflineBanner (5-state),
│           │                 GoalEditModal (F2 mirror)
│           ├── pages/        Home (subtle persistent timer R10), Today,
│           │                 Notes (Vault 🔒 icon, AI backlinks R5),
│           │                 TaskBoard (archive drawer R4 + drag-ghost +
│           │                 inline-edit titles + auto-categorise), Stats,
│           │                 Coach (read-only past briefs feed + Goal chip),
│           │                 MemoryTimeline (memory audit surface),
│           │                 EnglishOverview + Reading (R) / Writing (W) /
│           │                 Listening (L) / Speaking (Wave J — MicRecorder
│           │                 + AudioPlayer), TutorAssignments (A),
│           │                 Calendar (M), Settings (,).
│           │                 15 pages total. DELETED 2026-05-12:
│           │                 SharedBoards.tsx, Editor.tsx (→ web /whiteboard
│           │                 /editor solo), Podcasts.tsx (→ web /podcasts).
│           ├── stores/       zustand (session, focus, goal F2 mirror, ...)
│           └── styles/globals.css
└── resources/                Icons, splash images
```

**Принципы:**

- **Не делает stealth.** Никаких `setContentProtection`, никаких global hotkeys. In-focus letter-shortcuts: `T` Today, `N` Notes, `S` Stats, `R` Reading, `W` Writing, `L` Listening, `K` Speaking, `A` Assignments, `M` Calendar, `,` Settings. ⌘K — palette (+ Recent section since 2026-05-12). **`B`/`E`/`P`/`G` releases:** Whiteboard/Editor/Podcasts/CodeReview мигрировали в web; `B`/`E` теперь open browser tab к web pages; `P` released (no Hone podcasts surface); `G` released (CodeReview merged в TutorAssignments).
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

## Cue — `cue/`

Electron + tray-only + native Swift binary для macOS системного аудио.

```
cue/
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
│   │   │   └── intelligence.ts     F10 (2026-05-12) — session.end ingest
│   │   │                           → POST /intelligence/interview-sessions/ingest
│   │   ├── ipc/                    zod-validated IPC schemas
│   │   ├── windows/window-manager.ts  setContentProtection, always-on-top
│   │   └── masquerade.ts           Runtime swap dock + tray icon
│   │                               (CI3 2026-05-12: tray.registerTray() syncs)
│   ├── preload/
│   └── renderer/
│       ├── screens/
│       │   ├── compact/    460×92 полоска (модель, persona, ввод)
│       │   ├── expanded/   Чат + transcript + auto-suggest pill + C4
│       │   │               diarization SpeakerLabel chips bar
│       │   ├── picker/     Floating persona/model picker
│       │   ├── settings/   Документы (RAG attach) + language picker
│       │   ├── area-overlay/  Screenshot area-selector
│       │   ├── toast/      Floating error/info
│       │   ├── english-polish/ Wave 6.2 — ⌃⇧L: clipboard → AI feedback
│       │   ├── onboarding/ Wave J — Welcome / Permissions /
│       │   │               InvisibleDemo / Complete (first-launch wizard)
│       │   ├── interview-prep/ Wave J — UploadCV / UploadJD / Review /
│       │   │               Launch (CV+JD prep before interview, mig 00108)
│       │   ├── history/    Past sessions list
│       │   ├── summary/    Per-session debrief
│       │   └── tray-popup/ Quick actions menu
│       └── stores/         audio-capture, coach, session, conversation, persona, documents
```

**Принципы:**

- **Tray-only.** Нет dock-иконки. UX: «вызвал → ответил → исчез».
- **Stealth при screen-share.** `setContentProtection(true)` → `NSWindowSharingNone` на macOS, `WDA_EXCLUDEFROMCAPTURE` на Win (Electron 30+). Stealth-verifier probe (DesktopConfig.StealthWarnings) warns при known-bad browser builds.
- **Runtime masquerade + process masquerade builds shipped.** `applyPreset()` swap'ит dock + tray icon + window titles runtime (Notes/Telegram/Xcode/Slack presets). Plus `.github/workflows/cue-masquerade-release.yml` + `cue-masquerade-validate.yml` собирают 4 alias-bundles с per-alias `Info.plist` rewrite (CFBundleName/Executable + LSUIElement=true) через `scripts/afterPack-masquerade.cjs`. `npm run build:masquerade:all` локально.
- **Mock-block protocol.** `copilot.CheckBlock` RPC + serverside enforcement в `Answer` (см [architecture.md](./architecture.md)).
- **Native audio macOS.** ScreenCaptureKit → PCM16 → VAD → batch chunks → Whisper Turbo.
- **C4 diarization.** Per-session manual relabel chips (SpeakerLabel.tsx) когда diarizer нашёл ≥2 distinct speakers. UI bar в ExpandedScreen.
- **IPC zod-валидирован.** `main/ipc/schemas.ts` — 15+ каналов с runtime-валидацией renderer-input.
- **F10 cross-product moat (2026-05-12).** Session.end → poll analysis → ready → `saveNotes()` (Hone import) + `intelligence.ingestInterviewSession()` (Coach memory). Coach видит «вчера на Google interview struggled with sharding question».
- **Wave J onboarding + interview-prep wizards.** First-launch onboarding (Welcome / Permissions / InvisibleDemo / Complete). Pre-interview CV+JD upload wizard (mig 00108 `interview_prep_sessions`) → персонализирует Cue persona на конкретный JD.

**Запуск:**

```bash
cd cue
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
| Test | Vitest + RTL | Vitest (vitest.config.ts) | Vitest (vitest.config.ts) |
| Lint | ESLint + tsc | ESLint + tsc | ESLint + tsc |
| Style | Tailwind + CSS vars | CSS vars + globals.css | CSS vars + globals.css |
| State | zustand + react-query | zustand | zustand |
| Theme | Dark-only (light killed 2026-05-12) | Dark-only | Dark-only |

## Куда смотреть, если

- **Добавить страницу в frontend/** или Hone → [.ai/skills/frontend-page.md](../../.ai/skills/frontend-page.md)
- **Подключить новый RPC к клиенту** → [.ai/skills/add-rpc.md](../../.ai/skills/add-rpc.md)
- **Релиз Hone/Cue (notarize, sign, update-feed)** → [.ai/skills/electron-app.md](../../.ai/skills/electron-app.md)
