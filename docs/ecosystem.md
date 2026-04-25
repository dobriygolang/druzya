# Ecosystem — druz9 + Hone + Cue

> Как три поверхности связаны, что делает каждая, и главное — **чего НЕ делает каждая**.
> Версия 1.2 · apr 2026 · обновлено после ADR-001 Phase-4 (web-cleanup, Hone-aesthetic unification, intelligence-as-killer-feature)

---

## 1. Три поверхности

| Поверхность | Mental mode | Что | Триггер открытия |
|---|---|---|---|
| **druz9.online** (web) | «Арена + аналитика» | Arena (1v1/2v2), Mock-interview, Slots, Vacancies, Codex (статьи), Circles (создание + ивенты), **Insights** (агрегат web/Hone/Cue), Skill Atlas. Lendings + admin + OAuth + pricing. | «Хочу соревноваться / готовиться к собесу / получить аналитику» |
| **Hone** (desktop) | «Тихий кокпит» | Today plan, Focus sessions (pomodoro), приватные Notes, Whiteboard, Stats/streak, consumption Podcasts/Editor rooms/Events | «Хочу фокусно работать над собой сегодня» |
| **Cue** (desktop tray-app) | «Наушник на ринге» | Невидимый AI поверх любой ОС, экран + вопрос → ответ за секунды. **Блокируется** во время strict mock-сессий (см §10). | «Я застрял здесь и сейчас» |

Разные триггеры → три продукта не конкурируют, дополняют.

**Hone и Cue — два разных Electron-приложения.** Одна установочная история («установи druz9 suite») в будущем; сейчас два отдельных DMG. Решение о разделении принято в Phase 5a: смешение «тихий кокпит» и «stealth-оверлей» ломает mental model (см §2).

**Web-фокус (ADR-001 Phase-4):** druz9.online — это **арена + аналитика**, не RPG-витрина. Killer-фича — **Mock-interview + Insights**. Удалены RPG-страницы (Sanctum/Obituary/Necromancy/Ghosts/Stress), gamification (Achievements/XPRain/ConfettiBurst), и orphan-сервисы (ai_native, season). Cohort слит в Circles (см §11).

---

## 2. Правило несамокания (жёсткое)

> **Hone ПОТРЕБЛЯЕТ данные из web и оборачивает focus-слоем. Hone НЕ создаёт контент.**
>
> **Cue — ситуативный, не хранит состояние основного продукта.**
>
> **Hone НЕ делает stealth.** Никаких `setContentProtection(true)`, никакого tray-only UX, никаких global hotkey'ев. Это подпись Cue.

Проверка: если пользователь может сказать «зачем мне X, если есть Y» — значит каннибализация, режем. И: если в Hone появляется «спрячь окно», это фича Cue, не Hone.

---

## 3. Что где живёт

| Намерение пользователя | Где |
|---|---|
| Сразиться с кем-то live (1v1/2v2) | web — `/arena` |
| Mock-собес (AI-allowed / AI-blocked) | web — `/mock` (см §10 — AI-toggle) |
| Полный Skill Atlas / рейтинг | web — `/atlas`, `/profile` |
| **Insights — weekly digest, readiness forecast** | web — `/insights` (Wave 4, см §12) |
| Codex (статьи / гайды) | web — `/codex` |
| Создать circle / ивент в нём | web — `/circles` |
| Бронь mock-интервьюера | web — `/slots` |
| Вакансии и applications | web — `/vacancies`, `/applications` |
| Купить Pro / pricing | web — `/pricing` |
| Спланировать день | **Hone** |
| Приватная заметка / диаграмма | **Hone** |
| Pomodoro + фокус над задачей | **Hone** |
| Streak, focus-heatmap личная | **Hone** |
| Ежедневный «что сегодня важного» | **Hone** |
| Слушать подкасты | **Hone** (consumption-surface; web — admin only) |
| Просмотр circle-events | **Hone** (создание — на web) |
| Editor rooms (real-time collab Yjs+CodeMirror) | **Hone** |
| Застрял в IDE | **Cue** |
| На собесе/звонке нужен быстрый ответ | **Cue** (если mock не strict — см §10) |
| Live-transcript встречи + auto-suggest | **Cue** |
| RAG по приложенным документам (CV / JD) | **Cue** |

---

## 4. Общие слои

- **Auth:** единый `druz9 Pro` токен (Yandex/Telegram OAuth через `backend/services/auth`). Hone и Cue используют keychain (`keytar`) и читают тот же access token.
- **Skill Atlas:** хранится в `services/profile`, читается всеми тремя поверхностями (Hone — для Today-плана через `honeSkillAtlasAdapter`).
- **Focus-time / streak:** пишется Hone → `hone_streak_days` → агрегируется в профиле на web для публичного пассивного режима.
- **LLM chain:** один `backend/shared/pkg/llmchain` (Groq → Cerebras → Mistral → OpenRouter → Ollama floor). Hone и Cue вызывают разные task'и (`TaskDailyPlanSynthesis` / `TaskSysDesignCritique` / `TaskCopilotStream` / `TaskCodingHint` / …).
- **Mock-block protocol (новое в Wave 3):** копайлот (`services/copilot`) перед каждым LLM-консультом дёргает `CheckBlock`-RPC; если у пользователя есть активная mock-сессия с `ai_assist=false` — Cue получает `blocked: true` и блокирует подсказку. Defense-in-depth: `Answer` тоже проверяет block внутри себя (returns `PermissionDenied`), чтобы Cue нельзя было обойти. См §10.
- **Deep links:**
  - `druz9://task/dsa/p-102` — открыть задачу на druz9.online (из Hone Today)
  - `druz9://focus/start?task=dsa/p-102` — открыть Hone в Focus-режиме (из web)
  - `druz9://hone/notes/new` — создать заметку в Hone (из внешних источников)
  - `druz9://auth?token=…` — возврат OAuth flow в Hone / Cue после браузерного логина

---

## 5. Монетизация

**Одна подписка `druz9 Pro` (~790 ₽/мес)** даёт Pro-фичи везде:

| Поверхность | Free | Pro |
|---|---|---|
| druz9.ru | базовая Arena, подкасты, общий Atlas | расширенный Atlas, турниры, season pass |
| Hone | canvas, Pomodoro, Notes без AI, Stats, Whiteboard без AI | AI-planner, AI-connections, AI-critique |
| Cue | — (требует Pro) | все фичи включены |

Без Pro Cue не запускается — это ключевой платящий хук. Hone имеет значимый free-tier чтобы быть «привычкой до оплаты».

---

## 6. Репо-структура (актуальное на Phase 5a)

```
druzya/
├── backend/
│   ├── services/
│   │   ├── auth, profile, arena, ai_mock, ai_native, editor, rating,
│   │   │   season, daily, slot, podcast, notify, admin, copilot (→ Cue),
│   │   │   documents, transcription, feed, achievements, friends, cohort,
│   │   │   lobby, mentor_session, orgs, review, tg_coach, vacancies
│   │   └── hone/                 Phase 3 скелет → Phase 4 закрыта
│   ├── shared/pkg/llmchain/      общий роутер
│   ├── shared/pkg/llmcache/      semantic cache + Ollama embedder
│   └── migrations/               00013-15 hone + остальное
├── frontend/                     druz9.ru (web arena)
├── hone/                         NEW — Electron + Vite + React
│   └── src/{main,preload,shared,renderer/src/{api,components,pages,stores}}
├── desktop/                      Cue (ex-«Druz9 Copilot» — переименован apr 2026)
│   ├── native/audio-mac/         ScreenCaptureKit binary для system audio
│   └── src/renderer/screens/     compact + expanded + picker + settings + …
├── proto/druz9/v1/               *.proto (17 сервисов, codegen в frontend/src/api/generated)
├── design/
│   └── hone/                     landing.jsx + hone.jsx artefacts + brand SVG
└── docs/
    ├── ecosystem.md              ← этот файл
    ├── hone-bible.md             Hone product + roadmap
    ├── stealth-bible.md          Cue (ex-stealth) product + roadmap
    ├── DEPLOYMENT.md, SERVER-SETUP.md
    └── druz9-bible.md            web-продукт (в корне репо)
```

### Почему `desktop/` всё ещё называется `desktop`

Директория не переименована в `cue/` чтобы не ломать:
- существующий CI (GitHub Actions paths фильтры)
- электрон-apps, которые уже installed на тест-машинах разработчиков (`.app` wrapper)
- git-history blame + PR-reviews in-flight

Brand rename уже в `desktop/package.json`: `"productName": "Cue"`, `"description": "Cue — stealthy AI assistant…"`. Директория переименуется вместе с публичным v1 launch'ем когда цена разрыва git-истории окупится.

---

## 7. User journey (day in the life)

- **07:00** — Open Hone. AI Plan готов: «задача X, mock в 18:00, review PR #421».
- **09:30** — Start focus session → Hone диплинкнул задачу → браузер открыл druz9.ru/daily/p-102.
- **13:00** — Работа. Застрял в legacy-коде. `⌘⇧Space` → Cue видит экран, отвечает.
- **15:00** — Созвон с менеджером в Zoom. Cue запись митинга на, live-transcript в expanded, auto-suggest pill при вопросах собеседника.
- **18:00** — Mock interview. Открывается web (не Hone — там peer/AI живые).
- **22:00** — Закрыл ноут. Hone тихо записал focus-heatmap. Streak +1.

Три продукта — один ритуал.

---

## 8. Релизные слои

| Слой | Кто владеет | Частота релизов | Auto-update |
|---|---|---|---|
| druz9.ru web | `frontend/` | continuous deploy через CI | — |
| Backend monolith | `backend/cmd/monolith/` | на каждый merge в main | — |
| Hone `.app` | `hone/` | weekly в beta, monthly в stable | electron-updater feed |
| Cue `.app` | `desktop/` | weekly в beta, monthly в stable | electron-updater feed, отдельный канал |

Hone и Cue релизятся независимо. Единственная cross-product синхронизация — proto-stubs в `frontend/src/api/generated/` (обновляет один `make gen-proto`).

---

## 9. Changelog

- **1.2** (apr 2026) — ADR-001 Phase 4. Web переориентирован на «арена + аналитика»:
  - **Удалены страницы:** Sanctum, CodeObituary, Necromancy, GhostRuns, StressMeter, InterviewAutopsy, InterviewCalendar, NativeRound, Rating, Season, Achievements, KataStreak, MatchHistory (переехал в profile-таб), CopilotLanding, CopilotReport, HonePage, WelcomeDemo, WarRoom — 18 страниц
  - **Удалены backend-сервисы:** `services/{ai_native,season,cohort,achievements}`, autopsy/calendar pieces of `services/daily`. Бутстрап и go.work подчищены, миграции 00037-00039 дропают orphan-таблицы
  - **Слияние:** Cohort → Circles. Frontend переписан с `useMyCohortQuery` на `useMyCirclesQuery`. Profile tab `Cohorts` → `Circles`
  - **Wave 3 — Mock AI-toggle:** `ai_mock_sessions.ai_assist` колонка (миграция 00040), `services/copilot.CheckBlock` RPC, defense-in-depth в `Answer`
  - **Wave 4 — Insights:** новая страница `/insights` (skeleton), 5-й пункт top-nav между Atlas и Circles. Виджеты Weekly Digest / Readiness Forecast / Focus Trend / Atlas Auto-Update / Mock Signals / Cross-Surface Aggregation. Источник — `services/intelligence`
  - **Дизайн:** web переведён в Hone-эстетику (чистый чёрный, белый + opacity-слои, hairlines, единственный акцент `#FF3B30`). Brand-gradient `violet→cyan→pink` удалён. Achievements/ConfettiBurst/XPRain удалены.
- **1.1** (apr 2026) — Cue выделен в отдельный Electron-app (ранее был tray-подсистемой Hone), репо-структура обновлена под Phase 5a реальность, добавлен §8 о независимых релизных циклах
- **1.0** (apr 2026) — initial

---

## 10a. Mock-interview voice v2 — на всех этапах (планируется)

Когда придёт время v2 (после text-MVP), голос идёт **на ВСЕ этапы**, не только behavioral:

- **HR** — AI озвучивает вопросы, пользователь отвечает голосом. Разговор как с реальным HR, не текстовый чат.
- **Algo / Coding** — после решения задачи AI задаёт follow-up вопросы голосом про код (например «почему такая сложность?», «как масштабируешь?»). Пользователь объясняет голосом — это намного ближе к реальному собесу, где defenses код перед интервьюером.
- **System Design** — AI комментирует диаграмму голосом, задаёт уточняющие вопросы по архитектуре, пока пользователь рисует.
- **Behavioral** — единственный этап, где voice уже планировался в text-MVP вообще не имеет text-fallback (целевое поведение).

**Стек (free, утверждён):**
- **TTS**: **Piper TTS** локально (MIT, ~50 MB модель, отличное качество русский+английский, деплой одним бинарём в `services/transcription` или новый `services/tts`).
- **STT**: **Whisper.cpp** локально, уже есть в `desktop/native/audio-mac/` для Cue — переиспользуем в backend.
- **«AI думает» индикатор**: пока STT транскрибирует или LLM генерирует — UI показывает анимированную заглушку (волны / pulse / «слышу тебя…») вместо тишины. Никаких пустых пауз.

**LLM-judge**: текстовый, поверх транскрипта. Никаких speech-моделей не нужно для оценки.

---

## 10. Mock-interview AI-toggle (новое в Wave 3)

Killer-фича web: **mock-собеседования с честным watermark'ом**.

При создании mock-сессии пользователь выбирает:
- **AI-allowed** — справа во время алго / sys-design / behavioral есть чат с нейрокой; можно спрашивать подсказки. Cue работает as-is.
- **AI-blocked** — классический mock: только ты, задачи, таймер. Так проходит реальный собес.

**Backend persistence:** `ai_mock_sessions.ai_assist BOOLEAN NOT NULL DEFAULT FALSE`. Default — strict mode, нужно явно opt-in'нуть подсказки.

**Cue enforcement (двухслойно):**
1. **`copilot.CheckBlock` RPC** — Cue desktop опрашивает на фокусе и каждые 30s в idle. Если возвращает `blocked: true, reason: 'mock_no_assist'` — Cue прячет hotkey, показывает заглушку «помощь отключена».
2. **`copilot.Answer` server-side check** — defense-in-depth: даже если Cue проигнорирует CheckBlock, вызов LLM возвращает `PermissionDenied`. Bypass невозможен на уровне сервиса.

**Fairness watermark:** каждый mock-result тегируется `ai_assist`. Insights-виджет «Mock signals» (см §12) сравнивает delta между «честно» и «с AI» — это объективная метрика готовности.

**Cue desktop работа (отдельный спринт `desktop/`):** poll CheckBlock + UI «помощь отключена» + handle 403 на Answer как hard-stop.

---

## 11. Cohort → Circles (Wave 2 — мерж)

Раньше параллельно жили `cohort` (команда внутри сезонов) и `circles` (комьюнити-кружок). Поскольку сезоны выпилены (`SeasonPage` удалена, season-сервис стёрт), cohort-концепт потерял смысл и слит в circles.

- **Backend:** `services/cohort/` целиком удалён, бутстрап-регистрация снята, proto + sqlc + generated stubs убраны. Миграция 00039 дропает таблицы `cohort_wars` / `cohort_members` / `cohorts`.
- **Frontend:** `/cohort/*` URL'ы редиректят на `/circles*`, `<CohortCard>` / `<CohortsPanel>` переписаны на circles API (`useMyCirclesQuery`). Profile-таб `Cohorts` переименован в `Circles`. WarRoomPage (cohort-incident-tracker, без UI-входа) удалён.
- **Cross-service:** `notify` и `feed` убрали `OnCohortWarStarted/Finished` хендлеры; `shared/domain/events.go` потерял `CohortWar*` события.

**Concept на будущее:** если понадобится «соревнование между circles», сделаем как event-type внутри circles, не отдельным сервисом.

---

## 12. Insights — analytics killer-feature (Wave 4)

Web-страница `/insights` (5-й пункт top-nav: Arena → Atlas → **Insights** → Circles → Codex → Vacancies → Slots) — единая аналитическая поверхность, агрегирующая данные из всех трёх клиентов.

**Источники данных (event bus):**
| Поверхность | Что отдаёт |
|---|---|
| web (arena/mock) | match outcomes, mock-score (с `ai_assist` watermark), kata solves, vacancy applications |
| Hone | focus-time, streak, notes-count, plan adherence (через `services/hone`) |
| Cue | вопросы пользователя (без PII, embedding-теги), время ответа, frequent-stuck patterns (новый event-stream — Phase C) |

**Архитектура:** `services/intelligence` (уже существует, обслуживает Hone-side daily-brief) расширяется web-facing RPC:
- `GetWeeklyIntel` — недельный digest (текстовая нарратива + ключевые метрики)
- `GetReadinessForecast` — Bayesian-классификатор поверх mock-сессий (только `ai_assist=false`) → готов / нужно N недель / какие пробелы критичны
- `GetAtlasUpdate` — auto-decay/mastery узлов на основе solves + mock-сессий (заменит статичный snapshot)

**Виджеты (skeleton сейчас, реализация поэтапно):**
- **Weekly Digest** (Phase A) — «твоя неделя за 30 секунд»
- **Readiness Forecast** (Phase C) — прогноз готовности к собесу
- **Focus Trend · 7d** (Phase B) — heatmap из Hone (переезжает с Profile · Stats)
- **Atlas Auto-Update** (Phase B) — preview блок со ссылкой на полный `/atlas`
- **Mock Signals** (Phase A) — delta between AI-allowed / AI-blocked mocks
- **Cross-Surface Aggregation** (Phase C) — таймлайн event-stream'а

**Этапность:**
- **Phase A** (1-2 недели) — events shape + ClickHouse sink + базовый weekly digest
- **Phase B** (2-3 недели) — UI `/insights` с реальными виджетами (Atlas-decay, Mock-trend, Focus-heatmap)
- **Phase C** (4+ недели) — AI-narration (LLM суммаризация digest), readiness forecast, Cue event ingestion

**Релокация Stats:** Profile · Stats таб остаётся пока (transitional); в Phase B переезжает целиком в `/insights`. Atlas остаётся standalone роутом, но preview-блок на Insights делает его «view внутри intelligence», а не отдельной целью.
