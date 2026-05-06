# docs/feature — текущие инициативы

Только активные инициативы. Закрытые волны не храним (история живёт в коде / git log).

**Последнее обновление:** 2026-05-01

## Содержание

| Файл | О чём |
|---|---|
| [identity.md](./identity.md) | Кто мы, кто не мы, какие 3 трека делаем, drop-list |
| [ai-tutor.md](./ai-tutor.md) | AI-tutor architecture (4-слойная память) — день 1+2+3 закрыты |

## Стратегический контекст (TL;DR)

druz9 = **AI-coach с памятью + free tutor-toolkit + Hone focus-app** для подготовки senior IT-разрабов к собесу. 3 трека: **Go senior / ML engineering / English**.

Двусторонний рынок без денежного шага: тутор бесплатно получает toolkit (assignments, snapshot, brief, calendar, reading library), приводит своих студентов через invite-код. Студенты получают AI-coach 24/7 + AI-mock + Atlas + Hone между сессиями с тутором.

## Что строим

См [identity.md](./identity.md). Маркетплейс / `tg_coach` / `feed` / `clubs` / `arena` / `lobby` / `slot` / `rating` / `events` / `daily` / `quiz` уже выпилены (Wave R0-Wave6). Текущий фокус — Phase 8 (tutor pages) / 9 (web editor cursor labels) / 12 (welcome) — см [implementation-plan.md](./implementation-plan.md).

## Правила работы с папкой

1. Активная инициатива → файл в этой папке. Закрылась → удаляем
2. Каждый файл self-contained, читается отдельно
3. Decision log в начале файла: цель → tradeoffs → план. Не narrative
4. **При расхождении с реальностью — доверяй коду и обновляй документ**
