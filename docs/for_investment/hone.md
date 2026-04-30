# Hone — тихий кокпит разработчика

Минималистичное desktop-приложение, в которое разработчик возвращается каждый день. Часть экосистемы druz9.

> **One-liner:** «Sharpen your craft daily. Quietly.»

## Что это

Один чёрный экран. План на день, помодоро-таймер, приватные заметки, whiteboard, статистика. Всё вызывается с клавиатуры через ⌘K. Никаких меню, никаких уведомлений, никакого шума.

Параллельно — потребление контента из экосистемы: подкасты, real-time editor rooms, multiplayer whiteboard, ивенты твоих circles.

## Какую проблему решает

Разработчик собирает свой день по 5 приложениям: Notion для заметок, Todoist для задач, LeetCode/druz9 для практики, Cal для встреч, Spotify для подкастов. Каждое требует внимания, каждое уводит в свою экосистему.

Hone — **одна поверхность** для ежедневного ритуала: «что сегодня → работаю над этим → отметил, что сделал → послушал, что хотел». Без переключения контекста.

## Ключевые фичи

| Модуль | Хоткей | Что делает |
|---|---|---|
| **Today** | `T` | AI-план дня из Skill Atlas + календаря + tutor-assignments. 3-5 пунктов с обоснованием |
| **Focus** | `F` | Pomodoro + закреплённая задача + рефлексия → авто-заметка |
| **Notes** | `N` | Markdown + AI-связи (cosine over embeddings) |
| **Whiteboard** | `D` | tldraw + ⌘E AI-критика + сохранение как заметка |
| **Reading** | `R` | English-loop: библиотека materials, click-on-word → vocab queue, AI-summary check, SRS daily review |
| **Writing** | `W` | English-loop: draft → AI inline-фидбэк (грамматика + vocab) → save-to-Notes |
| **Listening** | `L` | English-loop: библиотека audio + transcript, native player с speed picker 0.5×–2×, click-on-word → общая SRS-очередь |
| **Code review** | `G` | Engineering-loop: paste diff + review → AI grade (correctness/completeness/clarity/tone) |
| **Assignments** | `A` | Tutor-pushed задания (overdue / due-soon / open stripe + ✓ Done) |
| **Calendar** | `M` | Tutor-scheduled 1-on-1 sessions с reminders T-24h/1h/now + JOIN-link + session-note по completed |
| **TaskBoard** | — | Kanban-доска поверх дневного плана |
| **Stats** | `S` | Focus heatmap, streak, 7-дневные бары |
| **Podcasts** | `P` | Плеер + прогресс-трекер (стрим из druz9) |
| **Editor rooms** | `E` | Real-time коллаб (Yjs + CodeMirror) |
| **Shared boards** | `B` | Multiplayer Excalidraw |
| **Events** | `V` | Календарь ивентов твоих circles |
| **Coach** | — | Read-only feed past briefs от AI-coach (intelligence layer) |

⌘K палитра — единый вход во всё.

## ДНК продукта

- **Тёмный, тихий.** Один чёрный canvas, везде Esc возвращает в пустоту. Минимум визуального шума.
- **Keyboard-first.** Никаких меню, никаких toolbar'ов. Всё через хоткеи.
- **AI плавно.** Не задрачивает «давай я тебе помогу». Появляется только когда есть смысл (план дня, связи между заметками, критика whiteboard).
- **Приватность.** Notes и Whiteboard живут локально и не расшариваются по умолчанию. Stats — твои.
- **Радикальный минимализм.** Если на экране больше двух визуальных групп — переверстать.

## Что Hone НЕ делает

- ❌ Не решает задачи (deep-link на druz9.online)
- ❌ Нет арены, mock, рейтингов (это веб)
- ❌ Нет stealth / global hotkey / hidden window — это подпись Cue
- ❌ Не создаёт ивенты / circles (создаются на вебе, Hone только показывает)

Если фича вызывает «зачем мне Hone, если есть druz9.online» — она не Hone, она веба.

## Как используется в экосистеме

- **Daily hook.** Хоум-страница ежедневного использования, главный driver retention.
- **Focus → Stats → Insights.** Фокус-сессии пишутся в backend, агрегируются в Insights на вебе. Hone — главный поставщик «качественных» событий.
- **Consumption surface.** Подкасты, editor rooms, multiplayer boards живут в Hone (уютнее, чем в браузере).

## Дифференциация

- **Winter / Linear / Things 3 эстетика + AI.** На рынке РФ нет десктоп-приложения с такой эстетикой и встроенным AI под рост разработчика. Cursor — IDE. Raycast — лаунчер. Notion — wiki. Hone — единственный продукт под «ежедневный ритуал разработчика».
- **Free-tier приучает.** Pomodoro + Notes + Stats без AI бесплатны и достаточны как daily-companion. Pro доплачивается за AI-планер, AI-связи, AI-критику.
- **Часть экосистемы.** Hone один не имел бы Insights. Связка с druz9.online — самостоятельный моат.

## Статус

Phase 6.5 закрыта + Wave 4 English-loop закрыт (apr 2026). Public beta идёт. macOS (arm64 + x64) с notarized DMG, electron-updater, Sentry. В планах Q3 — Windows-порт.

Технически: Electron + Vite + React 18, Connect-RPC к Go-бэкенду, ~18 страниц, AI-фичи через `llmchain` (Groq → Cerebras → Mistral → OpenRouter). English-loop с Leitner SRS поверх backend `services/hone/` — vocab queue общая для Reading/Listening + summary grader + writing grader + code-review grader через free-tier LLM. Tutor surfaces (assignments + calendar + reminders) — отдельный пайплайн поверх `services/tutor/` с client-side OS-notification scheduler (T-24h/1h/now с localStorage dedup).

## Метрики, которыми меряем

- DAU и D7 retention (главное: вернулся ли через неделю).
- Weekly focus-hours per active user — северная звезда.
- ⌘K → action conversion в воронке.
- Free → Pro conversion (триггер — попытка открыть AI-план / AI-связи).
