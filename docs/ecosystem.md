# Ecosystem — druz9 + Hone + Stealth

> Как три поверхности связаны, что делает каждая, и главное — **чего НЕ делает каждая**.
> Версия 1.0 · apr 2026

---

## 1. Три поверхности

| Поверхность | Mental mode | Что | Триггер открытия |
|---|---|---|---|
| **druz9.ru** (web) | «Арена» | Дуэли, мок-собесы, рейтинг, гильдии, турниры, полный Skill Atlas, Codex подкасты, магазин | «Хочу соревноваться / играть / смотреть» |
| **Hone** (desktop) | «Тихий кокпит» | Today plan, Focus sessions (pomodoro), приватные Notes, Whiteboard, Stats/streak | «Хочу фокусно работать над собой сегодня» |
| **Stealth Copilot** (tray внутри Hone) | «Наушник на ринге» | Невидимый AI поверх любой ОС, экран + вопрос → ответ за секунды | «Я застрял здесь и сейчас» |

Разные триггеры → три продукта не конкурируют, дополняют.

---

## 2. Правило несамокания (жёсткое)

> **Desktop ПОТРЕБЛЯЕТ данные из web и оборачивает focus-слоем. Desktop НЕ создаёт контент.**
>
> **Stealth — ситуативный, не хранит состояние основного продукта.**

Проверка: если пользователь может сказать «зачем мне X, если есть Y» — значит каннибализация, режем.

---

## 3. Что где живёт

| Намерение пользователя | Где |
|---|---|
| Сразиться с кем-то live | web |
| Мок-собес (peer или AI) | web |
| Посмотреть полный Skill Atlas / рейтинг / сезон | web |
| Replay чужого решения, турнир, гильдия, Codex | web |
| Купить Pro / season pass | web |
| Спланировать день | **desktop** |
| Приватная заметка / диаграмма | **desktop** |
| Pomodoro + фокус над задачей | **desktop** |
| Streak, focus-heatmap личная | **desktop** |
| Ежедневный «что сегодня важного» | **desktop** |
| Застрял в IDE | **stealth** |
| На собесе/звонке нужен быстрый ответ | **stealth** |

---

## 4. Общие слои

- **Auth:** единый токен (Yandex/Telegram OAuth через `backend/services/auth`)
- **Skill Atlas:** хранится в `services/profile`, читается всеми тремя поверхностями
- **Focus-time:** пишется Hone → агрегируется в профиле на web
- **Deep links:**
  - `druz9://task/dsa/p-102` — открыть задачу на druz9.ru
  - `druz9://focus/start?task=dsa/p-102` — открыть Hone в Focus-режиме
  - `druz9://hone/notes/new` — новая заметка в Hone

---

## 5. Монетизация

**Одна подписка `druz9 Pro` (~790 ₽/мес)** даёт Pro-фичи везде:

| Поверхность | Free | Pro |
|---|---|---|
| druz9.ru | базовая Arena, подкасты, общий Atlas | расширенный Atlas, турниры, season pass |
| Hone | canvas, Pomodoro, Notes без AI, Stats, Whiteboard без AI | AI-planner, AI-connections, AI-critique |
| Stealth | — | включён |

Без Pro Stealth не работает — это ключевой платящий хук.

---

## 6. Репо-структура (target)

```
druzya/
├── backend/
│   ├── services/
│   │   ├── auth, profile, arena, ai_mock, ai_native, editor,
│   │   │   rating, guild, season, daily, slot, podcast, notify, admin
│   │   └── hone/          NEW — focus/notes/wb/plan для Hone
│   ├── shared/pkg/llmchain/   (common)
│   └── migrations/        (append)
├── frontend/              druz9.ru (web arena)
├── desktop/               Electron: Hone main window + Stealth subsystem
│   └── src/renderer/screens/
│       ├── hone/          NEW main window + panels + ⌘K
│       ├── compact/       EXISTING stealth compact
│       ├── expanded/      EXISTING stealth expanded
│       └── ...            onboarding, settings, toast
├── proto/druz9/v1/
│   ├── (existing 14 сервисов)
│   └── hone.proto         NEW
├── docs/
├── druz9-bible.md         web-продукт (existing)
├── hone-bible.md          NEW
├── stealth-bible.md       NEW
└── ecosystem.md           этот файл
```

---

## 7. User journey (day in the life)

- **07:00** — Open Hone. AI Plan готов: «задача X, mock в 18:00, review PR #421».
- **09:30** — Start focus session → Hone диплинкнул задачу → браузер открыл druz9.ru/daily/p-102.
- **13:00** — Работа. Застрял в legacy-коде. `⌘⇧Space` → Stealth видит экран, отвечает.
- **18:00** — Mock interview. Открывается web (не в Hone — там peer/AI живые).
- **22:00** — Закрыл ноут. Hone тихо записал focus-heatmap. Streak +1.

Три продукта — один ритуал.
