# Hone — Project Bible

> Minimal dark desktop focus cockpit + consumption-surface экосистемы druz9.
> Версия 0.5 · apr 2026 · **Phase 6.5 closed** — multiplayer Excalidraw + Circles/Events + auth-fix.

Hone — один из трёх продуктов экосистемы druz9. См [ecosystem.md](./ecosystem.md) и [cue-bible.md](./cue-bible.md).

---

## 1. Что это

Hone — desktop-приложение: ежедневный ритуал + consumption-surface всей экосистемы. Содержит и приватный слой (Today / Focus / Notes / Whiteboard), и потребление контента из web (Podcasts / Editor rooms / Events).

**Аудитория:** middle/senior разработчик в РФ, готовится к собесу и/или хочет расти каждый день. Устал от Notion + Todoist + Leetcode + Obsidian + Cal.

**One-liner:** «Sharpen your craft daily. Quietly.»

---

## 2. ДНК продукта

- **Winter-эстетика:** один чёрный canvas, каждая страница — полноэкранная, Esc возвращает в пустоту.
- **Keyboard-first:** всё через ⌘K палитру, никаких меню.
- **AI везде, где имеет смысл** (плавно, не навязчиво).
- **Приватность:** Notes / Whiteboard живут у пользователя, не расшариваются.
- **Radical minimalism:** если на экране больше 2 визуальных групп — режем.
- **Нет stealth-трюков** в Hone. Content-protection, tray-only UI и global hotkeys — подпись Cue (`desktop/`), не Hone. Смешение ломает ментальную модель (см [ecosystem.md §2](./ecosystem.md)).
- **Консистентный state между Hone и web.** Каждая shareable-surface (Editor rooms, Events, Podcasts) может быть открыта в браузере — WebSocket/HTTP бекенд гарантирует что оба клиента смотрят в один источник истины.

### 2.1 DNA-revision (apr 2026, после Phase 6)

Старое правило: «Hone потребляет, web производит». Новое:

- **web (druz9.online)** — **админка + сайт**. Создание ивентов (Book Club), лендинги (/welcome, /hone, /copilot), Terms/Privacy, admin-панели, OAuth-flow, аналитика.
- **Hone (desktop)** — **primary daily-companion**. И приватный слой (Focus / Notes / Whiteboard), и consumption-контента (Podcasts / Editor rooms / Events).
- **link-back**: каждая shareable-страница Hone'а имеет кнопку «Copy URL» + «Open on web ↗». Web открывает то же состояние, WebSocket broadcast'ит изменения между hone и браузером в real-time.

Это не ломает старый принцип — Hone по-прежнему не **создаёт** контент (event создаётся на web, не в Hone). Просто consumption-surface переехал в Hone полностью.

---

## 3. Модули (Phase 6 — public v1)

| Модуль | Хоткей | Что делает | AI-угол | Backend endpoint |
|---|---|---|---|---|
| Home canvas | — | Медитативный фон + persistent timer dock | — | — |
| **Today** | `T` | AI-план дня, 3-5 пунктов с rationale | Skill Atlas + resistance → plan | `/hone/plan/generate` |
| **Focus** | `F` | Pomodoro + pinned task + streak + reflection | — | `/hone/focus/start`, `/focus/end` |
| **Notes** | `N` | Приватный markdown + ⌘J connections | bge-small embeddings, cosine top-10 | `/hone/notes/*`, `/hone/notes/{id}/connections` |
| **Whiteboard** | `D` | tldraw + AI-critic + save-as-note | `SysDesignCritique` stream | `/hone/whiteboards/*` |
| **Stats** | `S` | Focus heatmap + streak + 7d bars | — | `/hone/stats` |
| **Podcasts** | `P` | Плеер + прогресс-трекер | — | `/podcast`, `/podcast/{id}/progress` |
| **Editor rooms** | `E` | Real-time collab (Yjs + CodeMirror) | — | `/editor/room/*`, `ws/editor/{id}` |
| **Shared boards** | `B` | Multiplayer Excalidraw (Yjs + WS) | — | `/whiteboard/room/*`, `ws/whiteboard/{id}` |
| **Events** | `V` | Календарь events из моих circles | — | `/events/*` + `/circles/*` |
| Palette | `⌘K` | единый вход + Daily Standup + New room | — | — |

⌘⇧Space в Hone — promo overlay c демо «как это выглядело бы в Cue». Реальный stealth-моат живёт в `desktop/`.

---

## 4. Что Hone НЕ делает (hard cuts)

- ❌ Не решает задачи — deep-link на druz9.ru
- ❌ Нет Arena, mock, guild, рейтинга, турниров — остаются на web
- ❌ Нет full Skill Atlas viz (только «твоё слабое место на сегодня»)
- ❌ Нет **создания** ивентов (Book Club создаётся на web, Hone только показывает + join)
- ❌ Нет Pro-billing UI — ссылка на druz9.online/pricing
- ❌ Нет stealth/hotkey/tray — это Cue

---

## 5. Архитектура (фактическая, Phase 6.5)

### Frontend — отдельное Electron-приложение `hone/`

```
hone/
├── electron.vite.config.ts       main/preload/renderer + @generated alias
├── electron-builder.yml          macOS DMG + druz9:// scheme
├── package.json                  react 18.3 + electron 41 + connect-rpc
├── resources/                    icon.svg + og.png
└── src/
    ├── main/index.ts             одно окно, druz9:// deep-link forwarder
    ├── preload/index.ts          contextBridge → window.hone
    ├── shared/ipc.ts             HoneAPI типы
    └── renderer/
        ├── index.html            CSP: 'self' + api.druzya.tech + localhost:8080
        └── src/
            ├── App.tsx           ~140 строк оркестратора (routing + hotkeys + pomodoro)
            ├── main.tsx          createRoot mount
            ├── api/              Connect-RPC layer
            │   ├── config.ts     VITE_DRUZ9_API_BASE + dev-token hatch
            │   ├── transport.ts  singleton transport + auth interceptor
            │   └── hone.ts       typed getStats() и будущие wrappers
            ├── components/
            │   ├── CanvasBg.tsx      meditative backdrop (3 режима)
            │   ├── Chrome.tsx        Wordmark + Versionmark
            │   ├── Copilot.tsx       mock stealth (промо-оверлей)
            │   ├── Dock.tsx          persistent timer pill
            │   ├── Palette.tsx       ⌘K command surface
            │   ├── primitives/       Icon, Kbd
            │   └── stats/            Card, Label, Heatmap, Sparkline, Bars
            ├── pages/                Home / Today / Focus / Notes / Whiteboard / Stats
            ├── stores/session.ts     zustand auth store (hydrate в Phase 5b)
            ├── styles/globals.css    все токены + primitive classes
            └── vite-env.d.ts         typed window.hone
```

**Design artefact:** [`design/hone/hone.jsx`](../design/hone/hone.jsx) — оригинальный Babel-standalone референс, от которого отпилен App.tsx.

### Backend — `backend/services/hone/`

Скелет следует паттерну `daily` / `editor`: `domain/` → чистые entity + repo interfaces, `app/` → use cases, `infra/` → Postgres + LLM-адаптеры, `ports/` → Connect-RPC handlers.

```
backend/services/hone/
├── go.mod                        (require druz9/shared + replace)
├── README.md
├── domain/
│   ├── entity.go                 Plan, FocusSession, Note, Whiteboard, Stats
│   ├── errors.go                 ErrNotFound, ErrLLMUnavailable, …
│   └── repo.go                   5 repo-интерфейсов + адаптер-интерфейсы
├── app/
│   ├── handlers.go               Handler-struct (собирается wiring'ом)
│   ├── plan.go                   GeneratePlan / Get / Dismiss / Complete
│   ├── focus.go                  Start / End / GetStats (+ streak apply)
│   ├── notes.go                  Create / Update / Get / List / Delete /
│   │                              GetNoteConnections (cosine over embeddings)
│   ├── whiteboards.go            CRUD + CritiqueWhiteboard (stream)
│   ├── plan_test.go, focus_test.go, notes_test.go
│   └── (22 unit-теста, hand-rolled fakes)
├── infra/
│   ├── postgres.go               5 репозиториев, hand-rolled pgx
│   └── llm.go                    NoLLM* floor-адаптеры + LLMChain* реальные
│                                 + HoneEmbedder (обёртка над llmcache)
└── ports/
    └── server.go                 HoneServer — 18 Connect-RPC handlers
```

**Миграции в `backend/migrations/`:**

- `00013_hone_focus.sql` — `hone_daily_plans`, `hone_focus_sessions`, `hone_streak_days`, `hone_streak_state`
- `00014_hone_notes.sql` — `hone_notes` с `embedding float4[384]` + FTS
- `00015_hone_whiteboards.sql` — `hone_whiteboards` с optimistic concurrency

**Монолит-wiring в `backend/cmd/monolith/services/hone.go`** — pick-real-vs-floor по конфигу:

- `d.LLMChain != nil` → `LLMChainPlanSynthesiser` + `LLMChainCritiqueStreamer`; иначе `NoLLM*` → 503
- `cfg.LLMChain.OllamaHost != ""` → `HoneEmbedder`; иначе `NoEmbedder` → 503 на `GetNoteConnections`
- `SkillAtlasReader` — hand-rolled pgx JOIN `skill_nodes ⨝ atlas_nodes` в `cmd/monolith/services/adapters.go`

### Proto — `proto/druz9/v1/hone.proto`

`HoneService` с 18 RPC (Plan 4, Focus 3, Notes 6, Whiteboard 5). Два server-streaming метода: `GetNoteConnections`, `CritiqueWhiteboard`.

### AI-задачи в llmchain

Все вызовы через `backend/shared/pkg/llmchain`:

- `TaskDailyPlanSynthesis` — **новый**, 70B-class + JSONMode, 2 попытки парсинга
- `TaskSysDesignCritique` — existing, используется Whiteboard критиком
- `llmcache.OllamaEmbedder` + bge-small — used by notes auto-links

---

## 6. Sync с druz9.ru

| Поток | Направление | Статус |
|---|---|---|
| Skill Atlas (слабые навыки) | web → Hone (read) | ✅ через `honeSkillAtlasAdapter` |
| Current focus-time today | Hone → web stats | 🟡 пишется в `hone_streak_days`, web агрегация TBD |
| Streak days | Hone → web profile | 🟡 то же |
| Открыть задачу | Hone → браузер (`druz9://task/…`) | ⏳ Phase 5b deep-link handling |
| Старт focus из web | web → Hone (`druz9://focus/start?…`) | ⏳ Phase 5b |
| Notes / Whiteboard | **НЕ синкается с web** — приватно | ✅ hard boundary |

---

## 7. Статус

**Что уже сделано:**

✅ **Phase 1-2** — proto, миграции, скелет сервиса с NoLLM/NoEmbedder floor-адаптерами
✅ **Phase 3** — реальные LLM-адаптеры: `LLMChainPlanSynthesiser` (JSON strict + 2 retries), `LLMChainCritiqueStreamer`, `HoneEmbedder` (bge-small). Real `honeSkillAtlasAdapter` через pgx JOIN
✅ **Phase 4** — streak state transitions транзакционно, 22 unit-теста, fix sqrt32
✅ **Phase 5a** — порт дизайна в strict-TS React, split 795-строчного `App.tsx` на 20 модулей, Connect-RPC transport + auth-interceptor, Stats-page как вертикальный срез

✅ **Phase 5b — public beta gate** (все 10 пунктов закрыты):
   - 5b.1 Keychain через `safeStorage` (без keytar-native-build) + OAuth flow через druz9://auth deep-link
   - 5b.2–5b.5 Real RPC на Today / Focus / Notes / Whiteboard (tldraw)
   - 5b.6 Deep-link router в main-process (druz9://auth + druz9://focus)
   - 5b.7 Rate-limit `GenerateDailyPlan(force=true)` 1/5min
   - 5b.8 Streak reconciliation worker (15-min ticker, FindDrift + RecomputeDay)
   - 5b.9 Onboarding v2 — stack/goal wizard + shortcuts tour
   - 5b.10 Sentry main + renderer

✅ **Backend-продуктовые фичи** (Phase 4-5b batch):
   - Rationale + skill_key на PlanItem + prompt-tweak синтезайзера
   - SaveCritiqueAsNote RPC (Whiteboard → Note)
   - EndFocusSession.reflection → auto-note
   - RecordStandup RPC (3 вопроса → Note + patch Plan)
   - Resistance tracker (hone_plan_skips + ChronicSkills + tiny-task / reflection-prompt)

✅ **Phase 6 — public v1 launch** (launched 2026-04-24):
   - Release CI (`.github/workflows/hone-release.yml`): notarized DMG arm64+x64 → GitHub Release
   - electron-updater — 4-hour polling + non-intrusive «Restart» toast
   - Landing pages: `/hone`, `/legal/terms`, `/legal/privacy` (152-ФЗ)
   - Grafana dashboard `druz9-hone.json` + 3 warning alerts
   - Pro-gate: `TierReader` + `ErrProRequired` (403 на GeneratePlan/Critique/Connections)
   - Onboarding v2 wizard

✅ **Phase 6.5 — consumption surface expansion + multiplayer + auth-fix** (closed apr 2026):
   - ✅ Podcasts — плеер + progress tracking через `UpdateProgress`
   - ✅ Editor rooms — Yjs + CodeMirror 6 + WebSocket `/ws/editor/{id}` + Copy URL + Open on web
   - ✅ **Shared boards** — multiplayer Excalidraw через Yjs + `/ws/whiteboard/{id}`. Snapshot persistence (debounce 30s). Hotkey B
   - ✅ **Circles + Events** — community-layer (circles) + календарь events (hotkey V в Hone). Web circles UI делается отдельно
   - ✅ **Auth-fix** — Telegram code-flow перенесён в Hone main-process: `/auth/telegram/start` + polling прямо через IPC, без web /login и без `druz9://` redirect dance. Решает «логонюсь в браузере и ничего не происходит»
   - ⏳ Cleanup web (`/editor`, `/podcast`) — Sergey сам сделает

**CI зелёный:** `golangci-lint`, `gofmt`, `go vet`, `go test` по backend; `npm run typecheck` + `npm run build` в hone/ и frontend/.

---

## 8. Phase 5b + 6 — ЗАКРЫТЫ ✅

См §7 статус. Phase 5b (10 пунктов) и Phase 6 (7 блоков: release CI, landing, legal, Grafana, Pro-gate, onboarding v2, electron-updater) — готово.

---

## 9. Phase 6.5 — consumption-surface expansion + multiplayer (CLOSED apr 2026)

Переносим shareable-поверхности в Hone и делаем их primary. Web остаётся shareable-fallback + creation-admin (circles UI). Обосновано §2.1 DNA-revision.

| # | Задача | Статус |
|---|---|---|
| 6.5.1 | **Podcasts** — PodcastService wrapper + страница + <audio> player + throttled UpdateProgress | ✅ |
| 6.5.2 | **Editor rooms** — Yjs + CodeMirror 6 + WS + participants + Copy URL + Open on web | ✅ |
| 6.5.3 | **Circles + Events** — два backend-сервиса (`circles/`, `events/`), миграции 00023+00024, proto с enum'ами, Hone Events page (hotkey V) | ✅ |
| 6.5.4 | **Shared boards (multiplayer Excalidraw)** — backend `whiteboard_rooms/` (миграция 00022), opaque Yjs WS-relay, snapshot debounce-flush, Hone page (hotkey B) | ✅ |
| 6.5.5 | **Auth-fix** — Telegram code-flow в Hone main вместо web-перескока (Chrome blocks custom-scheme redirect из async, dev-Electron не register'ит druz9:// в LaunchServices) | ✅ |
| 6.5.6 | **Cleanup web** (удалить routes `/editor`, `/podcast`) — Sergey сам | ⏳ |

**Multiplayer realtime-стек** (one mental model для editor + shared boards):
- Y.Doc на клиенте (CRDT) — auto-merge без конфликтов
- Opaque WebSocket relay в Go (in-memory hub, sub-100ms fanout)
- Snapshot hydration на handshake — late-joiner видит state мгновенно
- Awareness channel для presence (cursors, имена) — не persistится

**Trade-off shared boards (MVP):** Y.Map<'scene'> хранит сериализованный elements-array, last-writer-wins per change. Достаточно для разных областей canvas'а. Per-element CRDT-merge (`Y.Array<Y.Map>`) — Phase 7 если будут жалобы на конфликты.

**Gate:** 200 DAU пользуются Podcasts / Editor rooms / Shared boards / Events в Hone хоть раз в неделю.

---

## 10. Phase 7 — public v1 launch (2-3 месяца после beta)

| Блок | Задачи |
|---|---|
| **Billing** | Один `druz9 Pro` (790 ₽/мес) раскрывает AI в Hone + stealth в Cue. Yookassa / ЮKassa wiring (сейчас Pro-gate в Hone уже есть — ждёт merchant-ключи) |
| **Content** | Запускной пост на Хабре: «Winter со встроенным AI для программиста» + видео stealth-демо в Zoom. 5-7 TG-партнёрок |
| **Apple Developer** | Cert + Team ID в GitHub Secrets (APPLE_ID, APPLE_APP_PASSWORD, APPLE_TEAM_ID, CSC_LINK) → первый `git tag hone-v1.0.0` → notarized DMG |
| **Sentry DSN** | Создать проект в Sentry → HONE_SENTRY_DSN в env CI-билда |
| **Legal финал** | Юрист редактирует ToS + Privacy, текущие тексты (`/legal/terms`, `/legal/privacy`) — draft'ы |

**Gate:** 1,000 установок Hone в первые 30 дней после публичного запуска, D7 retention ≥ 20%, MRR от druz9 Pro ≥ 150к ₽.

---

## 11. Year 1 — scale + cross-platform (~месяцы 3-12)

### Q3 2026 — Windows-порт Hone + telemetry-driven iteration

- **Windows build** — electron-builder nsis target, проверка `WM_HOTKEY` для палитры, иконки трея
- **Telemetry-driven UX** — аналитика sessions/retention по когортам, Amplitude-style воронка ⌘K→action
- **Hot-fix streak bugs** — реальные пользователи обнаружат 5-10 edge-cases в streak-логике; TX-инварианты держат, но UI-пресентация может врать на timezone boundaries
- **External calendar sync** (Google Cal + Яндекс.Календарь): сверху поверх internal Events (книжный клуб). Собесы из внешнего календаря → Today auto-prep

### Q4 2026 — интеграции, продвижение ecosystem

- **Linear / Jira / Notion ingestion** — Notes может импортировать вашу зону ответственности, AI-connections начинают связывать заметки с реальными тикетами
- **GitHub activity edges** — PR events → `hone_activity_events` таблица с embedding → `GetNoteConnections` видит "вы фиксили это вчера в PR #421"
- **Voice recording + speech-to-text** (Groq whisper) — быстрая диктовка в Notes, прямо в pomodoro-сессии
- **iOS companion** (read-only): streak, сегодняшний план, «кинуть задачу» deep-link в Hone через Shortcuts

### Q1-Q2 2027 — commercial anchoring

- **Paid stealth-Cue** как полноценный standalone продукт с отдельным биллингом/лендингом. Переход `desktop/` → `cue/` monorepo-рядом с hone
- **Teams tier** (₽3к/место/мес): shared whiteboards, team focus-streak, manager dashboard (aggregated focus-time без drill-down в приватность)
- **B2B pilot** с 2-3 tech-компаниями РФ (Т-Банк / Yandex / Avito) на тему hr-tech возможностей
- **Plugin hooks (alpha)**: `hone://plugins/*` scheme для custom commands в ⌘K палитре — готовит почву для Year 2

**Gate:** 15k MAU, 3k paying, MRR ≥ 2.5M ₽, retention D30 ≥ 12%.

---

## 12. Year 2 — enterprise + platformization (2027)

### Enterprise SKU

- **Admin console** — web-панель для команд/компаний: пригласить участников, управлять seats, compliance-экспорт
- **On-prem option** — docker-compose bundle (Postgres + monolith + bge-small на Ollama + Redis) для комп с требованиями data-locality / ФСТЭК
- **SAML SSO** для enterprise-аккаунтов
- **Audit log** — все действия пользователя (для compliance-heavy клиентов)

### Platformization

- **Public API** — те же RPC что Hone использует внутри, доступны сторонним разработчикам. `api.druzya.tech/v1/hone/plan/generate` с rate-limit по plan
- **Plugin SDK** (stable): Electron-процесс Hone загружает сертифицированные плагины, которые регистрируют ⌘K-команды и могут читать/писать в Notes с согласия пользователя. Начало marketplace
- **Anthropic / OpenAI BYOK** — pro-пользователи указывают свой ключ, получают фронтир-модели для AI-planner/critique/connections. Не монетизируется, но меняет потолок качества

### Deep AI

- **Personalised plan synthesiser** — fine-tune 8B модели на истории плана каждого пользователя (локально через Ollama). AI знает твой стиль работы
- **RAG over all your data** — Notes + PRs + Jira + Linear + GitHub commits, один поисковый endpoint в ⌘K: «что я знаю про redis locks»
- **Voice-first Focus mode** — ведёшь монолог про задачу → AI пишет заметку с ключевыми идеями, связывает с текущей задачей

**Gate:** 50k MAU, 10k paying + 3 enterprise контракта (₽3-10M ARR), net revenue retention ≥ 110%, выход в US-сегмент через product hunt / HN

---

## 13. Year 3+ — ecosystem и beyond (2028+)

Три направления. Не всё выстрелит; ставки разные.

### 1. Hone как development OS

- Главный экран разработчика, в котором живёт весь день. ⌘K — основной способ взаимодействовать с любым рабочим tool'ом через natural-language и AI
- Конкуренция: Raycast, Warp, Arc Browser. Differentiator Hone — focus + growth narrative, не productivity-vanity

### 2. Ecosystem API + marketplace

- Hone + Cue + druz9.ru как платформа, third-party делают плагины/интеграции за revenue share
- GitHub Marketplace-like опыт: «установить плагин Sentry Focus» → в Notes связываются с текущим on-call инцидентом
- Экономика: 70/30 split, marketplace fee

### 3. Образовательный bend

- Hone-for-students: урезанная версия для университетов, интеграция с олимпиадной подготовкой
- Партнёрство с ВУЗами (Инноополис, ИТМО, Сириус): Hone в учебном треке «Software Engineering»
- B2G / B2Edu SKU

---

## 14. Pricing (по этапам)

| Этап | Free | Pro (₽/мес) | Team | Enterprise |
|---|---|---|---|---|
| Phase 6 (launch) | Canvas, Pomodoro, Notes без AI, Stats | 790 — всё AI в экосистеме | — | — |
| Year 1 Q4 | ↑ | 990 | 3,000/seat | — |
| Year 2 | ↑ | 990 | 3,000 (10% disc >10 мест) | договорной, от 5M ₽/год |
| Year 3 | ↑ | 990 + marketplace | ↑ | + on-prem, + SSO |

Pro-подписка **одна на всю экосистему** druz9 — Hone, Cue, Arena. Не продаём Hone-only / Cue-only.

---

## 15. Метрики по этапам

| Этап | DAU | D1 | D7 | D30 | Paying | MRR |
|---|---|---|---|---|---|---|
| Phase 5b beta | 30-50 | 40% | 20% | — | 0 | 0 |
| Phase 6 launch | 500 | 40% | 20% | 10% | 150 | 150k ₽ |
| Year 1 Q3 | 3,000 | 45% | 22% | 12% | 1,000 | 1M ₽ |
| Year 1 Q4 | 8,000 | 50% | 25% | 14% | 3,000 | 2.5M ₽ |
| Year 2 | 30,000 | 55% | 28% | 18% | 10,000 | 10M ₽ + 3 enterprise |
| Year 3 | 100,000 | 55% | 30% | 22% | 30,000+ | 35M ₽ + marketplace |

Северная звезда: **weekly focus-hours per active user**. Pro ценен ровно настолько, насколько увеличивает это число.

---

## 16. Parking lot (не в 2026-2027)

- Android-app (market priority низкий — разработчики редко кодят с телефона)
- Collaborative real-time editing (Notes / Whiteboard) — сложная инфра, сомнительная ценность для соло-user
- Light theme (dark — бренд)
- Интеграция с VSCode / JetBrains через extension (возможно Year 3 если Plugin SDK выстрелит)

---

## 17. Backend-дыры, которые не открылись (Phase 4 snapshot)

- **Keyset cursor pagination для Notes.List** — сейчас первые 100 по `updated_at DESC`, cursor игнорируется. Превратится в проблему на корпусе >100 заметок; для MVP ОК
- **Cross-domain connections для заметок** — `GetNoteConnections` сканирует только note-to-note. Year 1 Q4 план: единая «artifact с embedding» таблица, source=pr/task/session/note
- **Embedding async worker → proper queue** — сейчас `go uc.EmbedFn(...)` fire-and-forget, inflight теряются на рестарте. Phase 5b: Redis-list
- **Domain mocks (mockgen)** — директива `//go:generate` в `domain/repo.go` не исполнена, app-тесты на hand-rolled fakes; после стабилизации интерфейсов — mockgen как в daily

---

## 18. Принципы продуктового решения (чтобы не потерять ДНК)

Когда появляется желание добавить фичу, проверь:

1. **Это делает ежедневный ритуал тише или громче?** — если громче, режем.
2. **Это увеличивает weekly focus-hours?** — если не доказуемо, в parking lot.
3. **Это смешивает ответственности с druz9.ru или Cue?** — если да, это фича не Hone, а соседа.
4. **Это требует постоянной сети?** — Hone работает в дороге, в офлайн. AI-фичи деградируют корректно (503), не ломают Pomodoro / Notes / Whiteboard.
5. **Не появилась ли вторая визуальная группа там где была одна?** — если да, переверстать.

Эти пять — не религия. Но каждое нарушение требует явного «да, я выбираю эту цену» в PR-описании.
