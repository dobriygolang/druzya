# Hone — Project Bible

> Minimal dark desktop focus cockpit для разработчика в экосистеме druz9.
> Версия 0.2 · apr 2026 · обновлено после Phase 5a

Hone — один из трёх продуктов экосистемы druz9. См [ecosystem.md](./ecosystem.md) и [stealth-bible.md](./stealth-bible.md).

---

## 1. Что это

Hone — десктоп-приложение для ежедневного роста программиста. **Не заменяет druz9.ru** — оборачивает его в тихий фокус-слой для работы over the day.

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

---

## 3. Модули MVP

| Модуль | Хоткей | Что делает | AI-угол | Backend endpoint |
|---|---|---|---|---|
| Canvas (home) | — | Медитативный фон + persistent timer dock | — | — |
| Today | `T` | AI-план дня, 3-5 пунктов | Skill Atlas + календарь → plan | `POST /api/v1/hone/plan/generate` |
| Focus | `F` | Pomodoro + pinned task + streak | — | `/hone/focus/start`, `/focus/end` |
| Notes | `N` | Приватный markdown + AI-connections | bge-small embeddings → note-edges | `/hone/notes/*` |
| Whiteboard | `D` | Excalidraw-like + AI-critic | `SysDesignCritique` стрим | `/hone/whiteboards/*` |
| Stats | `S` | Focus heatmap + streak + 7d bars | — | `GET /api/v1/hone/stats` |
| Palette | `⌘K` | единый вход ко всему | — | — |

⌘⇧Space в Hone — promo overlay c демо «как это выглядело бы в Cue». Реальный stealth-моат живёт в `desktop/`.

---

## 4. Что Hone НЕ делает (hard cuts)

- ❌ Не решает задачи — deep-link на druz9.ru
- ❌ Нет Arena, mock, guild, рейтинга, турниров
- ❌ Нет full Skill Atlas viz (только «твоё слабое место на сегодня»)
- ❌ Нет магазина / продажи Pro (ссылка на druz9.ru)
- ❌ Нет stealth/hotkey/tray — это Cue

---

## 5. Архитектура (фактическая, Phase 5a)

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

## 7. Статус (Phase 5a закрыта 2026-04-24)

**Что уже сделано:**

✅ **Phase 1-2** — proto, миграции, скелет сервиса с NoLLM/NoEmbedder floor-адаптерами
✅ **Phase 3** — реальные LLM-адаптеры: `LLMChainPlanSynthesiser` (JSON strict + 2 retries), `LLMChainCritiqueStreamer` (section parser), `HoneEmbedder` (bge-small). Real `honeSkillAtlasAdapter` через pgx JOIN
✅ **Phase 4** — streak state transitions транзакционно (pre/post qualifying check + atomic state bump). 22 unit-теста, fix sqrt32 после обнаружения баги Newton-итерации (~8% error на x=384)
✅ **Phase 5a** — порт дизайна в strict-TS React, split 795-строчного `App.tsx` на 20 типизированных модулей, Connect-RPC transport + auth-interceptor, Stats-page как вертикальный срез

**CI зелёный:** `golangci-lint`, `gofmt`, `go vet`, `go test` по всем затронутым пакетам; `npm run typecheck` чистый в hone/ и desktop/.

---

## 8. Phase 5b — дорога к public beta (4-6 недель)

| # | Задача | Оценка | Зачем |
|---|---|---|---|
| 5b.1 | **Keychain auth** (keytar) + OAuth через браузер, `druz9://auth?token=` возврат | 1 нед | Убирает `VITE_DRUZ9_DEV_TOKEN` hatch |
| 5b.2 | **Today → real** `GenerateDailyPlan` | 3 дня | Самый высокоценный AI-endpoint |
| 5b.3 | **Focus → real** Start/End + persistence таймера через main-process store | 3 дня | Таймер не должен слетать при reload |
| 5b.4 | **Notes → real** CRUD + ⌘J connections panel + markdown render | 1 нед | Privacy-first, killer feature |
| 5b.5 | **Whiteboard → tldraw** вместо статичного SVG + `CritiqueWhiteboard` stream | 1 нед | Phase 3 backend готов ждёт клиента |
| 5b.6 | **Deep-links** `druz9://focus/start?task=…` → открытие Hone в Focus | 2 дня | Ecosystem glue |
| 5b.7 | **Rate limit** на `GenerateDailyPlan` force=true (1/5min) | 1 день | Защита LLM-квоты |
| 5b.8 | **Streak reconciliation worker** (background) | 2 дня | Drift prevention |
| 5b.9 | **Onboarding flow** (первый запуск): объяснить ⌘K, T, F, S | 3 дня | Без этого D1 retention провалится |
| 5b.10 | **Sentry integration** в main + renderer | 1 день | Без prod-telemetry beta слепая |

**Gate:** D1 retention beta-юзеров ≥ 40% при корпусе 50 человек из druz9-аудитории.

---

## 9. Phase 6 — public v1 launch (2-3 месяца после beta)

| Блок | Задачи |
|---|---|
| **Deploy pipeline** | CI-подписанный DMG + notarization + electron-updater feed (druz9 CDN), channel system (stable/beta) |
| **Website + downloads** | Лендинг из `design/hone/landing/landing.jsx` в `frontend/`, страницы `/hone`, `/cue` с dmg-кнопками |
| **Onboarding v2** | Персонализация: «какой у тебя стек», «куда метишь» → первый Today adaptive |
| **Billing** | Один `druz9 Pro` (790 ₽/мес) раскрывает AI в Hone + stealth в Cue + Skill Atlas в web. Yookassa / ЮKassa |
| **Legal** | ToS, privacy policy, 152-ФЗ compliance статус (data locality в РФ), consent для stealth-аналогов |
| **Observability** | Grafana dashboard для hone-LLM latency + error-rate + plan-regeneration cost per user |
| **Content** | Запускной пост на Хабре: «Winter со встроенным AI для программиста» + видео stealth-демо в Zoom. 5-7 TG-партнёрок |

**Gate:** 1,000 установок Hone в первые 30 дней после публичного запуска, D7 retention ≥ 20%, MRR от druz9 Pro ≥ 150к ₽.

---

## 10. Year 1 — scale + cross-platform (~месяцы 3-12)

### Q3 2026 — Windows-порт Hone + telemetry-driven iteration

- **Windows build** — electron-builder nsis target, проверка `WM_HOTKEY` для палитры, иконки трея
- **Telemetry-driven UX** — аналитика sessions/retention по когортам, Amplitude-style воронка ⌘K→action
- **Hot-fix streak bugs** — реальные пользователи обнаружат 5-10 edge-cases в streak-логике; TX-инварианты держат, но UI-пресентация может врать на timezone boundaries
- **Calendar integration** (Google Cal + Яндекс.Календарь): собесы в календаре → Today автоматически добавляет prep-items

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

## 11. Year 2 — enterprise + platformization (2027)

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

## 12. Year 3+ — ecosystem и beyond (2028+)

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

## 13. Pricing (по этапам)

| Этап | Free | Pro (₽/мес) | Team | Enterprise |
|---|---|---|---|---|
| Phase 6 (launch) | Canvas, Pomodoro, Notes без AI, Stats | 790 — всё AI в экосистеме | — | — |
| Year 1 Q4 | ↑ | 990 | 3,000/seat | — |
| Year 2 | ↑ | 990 | 3,000 (10% disc >10 мест) | договорной, от 5M ₽/год |
| Year 3 | ↑ | 990 + marketplace | ↑ | + on-prem, + SSO |

Pro-подписка **одна на всю экосистему** druz9 — Hone, Cue, Arena. Не продаём Hone-only / Cue-only.

---

## 14. Метрики по этапам

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

## 15. Parking lot (не в 2026-2027)

- Android-app (market priority низкий — разработчики редко кодят с телефона)
- Collaborative real-time editing (Notes / Whiteboard) — сложная инфра, сомнительная ценность для соло-user
- Light theme (dark — бренд)
- Интеграция с VSCode / JetBrains через extension (возможно Year 3 если Plugin SDK выстрелит)

---

## 16. Backend-дыры, которые не открылись (Phase 4 snapshot)

- **Keyset cursor pagination для Notes.List** — сейчас первые 100 по `updated_at DESC`, cursor игнорируется. Превратится в проблему на корпусе >100 заметок; для MVP ОК
- **Cross-domain connections для заметок** — `GetNoteConnections` сканирует только note-to-note. Year 1 Q4 план: единая «artifact с embedding» таблица, source=pr/task/session/note
- **Embedding async worker → proper queue** — сейчас `go uc.EmbedFn(...)` fire-and-forget, inflight теряются на рестарте. Phase 5b: Redis-list
- **Domain mocks (mockgen)** — директива `//go:generate` в `domain/repo.go` не исполнена, app-тесты на hand-rolled fakes; после стабилизации интерфейсов — mockgen как в daily

---

## 17. Принципы продуктового решения (чтобы не потерять ДНК)

Когда появляется желание добавить фичу, проверь:

1. **Это делает ежедневный ритуал тише или громче?** — если громче, режем.
2. **Это увеличивает weekly focus-hours?** — если не доказуемо, в parking lot.
3. **Это смешивает ответственности с druz9.ru или Cue?** — если да, это фича не Hone, а соседа.
4. **Это требует постоянной сети?** — Hone работает в дороге, в офлайн. AI-фичи деградируют корректно (503), не ломают Pomodoro / Notes / Whiteboard.
5. **Не появилась ли вторая визуальная группа там где была одна?** — если да, переверстать.

Эти пять — не религия. Но каждое нарушение требует явного «да, я выбираю эту цену» в PR-описании.
