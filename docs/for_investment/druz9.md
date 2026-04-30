# druz9.online — арена + аналитика

Веб-продукт экосистемы. Сайт, на котором разработчик соревнуется, готовится к собеседованиям и видит свой прогресс.

## Что это

Платформа подготовки к техническим собеседованиям с фокусом на честность результата и измеримый прогресс. Не курсы, не учебник — тренажёр + аналитический слой.

## Какую проблему решает

Подготовка к собесу сегодня — это собрать кашу из LeetCode (задачи без контекста), YouTube (теория без практики), pramp (партнёр пропадает), знакомых (нерегулярно). Никто не показывает «насколько ты готов» объективно.

druz9.online даёт:

- **Mock-собеседования** с двумя режимами: AI-allowed (тренировка с подсказками) и AI-blocked (как на реальном собесе). Watermark делает результат сравнимым.
- **Арена 1v1 / 2v2** — соревновательный режим в реальном времени. Эндорфины + рейтинг.
- **Insights** — агрегат «твоя неделя за 30 секунд», прогноз готовности, drop-off навыков.

## Ключевые фичи

| Фича | Что | Кому ценно |
|---|---|---|
| **Mock-interview** | HR / Algo / SD / Behavioral этапы. AI-режим: справа чат-помощник. Strict-режим: только ты, задачи, таймер | Разработчик за 1-3 месяца до собеса |
| **Arena 1v1 / 2v2** | Live-матчи на алгоритмических задачах. Рейтинг, лидерборды | Тот, кто хочет регулярную практику без самодисциплины |
| **Insights** | Weekly Digest, Readiness Forecast, Mock Signals (delta «честно / с AI»), Atlas Auto-Update | Любой, кто пишет на платформе ≥ недели |
| **Skill Atlas** | Дерево навыков с состоянием (mastered / weak / blind-spot). Auto-update от solves и mock-результатов | Тот, кто не знает «куда копать дальше» |
| **Codex** | Статьи / гайды / разборы | Read-mode пользователи, SEO |
| **Circles + Events** | Комьюнити-кружки, ивенты типа Book Club | Удержание + viral loop |
| **Clubs** | Структурированная витрина TG-каналов: curriculum, sessions, RSVP, recordings | Распределение content-production на curators + landing для виральности |
| **Tracks** | Curated learning programmes (5 курируемых треков, 43 шага) | «Куда копать» — пошаговый путь под выбранный role |
| **Tutor dashboard** | Invite-flow, per-student heatmap, AI pre-session brief | Distribution channel — тутор приводит платящих студентов |
| **Vacancies + Slots** | AI-разбор вакансии, бронь mock-интервьюера | Активная фаза поиска работы |

## Как используется в экосистеме

- **Точка входа** — сайт публичный, индексируется, partнёрки и Codex ведут сюда.
- **Производит контент** — ивенты создаются здесь, mock-сессии стартуют здесь, vacancies живут здесь.
- **Аналитический хаб** — Insights агрегируют события из Hone (focus, streak) и Cue (паттерны вопросов).
- **Воронка к Pro** — бесплатный Atlas / arena цепляет, mock + Insights требуют Pro.

## Дифференциация

- **Watermark на mock-сессиях.** Никто из конкурентов не делает «strict-mode без AI» с честным разделением метрик. Это превращает результаты в объективную валюту, а не в гайки от вентилятора.
- **Insights поверх трёх клиентов.** Web + Hone + Cue → один аналитический слой. Конкуренты видят либо solves (LeetCode), либо calendar (Cal), либо звонки (Cluely) — никто не видит всё.
- **Honestly free-tier.** Бесплатный Atlas + 5 mock-сессий/мес. Никаких dark-patterns с paywall в середине задачи.

## Статус

Web запущен, ~32 сервиса в Go-монолите, 60+ страниц в SPA. Mock-interview, arena, Insights работают в проде. ADR-001 Phase-4 переориентировал сайт с RPG-витрины на «арена + аналитика» — удалены 18 страниц, 4 backend-сервиса, оставлен фокус на killer-фичу (mock + insights).

**Wave 0-4 закрыты (apr 2026):** multi-track (dev_middle / dev_senior / english / sysanalyst-pending), English HR mock-round, Senior dev pack (System Design + Tech Lead), Hone English Reading-loop. Tutor MVP (Tier 1 dashboard + invites) closed end-to-end. Clubs MVP — публичная витрина TG-mirror с RSVP.

## Метрики, которыми меряем

- DAU / WAU / MAU.
- Mock sessions per active user per week.
- Conversion free → Pro (триггер — попытка открыть Insights / mock-сессию свыше лимита).
- Strict-mode share (показатель доверия к watermark).
