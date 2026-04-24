# Ecosystem — druz9 + Hone + Cue

> Как три поверхности связаны, что делает каждая, и главное — **чего НЕ делает каждая**.
> Версия 1.1 · apr 2026 · обновлено после Phase 5a (Cue стал отдельным приложением)

---

## 1. Три поверхности

| Поверхность | Mental mode | Что | Триггер открытия |
|---|---|---|---|
| **druz9.ru** (web) | «Арена» | Дуэли, мок-собесы, рейтинг, гильдии, турниры, полный Skill Atlas, Codex подкасты, магазин | «Хочу соревноваться / играть / смотреть» |
| **Hone** (desktop) | «Тихий кокпит» | Today plan, Focus sessions (pomodoro), приватные Notes, Whiteboard, Stats/streak | «Хочу фокусно работать над собой сегодня» |
| **Cue** (desktop tray-app) | «Наушник на ринге» | Невидимый AI поверх любой ОС, экран + вопрос → ответ за секунды | «Я застрял здесь и сейчас» |

Разные триггеры → три продукта не конкурируют, дополняют.

**Hone и Cue — два разных Electron-приложения.** Одна установочная история («установи druz9 suite») в будущем; сейчас два отдельных DMG. Решение о разделении принято в Phase 5a: смешение «тихий кокпит» и «stealth-оверлей» ломает mental model (см §2).

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
| Сразиться с кем-то live | web |
| Мок-собес (peer или AI) | web |
| Посмотреть полный Skill Atlas / рейтинг / сезон | web |
| Replay чужого решения, турнир, гильдия, Codex | web |
| Купить Pro / season pass | web |
| Спланировать день | **Hone** |
| Приватная заметка / диаграмма | **Hone** |
| Pomodoro + фокус над задачей | **Hone** |
| Streak, focus-heatmap личная | **Hone** |
| Ежедневный «что сегодня важного» | **Hone** |
| Застрял в IDE | **Cue** |
| На собесе/звонке нужен быстрый ответ | **Cue** |
| Live-transcript встречи + auto-suggest | **Cue** |
| RAG по приложенным документам (CV / JD) | **Cue** |

---

## 4. Общие слои

- **Auth:** единый `druz9 Pro` токен (Yandex/Telegram OAuth через `backend/services/auth`). Hone и Cue используют keychain (`keytar`) и читают тот же access token.
- **Skill Atlas:** хранится в `services/profile`, читается всеми тремя поверхностями (Hone — для Today-плана через `honeSkillAtlasAdapter`).
- **Focus-time / streak:** пишется Hone → `hone_streak_days` → агрегируется в профиле на web для публичного пассивного режима.
- **LLM chain:** один `backend/shared/pkg/llmchain` (Groq → Cerebras → Mistral → OpenRouter → Ollama floor). Hone и Cue вызывают разные task'и (`TaskDailyPlanSynthesis` / `TaskSysDesignCritique` / `TaskCopilotStream` / `TaskCodingHint` / …).
- **Deep links:**
  - `druz9://task/dsa/p-102` — открыть задачу на druz9.ru (из Hone Today)
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

- **1.1** (apr 2026) — Cue выделен в отдельный Electron-app (ранее был tray-подсистемой Hone), репо-структура обновлена под Phase 5a реальность, добавлен §8 о независимых релизных циклах
- **1.0** (apr 2026) — initial
