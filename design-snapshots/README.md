# druz9 — design snapshots

Статичные HTML-копии ключевых экранов **druz9** для обсуждения дизайна с Claude Design (или любым внешним дизайнером).

## Что это
- Self-contained HTML файлы — Tailwind CDN + inline design-tokens (CSS-переменные точно те же, что в проде)
- Реалистичный mock-контент (русские имена, реальная типографика, актуальные секции)
- Открываются в браузере прямо отсюда — никакого сборщика не нужно
- Передают **визуальный язык**, layout, spacing и component patterns. Анимации и interactivity опущены.

## Файлы

| Файл | Что показывает |
|---|---|
| `index.html` | Лендинг + navigation + полный design-tokens overview (цвета, градиенты, типографика, radii) |
| `sanctum.html` | **Главный экран** после логина. Daily kata, streak, гильд-вар, активность, leaderboard, AI coach, arena CTAs |
| `arena-match.html` | **Live PvP редактор**. Split-screen: задача / код / opponent feed. Timer, tests, submit |
| `atlas.html` | **⚠ дизайн-debt.** Skill graph SVG — текущее broken state + target requirements |
| `match-end.html` | **Emotion peak.** Победный экран после ranked. Promote, ачивки, статы, replay |
| `achievements.html` | Grid-pattern. 38 ачивок, фильтры по статусу/тиру, 3 состояния (unlocked / progress / hidden) |
| `vacancies.html` | Новый bounded context. Filter sidebar + cards со skill-gap визуализацией |
| `cohorts.html` | **Wave-9 NEW.** Учебные когорты до 50 чел: каталог + детали + общий streak + invite-link + leaderboard |
| `podcasts.html` | **Wave-9 NEW.** Кастомный плеер (seek/skip 15/volume/speed) + главы + транскрипт + premium-CTA |
| `settings.html` | **Wave-9 UPDATED.** Sidebar nav + новый ✨ AI Coach model picker (free/💎premium) + 4 языка (RU/EN/KZ/UA) |
| `weekly-report.html` | **Wave-9 NEW.** KPI strip · AI Coach narrative · 4-нед SVG-чарт · сильные/слабые секции · share-link |

## Как использовать с Claude Design

1. **Открой `index.html`** в браузере — увидишь лендинг с дизайн-токенами и ссылками на все экраны
2. **Создай новый чат с Claude Design** и приложи (через drag-n-drop / paste)
   - либо весь folder `design-snapshots/`,
   - либо конкретные файлы по теме обсуждения (например, только `atlas.html` если хочешь починить именно его)
3. Сопроводи коротким брифом — что обсуждаем, что нравится, что нет

### Пример первого сообщения Claude Design

> Привет. Я строю **druz9** — gamified платформу подготовки к собесам Big-Tech (RU+EN, dark-first, esports-analytics aesthetic). Прикладываю HTML-снапшоты ключевых экранов.
>
> Хочу обсудить **3 темы** по приоритету:
>
> 1. **Atlas** (`atlas.html`) — главный design-debt. Сейчас broken, в файле есть «before / after» секции с конкретными требованиями. Дай вариант layout-а.
> 2. **Match End** (`match-end.html`) — emotion peak. Сейчас sober, хочется «вау» при victory. Что усилить?
> 3. **Brand consistency** — пройдись по `sanctum.html` и `vacancies.html`, найди inconsistency в spacing / weight / colour-usage. Что унифицировать?
>
> Stack: React 18 + Tailwind 3.4 + framer-motion. Component lib уже есть (Card, Avatar, Button, Badge). Дай конкретные изменения, я смогу приложить руки.

## Не вошло в snapshots

Опущено для скорости — могу досделать на запрос:
- `welcome` / `login` / `onboarding` — entry-point flow
- `friends` / `notifications` — социальные паттерны
- `daily/streak` (KataStreak) — year-grid
- `mock` (voice interview) — voice UI с waveform
- `weekly-report` — analytics dashboard
- `mobile` view любой страницы (sm/md breakpoints)

## Технические детали

- **Дизайн-токены** инлайн в каждом файле через `<style>` + Tailwind config
- **Шрифты** грузятся из Google Fonts CDN (Inter, Geist, Geist Mono)
- **Tailwind** через `cdn.tailwindcss.com` — не для прода, но идеально для статичных мокапов
- **Темы** — только dark (соответствует prod default); light theme поддерживается через переключение `.dark` ↔ `.light` на `<html>`
- **JS** — нулевой. Только разметка + стили
