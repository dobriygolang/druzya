# druz9.online — AI-coach + arena + atlas

Веб-продукт экосистемы. Сайт, на котором разработчик готовится к собесу, растёт по треку и видит свой прогресс — не курсы, не учебник, а **тренажёр + аналитический слой + AI-coach с памятью**.

## Какую проблему решает

Подготовка к собесу / рост сегодня — каша из LeetCode (задачи без контекста), YouTube (теория без практики), pramp (партнёр пропадает), знакомых (нерегулярно). Никто не показывает «насколько ты готов» объективно.

druz9.online даёт:

- **AI-mock с 5-axis radar per role** (Go senior · MLE · DE · English HR · sysdesign · DevOps · QA · sysanalyst · product analyst · tech lead). Two режима: AI-allowed (тренировка с подсказками) и AI-blocked (как на реальном собесе). Watermark делает результат сравнимым.
- **AI-tutor с 4-layer памятью** (snapshot / facts / summary / episodes per persona). 7 personas: algo coach · sql mentor · system design guru · english coach · go coach · ml coach · de mentor. Все display_name role-only lowercase — юзер не путает с реальным человеком.
- **Skill Atlas** — дерево навыков с external_resources jsonb (link на Strang / mlcourse / DDIA / Kaggle / NeetCode). Atlas custom-nodes: user-pinned topics + auto-promote алгоритм (5+ users + avg quality ≥ 0.7 + LLM validation → curated supplement).
- **Codex opinion-pieces** — короткие 600-словные bridge theory↔practice. Наш голос, не replacement Strang.
- **Insights** — агрегат «твоя неделя за 30 секунд», прогноз готовности, drop-off навыков.

## Ключевые фичи

| Фича | Что | Кому ценно |
|---|---|---|
| **AI-mock** | 5-axis rubric per role (Go/MLE/DE/English HR/sysdesign). AI-режим vs Strict-режим watermark. Pluggable evaluators | Разработчик за 1-3 месяца до собеса |
| **AI-tutor** | 4-layer memory chat. Personas role-only. Track-aware (commit / explore mode) | Кто хочет «персонального ментора» без paid tutor |
| **Skill Atlas** | Дерево навыков с external_resources (link, не build). User-pinned + auto-promote | Кто не знает «куда копать дальше» |
| **Codex** | Opinion-pieces (~600 слов) bridging theory→practice | Read-mode пользователи, SEO |
| **Tracks** | Curated learning programmes (Go senior · ML engineering · English). 3 трека, ~43 шага | Пошаговый путь под выбранную role |
| **Tutor toolkit** | Free tutor-dashboard: invite flow, per-student heatmap, AI pre-session brief, shared atlas, assignment push в Hone TaskBoard | Distribution channel — тутор приводит платящих студентов через invite-код |

## Как используется в экосистеме

- **Точка входа** — сайт публичный, индексируется, Codex и tutor invites ведут сюда.
- **Производит контент** — atlas-узлы, mock pools, codex articles живут здесь.
- **Аналитический хаб** — Insights агрегируют focus/streak из Hone + reflection из Hone TaskBoard + mock results.
- **Воронка к Pro** — бесплатный Atlas + 1 mock/нед цепляет; AI-tutor с памятью + безлимитный mock + Insights требуют Pro.

## Дифференциация

- **Watermark на mock-сессиях.** Никто из конкурентов не делает «strict-mode без AI» с честным разделением метрик. Это превращает результаты в объективную валюту.
- **AI-coach + кокпит + наушник как один продукт.** Web + Hone + Cue → один аналитический слой + общая coach memory. Конкуренты видят solves (LeetCode), calendar (Cal), звонки (Cluely) — никто не видит всё.
- **Free-tier honestly.** Бесплатный Atlas + 1 mock-сессия/нед. Никаких dark-patterns с paywall в середине задачи.
- **Curation = ranking-proxy.** Не клонируем Strang/mlcourse — линкуем на best-in-class через `external_resources` jsonb. Unique слой: AI-mock + Codex + AI-tutor + Hone + Intelligence.

## Статус (2026-05-05)

Web в production. ~30 сервисов в Go-монолите, multi-package contract через Connect-RPC. Frontend SPA: 60+ страниц.

**Архитектурные решения 2026-05-04:**
- Идентность сужена: 3 трека (Go senior · ML · English). Boosty marketplace выпилен — двусторонний рынок без денежного шага через free tutor toolkit.
- Curation pivot: ranking-proxy на external_resources, не курсовая платформа.
- Phase 3.5 (DB v65, 2026-05-05): personal resource library + adaptive AI — user добавляет свои ресурсы / hide curated / mark unhelpful / replace. Auto-promote algorithm (Sergey Path C: NO admin approval gate).
- Phase 9a (DB v66, 2026-05-05): standalone collab rooms (code/whiteboard) low-key — discovery только через tutor/mock/club/Settings.

**Удалено за 2026-04 / 05 ADRs:**
- Arena 1v1/2v2 + lobby / matchmaker / ELO — pivot на single-track AI-coach.
- Slot/Rating/Review/Events — заменены на tutor session + invite flow.
- Friends graph — социальный слой через Telegram channel + circles.
- Boosty marketplace — заменён на free tutor toolkit с двусторонней привлекательностью без fee.
- Quiz/Daily — заменены на Coach next-action + reflection grade.

## Метрики

- DAU / WAU / MAU.
- AI-mock sessions per active user per week.
- Conversion free → Pro (триггер — попытка открыть AI-tutor with memory / превысить mock cap).
- Strict-mode share (показатель доверия к watermark).
- Tutor invite chain depth (Y1 target ≥ 1.6 students per active tutor).
