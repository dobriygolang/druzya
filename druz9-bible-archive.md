# druz9 — Product & Engineering Bible
> Полный технический документ проекта. Версия 3.0.
> Домены: druz9.online · druz9.ru
> Языки: русский (основной), английский

> **⚠️ Pivot v3.0 (apr 2026):** ушли от Dark Fantasy RPG (Cinzel/золото/пергамент) в сторону современного modern dark UI (Inter/Geist/Tailwind, violet+cyan акценты, bento-сетка, glassmorphism). Причина — RPG-эстетика отпугивает senior-разработчиков и enterprise-аудиторию, делает продукт несерьёзным. Геймификация осталась в механиках (LP, гильдии, season pass, hero cards), но визуально — clean и professional как Linear/Vercel/Raycast. Старые HTML-мокапы и Storybook удалены. Источник правды дизайна — Pencil-файл `design/v2/druz9.pen`. Реализация во фронтенде — `frontend/src/` (45 страниц, 5 переиспользуемых компонентов в `src/components/`, токены в `frontend/tailwind.config.ts`). Список **отменённых** RPG-механик: Hardcore mode, Cursed tasks, Prestige, Skill Decay (порча), персонаж-аватар как SVG-геометрия (заменён на gradient-аватар), карьерная линия Junior→Principal (упрощено до численного рейтинга). Список **переименованного**: AI-mock vs bot → "AI Mentor Sparring" (без таймера/LP, AI учит а не соревнуется). Полный список того что осталось — в §3.

---

## Содержание

1. Концепция и позиционирование
2. Визуальный язык и дизайн-система
3. Модули платформы
4. Уникальные фичи (нет нигде)
5. Архитектура системы
6. База данных
7. Инфраструктура и деплой
8. AI-интеграция
9. Геймификация и прогрессия
10. Монетизация
11. Безопасность
12. Метрики и аналитика
13. Open Source и контрибьюторы
14. Дорожная карта
15. Промпты для AI-инструментов

---

## 1. Концепция и позиционирование

**druz9 (Друзья)** — платформа подготовки к техническим собеседованиям, построенная как тёмная RPG-игра. Пользователь не «проходит курс» — он прокачивает персонажа, ходит в подземелья компаний, воюет в гильдиях и строит уникальный билд навыков.

### Аудитория
Разработчики от джуна до сеньора, готовящиеся к собесам в российские и международные IT-компании.

### Чем отличается от конкурентов
LeetCode, Interviewing.io, Прогрейд — все они инструменты. druz9 — это игра, в которую хочется возвращаться. Разница не в задачах, а в формате и опыте.

### Платформа
Web-first (React SPA), затем мобильное приложение. Активная практика — десктоп. Мобилка — прогресс, подкасты, быстрые задачи.

---

## 2. Визуальный язык и дизайн-система

### Концепция (v3.0)
**Modern dark professional** — референс Linear, Vercel, Raycast, Arc Browser, Riot client. Чистый dark UI, bento-сетка, лёгкий glassmorphism, subtle violet+cyan акценты. Цель — выглядеть как **серьёзный pro-tool**, чтобы senior'ы не отворачивались, а enterprise покупал. Геймификация остаётся в механиках, не в украшениях. Без Cinzel, без золотых рамок, без рун, без SVG-персонажа.

Аватары — gradient-кружки (генерируются из инициалов + двух tailwind-цветов на базе хеша nick). Иконки — Lucide. Карточки — `rounded-xl` с `surface-2` фоном и тонкой границей `#222233`.

Источник истины дизайна — `design/v2/druz9.pen` (Pencil-файл, 60+ экранов). Реализация — `frontend/src/` + Tailwind-токены в `frontend/tailwind.config.ts`.

### Цветовая палитра
Все цвета — CSS-переменные из `frontend/src/styles/main.css` (поддерживаются dark + light темы). Tailwind-классы используют `rgb(var(--color-X) / <alpha-value>)`.

```
bg               #0A0A0F   — основной фон (OLED-ish)
surface-1        #141425   — базовый surface
surface-2        #1A1A2E   — карточки
surface-3        #2D1B4D   — фиолетовый акцент-surface
border           #222233   — стандартная граница 1px
border-strong    #2A2A3F   — усиленная

text-primary     #FFFFFF   — основной текст
text-secondary   #C0C0C0   — вторичный
text-muted       #8A8A9E   — приглушённый

accent           #582CFF   — primary CTA, фиолетовый
accent-hover     #6D43FF
success          #10B981   — победа, прогресс
danger           #EF4444   — ошибка, поражение
warn             #FBBF24   — предупреждение, серия
cyan             #22D3EE   — статистика
pink             #F472B6   — highlights, ачивки
```

Light тема — те же имена, инвертированные значения (см. `main.css`).

### Типографика
- **Headings:** Geist (700–800), от h4 18px до h1 48px
- **UI / body:** Inter (400–600)
- **Mono / code / labels:** Geist Mono / JetBrains Mono fallback

Все шрифты грузятся через Google Fonts (`display=swap`).

### Радиусы и тени
- Радиусы: `sm 6 · md 8 · lg 12 · xl 16 · 2xl 20`
- Тени: `glow` (фиолетовая 0 6 24 #582CFF40 — на primary CTA), `card` (subtle), `glow-pink`, `glow-warn`

### Анимации
Framer Motion. Page transitions (fade+slide 250ms easeOut), hover/tap scale на Button/Card, stagger children в Sanctum, pulse-dot для live-статусов. Респектит `prefers-reduced-motion`.

### Иконки
[Lucide React](https://lucide.dev). Никаких рунических символов.

### Компоненты-ядро (frontend/src/components/)
- `AppShell` — wrapper с TopNav (logo + nav + search + bell + avatar + theme toggle + lang switcher)
- `Button` — variants: primary/ghost/danger, sizes sm/md/lg, loading/disabled/icon
- `Card` — variants: default/elevated/gradient/selected, interactive hover, compound parts (Header/Body/Footer)
- `Avatar` — sizes sm/md/lg/xl, 6 gradient presets, status dots (online/in-match/streaming), tier rings
- `Tabs` — variants: pills/underline/segmented, ARIA-compliant + keyboard nav

### Навигация
TopNav (height 72): `[ logo + druz9 ]   [ Sanctum · Arena · Kata · Guild · Atlas · Codex · Friends · Help ]   [ search · theme · lang · bell · avatar ]`

На мобиле: nav прячется в hamburger-drawer справа.

Игровые названия разделов (не переводятся):
- **Sanctum** — главный хаб (Dashboard)
- **Arena** — PvP режимы
- **Guild** — гильдии и войны
- **Atlas** — skill tree
- **Codex** — подкасты и обучение
- **Kata** — daily/weekly tasks
- **Friends** — социальное

### Layout
- Desktop: TopNav 72px + `<main>` с `px-20` (большие экраны), `px-4–8` (мобила)
- Bento-сетка с `gap-5/6` между карточками
- Sidebars (если есть на странице) — `w-[380px]` desktop / `w-full` mobile, стакаются вертикально под `lg:`
- Никакого фиксированного character-сайдбара

### Theme + i18n
- Dark/light toggle (`src/lib/theme.ts`) — Sun/Moon в TopNav, picker в Settings → Внешний вид
- RU/EN switcher (`src/lib/i18n.ts`) — Languages icon в TopNav, picker в Settings → Внешний вид
- Все ключевые экраны переведены. Остальные — `// TODO i18n`

### Адаптив
Mobile-first (390px → 1440px). Все 45 страниц responsive: `px-` уменьшается, многоколонные layouts стакаются вертикально под `lg:`, тяжёлые multi-pane (editor) сворачиваются в вертикальный stack или скролл.

### Что НЕ используем
❌ Cinzel / Cormorant / любые ornate fonts
❌ Золотой акцент `#c8a96e`
❌ L-образные угловые орнаменты, `✦ ✦` разделители, рунические иконки
❌ Pergament-фоны, металлические рамки, "panel-foot"
❌ SVG-персонаж (avatar — простой gradient circle)
❌ "Cut corners" clip-path кнопки

---

## 3. Модули платформы

### 3.1 Совместный редактор кода

Базовая комната для совместной работы. Фундамент всех активных режимов.

**Функциональность:**
- Совместное редактирование в реальном времени (Liveblocks / Yjs)
- Роли: владелец, интервьюер, участник, зритель (readonly)
- Monaco Editor: Go, Python, JavaScript, SQL
- Запуск кода и проверка тестов через Judge0
- Таймер сессии, выбор языка и шаблона задачи
- Freeze-режим: интервьюер замораживает редактирование
- Панель заметок справа (для интервьюера или AI)
- История изменений (таймлайн diff)
- Ссылка-приглашение, сохранение итогового решения

**Уникальная фича — Replay сессии:**
Сохраняется полный таймлайн набора кода — паузы, откаты, правки. Можно перемотать как видео и увидеть себя со стороны.

### 3.2 AI Mock Review

Симуляция полного технического интервью с ИИ. Главный PvE-режим.

**Секции:** Leetcode, SQL, Go, System Design, Behavioral

**Функциональность:**
- Выбор: компания, секция, уровень сложности, длительность
- Бриф перед началом: критерии оценки, формат
- AI-интервьюер задаёт вопросы по ходу решения
- Умные интервенции: если застрял — наводящий вопрос; уходит не туда — мягкий редирект
- Проверка решения автотестами + AI-анализ корректности
- Follow-up вопросы после решения (текст или голос)
- Голосовой режим: полный мок только голосом через Web Speech API
- Итоговый отчёт: ошибки, сильные стороны, рекомендации
- Результат сохраняется в профиль и skill atlas

**Компании = Подземелья:**
```
Normal: Avito, VK, Сбер
Hard:   Ozon, Mail.ru, Wildberries
Boss:   Яндекс, Tinkoff (разблокируется от Lvl 30)
```

**Уникальные фичи:**
- **Стресс-метрика:** анализ пауз, backspace-серий, хаотичных правок → стресс-график сессии
- **Парный AI-мок:** два пользователя проходят мок одновременно, AI — интервьюер для обоих, потом взаимный фидбек
- **AI-адвокат дьявола:** режим где AI давит, сбивает с толку, задаёт провокационные вопросы
- **Некромантия:** видишь анонимное чужое неправильное решение, находишь баг → XP

### 3.3 Mock Review Online (Human Mock)

Площадка для живых мок-собеседований между пользователями.

**Функциональность:**
- Создание и управление слотами (дата, время, секция, уровень, цена)
- Фильтры: секция, язык, уровень, рейтинг интервьюера
- Автоматическая выдача Google Meet ссылки
- Напоминания за 24h, 1h, 15 минут (Telegram + email)
- Страница сессии для интервьюера: задача, заметки, оценочный лист
- Страница кандидата: слот, ссылка, требования
- Система отмен и no-show с защитой репутации
- Рейтинг интервьюеров (отзывы + звёзды)
- Spectator mode: смотреть live с разрешения участников

### 3.4 Онлайн Арена

PvP-режим: два пользователя решают одну задачу на скорость и качество.

**Режимы:** 1v1 и 2v2

**Матчмейкинг (Redis Sorted Set):**
```
1. В очередь: key="{section}:queue", score=elo
2. Диспетчер каждые 2 сек: разница ELO ≤ 200
3. 30 сек → расширить до 400; 60 сек → до 600
4. Нашёл → матч → оба подтверждают за 10 сек → старт
5. Не подтвердил → предупреждение, второй в очередь
```

**Античит:**
- Paste detection (только ручной ввод)
- Анализ паттернов: аномально быстрое решение → follow-up вопрос
- Page Visibility API: ушёл на другую вкладку → предупреждение
- Suspicion score: предупреждение → поражение → rollback ELO → бан

**Уникальные фичи:**
- **Hardcore режим:** провал = потеря части прогресса. Максимальный адреналин
- **Проклятые задачи:** дебафф (нельзя удалять код / таймер ×2) → тройной XP
- **AI-бот как соперник:** при малой аудитории, пользователь знает что против AI

### 3.5 Гильдейские войны

Недельное асинхронное командное соревнование.

**Механика:**
- Гильдия: 5–10 участников, капитан распределяет роли по секциям
- Каждую неделю: матчап по guild MMR
- 5 линий войны: Algorithms, SQL, Go, System Design, Behavioral
- Лучший результат из N попыток идёт в зачёт линии
- Победитель войны — кто выиграл больше линий

**Специальное событие:** "Захват компании" — набрать N очков по задачам конкретной компании за 48 часов.

**Награды:** сезонные очки, guild cosmetics, герб, аура, титул "Завоеватель недели"

### 3.6 Рейтинг и Прогрессия

- ELO/MMR отдельно по каждой секции
- Solo рейтинг + Guild рейтинг
- Global Power Score — средневзвешенный по всем секциям
- XP и уровни аккаунта (косметика, не влияет на матчмейкинг)
- История роста рейтинга по неделям

**Карьерная линия:**
```
Junior Dev → Middle Dev → Senior Dev → Staff Engineer → Principal
```
Каждый уровень требует конкретных достижений в нескольких секциях.

**Порча навыков:** не практикуешься 7 дней → навык деградирует (–2%/день). Видно в skill atlas как "увядающий" узел.

**Prestige:** достиг максимума → сброс с сохранением постоянного бонуса и редкого класса.

### 3.7 Геймификация — Skill Atlas

Пассивное дерево навыков в стиле PoE 2.

**Структура:**
- Центр: класс персонажа
- 5 ветвей по секциям, каждая своим цветом
- Обычные узлы (малые) + Keystone (крупные, за серьёзные достижения)
- Узлы разблокируются автоматически на основе активности

**Классы персонажа:**
```
Алгоритмист    — 60%+ в Algorithms
DBA            — 60%+ в SQL
Backend Dev    — 60%+ в Go
Architect      — 60%+ в System Design
Communicator   — 60%+ в Behavioral
Ascendant      — 80%+ в двух и более секциях
```

**Атрибуты персонажа:**
```
Интеллект → Алгоритмы
Сила      → System Design
Ловкость  → SQL / Backend скорость
Воля      → Behavioral / стрессоустойчивость
```

**Косметика (не влияет на силу):**
Титулы, рамки аватара, ауры, guild герб, флаконы силы на сайдбаре

### 3.8 Season Pass

Сезон: 6–8 недель, имеет название и тему.

**Примеры:**
```
Season I:   The Awakening
Season II:  The Recursion
Season III: The Ascent
```

**Структура:**
- Бесплатная и Premium дорожка
- Еженедельные задания (3–5 штук) + сезонные цели
- Прогресс по Season Points (зарабатываются в любом режиме)
- Guild season goals — отдельный трек для гильдий

**Награды:** косметика, AI credits, сезонные бейджи, титулы

**UI:** горизонтальный трек с ромбовидными чекпоинтами, тёмный фон, золотые награды.

### 3.9 Подкасты

Пассивное обучение вне активной практики.

- Каталог по секциям: System Design, Backend, Behavioral, Карьера
- AI-рекомендации на основе слабых зон в skill atlas
- Прогресс прослушивания
- Мини-квиз или summary после эпизода
- Привязка к Season Pass (прослушал → season points)
- Плейлисты под цель: "Готовлюсь к Яндексу", "Прокачиваю SQL"

### 3.10 Профиль / Хаб (Sanctum)

Стартовая страница после логина. Центр прогрессии. Реализация — `frontend/src/pages/SanctumPage.tsx`.

**Блоки (bento-сетка):**
- Header: "С возвращением, {{name}}" + сезонный счётчик дней + primary CTA "Найти соперника"
- Hero card (большой): Daily Kata карточка с таймером, статами, "Начать"
- Season Rank: тир + LP + прогресс к следующему
- Arena стат-карточка: W-L, winrate, недельный LP-дельта, "В очередь"
- Guild War: live-счёт против другой гильдии, твой вклад
- AI Coach: identified слабая зона + CTA "Открыть план"
- Recent activity feed (3-4 события)
- Топ друзей mini-leaderboard

**Что убрали из v2.0:** портрет SVG-персонажа на сайдбаре, классы (Алгоритмист/DBA/etc), карьерная линия Junior→Principal, тепловая карта по дням внутри Sanctum (вынесена в `/report` Weekly AI Report).

**Weekly AI Report:**
- Сильные секции недели
- Слабые секции с конкретными узлами atlas
- Стресс-паттерны
- 3 конкретных действия на следующую неделю
- Хранится 7-дневный скользящий агрегат

**Психологический профиль:**
AI выявляет паттерны поведения под давлением: "ты принимаешь плохие решения при таймере < 5 минут" или "ты сильнее после разогрева".

### 3.11 Уведомления

**Каналы:** Telegram (приоритет), Email, Web Push

**Типы:**
- Слоты: запись, подтверждение, за 15 минут до начала
- Арена: найден соперник, матч начался, результат
- Гильдия: началась война, линия не закрыта, победа/поражение
- Weekly AI Report: воскресенье вечером
- Деградация навыков: "Твой SQL начинает угасать — 4 дня без практики"
- Сезон: "Осталось 2 дня, не хватает 80 очков"

### 3.12 Мобильный режим «5 минут»

Отдельный формат для практики в дороге:
- Мини-задачи специально для телефона
- Квизы по теории
- Подкасты
- Просмотр прогресса, skill atlas, рейтинга

### 3.13 Онбординг

5-шаговый интерактивный онбординг (10–15 минут):

1. **Выбери путь** — "Готовлюсь к собесу" / "Хочу соревноваться" / "Практикую"
2. **Быстрый тест** — 5 вопросов → AI строит первичный skill atlas и начальный рейтинг
3. **Твой персонаж** — класс с анимацией, объяснение атрибутов через реальные навыки
4. **Первое подземелье** — принудительно, одна Easy задача → первый XP → level up анимация
5. **Что дальше** — три кнопки: Арена, AI-мок, Пригласить друга

### 3.14 Администраторская панель

- Управление задачами, тест-кейсами, компаниями
- Настройка секций, follow-up вопросов, сложности
- Season Pass: задания, награды, сроки, reset
- Skill Atlas: узлы, связи, правила разблокировки
- Подкасты и обучающий контент
- Шаблоны уведомлений
- Модерация пользователей и интервьюеров
- Античит-панель: журнал подозрительных сессий
- Dynamic config: изменение параметров без деплоя
- Аналитика: retention, воронки, популярность задач

---

## 4. Уникальные фичи (нигде нет)

**Сохранённые в v3.0:**

| Фича | Описание | Реализация |
|---|---|---|
| Replay сессии | Таймлайн набора кода — перемотай и увидь себя со стороны | `MockReplayPage` + WS |
| Стресс-метрика | Паузы, откаты, хаос → стресс-график | `StressMeterPage` |
| Компания = Dungeon | Карточки компаний с tier'ами (Normal / Hard / Boss) и прогрессом | `DungeonsPage` |
| Парный AI-мок | Двое проходят мок, AI — интервьюер для обоих | roadmap v1.5 |
| AI-адвокат дьявола | Режим провокаций и давления | toggle в MockSession |
| Некромантия | Найди баг в чужом анонимном решении → XP | `NecromancyPage` |
| Spectator mode | Смотри live как другой проходит мок | `SpectatorPage` + WS |
| Interview Calendar | Ввод даты собеса → AI строит 21-дневный план | `InterviewCalendarPage` |
| Interview Autopsy | Разбор реального провала после собеса | `InterviewAutopsyPage` |
| Code Obituary | Эпитафия для упавшего решения, виральный share | `CodeObituaryPage` |
| Ghost Runs | Полупрозрачные курсоры-призраки (свой прошлый / топ / AI-эталон) | `GhostRunsPage` |
| War Room | Командное ЧП в гильдии ("прод упал, 30 минут") | `WarRoomPage` + WS |
| AI Mentor Sparring | Тренировка с AI-наставником (без LP/таймера, AI подсказывает) | шаг 4 Onboarding |
| Weekly AI Report | 7-дневный агрегат: сильные/слабые зоны, 3 действия, heatmap | `WeeklyReportPage` |
| Voice Mock | Голосовой режим интервью (Web Speech API) | `VoiceMockPage` |

**Отменённые в v3.0** (механики противоречат позиционированию или не окупают поддержку):

| Фича | Почему убрали |
|---|---|
| ~~Hardcore режим~~ | Наказательная механика отпугивает новичков; ARPU не растёт |
| ~~Проклятые задачи~~ | Дебафф-механика — RPG-флейвор, не оправдана без полного RPG-UI |
| ~~Prestige~~ | Сложно коммуницировать; редко используется в non-RPG продуктах |
| ~~Порча навыков (Skill Decay)~~ | Наказание за паузы раздражает; продукт про рост, не штраф |
| ~~Карьерная линия Junior→Principal~~ | Заменили на численный рейтинг (LP/тир) — прозрачнее для senior |
| ~~Классы персонажа~~ (Алгоритмист/DBA/etc) | Не нужны без RPG-аватара; рейтинг по секциям показывает то же |
| ~~Психологический профиль~~ | Слишком claim; AI-разбор стресса делает то же без big-brother attitude |
| ~~Стратегия первых 100 — AI-бот как соперник~~ | Бот решает за 1 сек, нечестно; заменено на AI Mentor Sparring (без соревнования) |

---

## 5. Архитектура системы

### Стратегия: Модульный монолит → Микросервисы

**Почему не микросервисы сразу:**
Один разработчик + горизонт 1–2 месяца до MVP = первые 3 недели уйдут только на инфраструктуру. Правильная стратегия — модульный монолит с чистыми границами доменов.

Каждый домен — отдельный Go-модуль. Деплоится как один бинарник. Когда домен начнёт тормозить под нагрузкой — вырезаешь в отдельный сервис за неделю, потому что границы уже есть.

**Когда резать на микросервисы:**

| Домен | Триггер |
|---|---|
| arena | WebSocket > 500 одновременно |
| ai_mock | LLM запросы блокируют API |
| notify | Очередь > 10k/час |
| editor | Совместных сессий > 200 |

### Фронтенд
```
Vite + React 18 + TypeScript
React Router v6
TanStack Query       — серверный стейт
Zustand              — клиентский стейт
i18next              — ru/en локализация
Monaco Editor        — редактор кода
Liveblocks           — совместное редактирование
Socket.io client     — WebSocket (арена, уведомления)
Cinzel + JetBrains Mono — шрифты
```

### Бэкенд — Go Workspaces (service boundaries)

Каждый домен — отдельный Go-модуль (`go.mod`). Общаются только через `shared/domain/events.go`. Прямые импорты между сервисами запрещены.

```
druz9/
├── go.work
├── backend/
│   ├── services/
│   │   ├── arena/           module druz9/arena
│   │   │   ├── go.mod
│   │   │   ├── domain/      entity, interfaces, domain services
│   │   │   ├── app/         use cases
│   │   │   ├── infra/       реализации (postgres, redis)
│   │   │   └── ports/       HTTP handlers, WebSocket hub
│   │   ├── ai_mock/         module druz9/ai_mock
│   │   ├── auth/            module druz9/auth
│   │   ├── editor/          module druz9/editor
│   │   ├── rating/          module druz9/rating
│   │   ├── guild/           module druz9/guild
│   │   ├── profile/         module druz9/profile
│   │   ├── notify/          module druz9/notify
│   │   ├── season/          module druz9/season
│   │   ├── podcast/         module druz9/podcast
│   │   └── admin/           module druz9/admin
│   │
│   ├── shared/              module druz9/shared
│   │   ├── enums/           ВСЕ enum'ы здесь
│   │   ├── domain/events.go typed domain events
│   │   └── pkg/             logger, config, middleware
│   │
│   └── cmd/monolith/        точка входа MVP
│
├── frontend/                Vite + React
├── infra/                   Docker Compose, Nginx
└── .github/workflows/
```

### Правила кода

**Enums — никаких `string`/`int` для ограниченных значений:**
```go
// shared/enums/section.go
type Section string
const (
    SectionAlgorithms   Section = "algorithms"
    SectionSQL          Section = "sql"
    SectionGo           Section = "go"
    SectionSystemDesign Section = "system_design"
    SectionBehavioral   Section = "behavioral"
)
func (s Section) IsValid() bool { ... }
```

Все enum'ы в `shared/enums/`. Каждый с методом `IsValid()` и `String()`.

Полный список enum'ов:
- `Section` — секции интервью
- `MessageRole` — system / user / assistant
- `Difficulty` — easy / medium / hard
- `LLMModel` — все доступные модели
- `MatchStatus` — searching / confirming / active / finished / cancelled
- `SubscriptionPlan` — free / premium
- `UserRole` — user / interviewer / admin
- `NotificationChannel` — telegram / email / push
- `SlotStatus` — available / booked / completed / cancelled

**Event Bus:**
```go
// Домены публикуют события, не вызывают друг друга напрямую
eventBus.Publish(ctx, events.MatchCompleted{...})

// Подписки в cmd/monolith/main.go
bus.Subscribe("MatchCompleted", ratingService.OnMatchCompleted)
bus.Subscribe("MatchCompleted", notifyService.OnMatchCompleted)
bus.Subscribe("MatchCompleted", analyticsService.OnMatchCompleted)
```

При переходе на микросервисы — заменяешь in-process bus на NATS/Kafka. Сигнатуры обработчиков не меняются.

### WebSocket архитектура

**EditorHub** — долгоживущие соединения (30–60 мин), Yjs операции, роли.
Сообщения: `op`, `cursor`, `freeze`, `role_change`

**ArenaHub** — короткие соединения (5–30 мин), строгая синхронизация старта.
Сообщения: `match_start`, `code_submit`, `opponent_accepted`, `match_result`

Авторизация: JWT в query param (`?token=...`) при handshake.
Масштабирование: Redis Pub/Sub между инстансами.

### Инструменты кодогенерации
```
sqlc          — типобезопасный Go из SQL запросов
mockgen       — моки из интерфейсов для тестов
wire          — compile-time DI
goose         — SQL миграции
buf + protoc  — если понадобится gRPC
```

---

## 6. База данных

### PostgreSQL — основное хранилище

**Ядро:**
```sql
users           (id, email, username, password_hash, role, created_at)
oauth_accounts  (id, user_id, provider, provider_id, access_token_enc)
                -- provider: "yandex" | "telegram"
profiles        (user_id 1:1, char_class, level, xp, title, avatar_frame)
```

**Рейтинг:**
```sql
ratings         (user_id, section, elo DEFAULT 1000, matches_count)
                -- UNIQUE(user_id, section)
skill_nodes     (user_id, node_key, progress 0-100, unlocked_at, decayed_at)
seasons         (id, name, slug, starts_at, ends_at)
season_progress (user_id, season_id, points, tier, is_premium)
achievements    (user_id, achievement_key, earned_at)
```

**Контент:**
```sql
companies       (id, name, slug, difficulty, min_level_required)
tasks           (id, slug UNIQUE, title_ru, title_en, description_ru, description_en,
                 difficulty, section, time_limit_sec, memory_limit_mb,
                 solution_hint,  -- только для AI, никогда не отдаётся клиенту
                 is_active, version, created_at)
test_cases      (id, task_id, input, expected_output, is_hidden, order_num)
task_templates  (id, task_id, language, starter_code)
follow_up_questions (id, task_id, question_ru, question_en, answer_hint, order_num)
```

**Матчи и моки:**
```sql
arena_matches       (id, task_id, task_version, section, status, winner_id,
                     started_at, finished_at)
arena_participants  (match_id, user_id, team, elo_before, elo_after,
                     suspicion_score, solve_time_ms)
mock_sessions       (id, user_id, company_id, section, status,
                     stress_profile jsonb, ai_report jsonb, replay_url)
mock_messages       (id, session_id, role, content, code_snapshot,
                     stress_snapshot jsonb, tokens_used, created_at)
editor_rooms        (id, owner_id, type, task_id, language, is_frozen, expires_at)
editor_participants (room_id, user_id, role)
```

**Социалка:**
```sql
guilds          (id, owner_id, name, guild_elo, emblem)
guild_members   (guild_id, user_id, role, joined_at)
guild_wars      (id, guild_a_id, guild_b_id, week_start,
                 scores_a jsonb, scores_b jsonb, winner_id)
```

**Human mock:**
```sql
slots           (id, interviewer_id, starts_at, duration_min, section, price, status)
bookings        (id, slot_id, candidate_id, meet_url, status, created_at)
slot_reviews    (booking_id, reviewer_id, rating, feedback)
```

**Монетизация:**
```sql
boosty_accounts (user_id, boosty_username, verified_at)
subscriptions   (user_id, plan, status, boosty_level, current_period_end)
ai_credits      (user_id, balance, updated_at)
```

**Система:**
```sql
dynamic_config      (key PK, value jsonb, type, description, updated_at, updated_by)
notifications_log   (id, user_id, channel, type, payload jsonb, sent_at, status)
anticheat_signals   (id, user_id, match_id, type, severity, metadata jsonb)
podcasts            (id, title_ru, title_en, section, duration_sec, audio_url)
podcast_progress    (user_id, podcast_id, listened_sec, completed_at)
onboarding_progress (user_id, step, completed_at, answers jsonb)
llm_configs         (id, scope_type, scope_id, model, temperature, max_tokens)
```

### ClickHouse — аналитика

```sql
CREATE TABLE events (
    event_type  LowCardinality(String),
    user_id     UUID,
    properties  String,
    timestamp   DateTime
) ENGINE = MergeTree() ORDER BY (event_type, timestamp);

CREATE TABLE mock_analytics (
    session_id   UUID,
    user_id      UUID,
    company      LowCardinality(String),
    section      LowCardinality(String),
    score        UInt8,
    duration_sec UInt32,
    model_used   LowCardinality(String),
    date         Date
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, section);
```

### Redis
```
rating:{section}:{userID}     — ELO, sorted set для топа
{section}:queue               — очередь матчмейкинга (sorted set by ELO)
session:{sessionID}           — WS сессии
cache:profile:{userID}        — TTL 5 мин
cache:leaderboard:{section}   — топ-100, TTL 1 мин
dynconfig:cache               — кеш dynamic config, TTL 30 сек
queue:notifications           — Asynq очередь
```

### Политика хранения данных
- Keystroke logs сессий: 7 дней → автоудаление
- Replay (агрегированный): 30 дней
- AI отчёты: бессрочно (PostgreSQL JSONB)
- Логи приложения: 90 дней

---

## 7. Инфраструктура и деплой

### Окружения
```
local      — Docker Compose, все сервисы локально
staging    — автодеплой из main, тестовые ключи API
production — только по ручному апруву в GitHub Actions
```

### VPS (один сервер, Германия)

Все сервисы на одной машине в двух изолированных Docker сетях:

```
app-net:   nginx, api, postgres, redis, minio, clickhouse
judge-net: judge0-server, judge0-workers, judge0-db, judge0-redis
```

API может обращаться к Judge0, но Judge0 не видит основную БД и Redis.

### Docker Compose (продакшн)

Ключевые принципы:
- `depends_on` с `condition: service_healthy` — строгий порядок запуска
- `restart: always` — автовосстановление после краша VPS
- `migrate` сервис с `restart: on-failure` — миграции при деплое, потом завершается
- Judge0 ресурсы ограничены: 2 CPU, 1GB RAM на workers
- MinIO консоль (9001) — только через SSH tunnel, не наружу

### Nginx
```nginx
# Фронтенд SPA
location / {
    root /var/www/frontend;
    try_files $uri $uri/ /index.html;
}
# REST API
location /api/ { proxy_pass http://api:8080; }
# WebSocket (долгие соединения)
location /ws/ {
    proxy_pass http://api:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
# MinIO (presigned URLs)
location /storage/ { proxy_pass http://minio:9000/; }
# Judge0 — НЕ проксируется наружу
```

SSL: Certbot (Let's Encrypt, автообновление).
Редирект: druz9.ru → druz9.online (HTTPS).

### CI/CD (GitHub Actions)
```
Push/PR    → lint + test + build
Merge main → deploy staging (авто)
           → smoke tests
           → кнопка "Approve" в GitHub Environments ← ТЫ
Production → deploy + уведомление в Telegram
```

### Sandbox — Judge0 Self-hosted

Self-host на том же VPS, изолированная `judge-net`.
Лимиты: 256MB RAM, 5 сек CPU, нет сети.
Поддержка: Go, Python, JavaScript, SQL, 40+ языков.
Основной API обращается к Judge0 по внутреннему Docker hostname.

### Object Storage — MinIO (MVP)

S3-совместимый, self-hosted. Тот же AWS Go SDK — переезд на Cloudflare R2 = смена endpoint + credentials.

```
druz9-podcasts   — аудиофайлы, стриминг через бэкенд
druz9-replays    — replay сессий, presigned URL TTL 1 час
druz9-uploads    — аватары, косметика
```

Lifecycle rule: файлы в `druz9-replays` старше 30 дней → автоудаление.

### Dynamic Config (без рестарта)

Параметры платформы живут в PostgreSQL `dynamic_config`. Redis Pub/Sub: изменение в админке → публикация события → все горутины обновляют кеш < 100ms.

Примеры параметров:
```
arena_workers_count, arena_anticheat_threshold
ai_max_concurrent_sessions, ai_stress_pause_threshold_ms
elo_k_factor_new (32), elo_k_factor_veteran (16)
xp_arena_win (120), xp_mock_complete (80)
skill_decay_days (7), skill_decay_rate_pct (2)
guild_max_size (10), season_pass_enabled, voice_mode_enabled
```

---

## 8. AI-интеграция

### Провайдеры через OpenRouter

Один интерфейс, несколько реализаций:
```go
type LLMProvider interface {
    Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error)
    Stream(ctx context.Context, req CompletionRequest) (<-chan Token, error)
}
```

**Модели:**
```
Бесплатный тир:  openai/gpt-4o-mini, mistralai/mistral-7b
Premium:         openai/gpt-4o, anthropic/claude-sonnet-4, google/gemini-pro
```

**Приоритет выбора модели:**
```
1. Выбор пользователя (если premium)
2. Override для конкретной задачи (из админки)
3. Override для секции (из админки)
4. Override для компании (из админки)
5. Дефолт: gpt-4o-mini (free) / gpt-4o (premium)
```

### Архитектура AI-мока

LLM stateless — бэкенд хранит всю историю в `mock_messages` и при каждом запросе отправляет полный контекст.

**System prompt (4 блока):**
1. Роль интервьюера: компания, секция, уровень, язык ответов
2. Задача + критерии оценки + solution_hint (только для AI)
3. Текущий код + elapsed time + стресс-метрика
4. Правила: наводи при молчании >2 мин, не давай решение, фиксируй ошибки

**Управление контекстом:**
- System prompt + последние 10 сообщений — всегда
- Старые сообщения — суммаризируются если не влезают в лимит токенов

**Итоговый отчёт (отдельный запрос):**
```json
{
  "overall_score": 72,
  "sections": {
    "problem_solving": {"score": 80, "comment": "..."},
    "code_quality":    {"score": 65, "comment": "..."},
    "communication":   {"score": 75, "comment": "..."},
    "stress_handling": {"score": 60, "comment": "..."}
  },
  "strengths": [...],
  "weaknesses": [...],
  "recommendations": [...],
  "stress_analysis": "..."
}
```

**Стоимость на сессию (45 мин):**
- gpt-4o-mini: ~$0.08–0.12
- gpt-4o: ~$0.40–0.60

### Стресс-метрика

Клиент (Monaco) шлёт события каждые 500ms:
```typescript
type EditorEvent = 'pause' | 'backspace_burst' | 'chaotic_edit' | 'paste_attempt'
```

Бэкенд агрегирует, передаёт в system prompt как контекст поведения пользователя.

### Голосовой режим

Web Speech API для транскрипции (Chrome/Edge).
Транскрипт → обычное текстовое сообщение в `mock_messages`.
Полный голосовой мок (v2): Whisper API (STT) + TTS для ответов AI.

---

## 9. Авторизация

**Провайдеры:** Яндекс OAuth + Telegram Login Widget

**Telegram Login Widget** — не OAuth, особый протокол:
1. Пользователь нажимает кнопку → Telegram диалог с ботом
2. Пользователь подтверждает
3. Telegram шлёт данные с HMAC-SHA256 подписью на callback
4. Бэкенд верифицирует подпись через bot token
5. Поля: `id`, `first_name`, `username`, `photo_url` (email нет — nullable)

**JWT схема:**
- Access token: 15 мин, в памяти клиента
- Refresh token: 30 дней, httpOnly cookie
- Активные сессии в Redis — инвалидация без смены ключа

**WebSocket авторизация:** JWT в query param `?token=...`

---

## 10. Монетизация

**Boosty** — пожертвования/подписка (юридически проще чем платёжная система).

**Уровни:**
```
Поддержка (~0₽)      — базовый доступ, бесплатные модели
Искатель (~299₽/мес) — premium AI модели (gpt-4o-mini+)
Вознёсшийся (~799₽/мес) — все фичи + gpt-4o / claude-sonnet
```

**Flow:** пользователь указывает Boosty username в профиле → Boosty webhook → бэкенд активирует premium.

**Принцип:** никакого pay-to-win. Premium = лучший AI и косметика, не преимущество в рейтинге.

**Монетизация v2:**
- Компании платят за размещение реальных задач + доступ к топ-100 рейтинга как к кандидатам
- Рекрутеры платят за контакт с топ игроками
- Entry fee в арене (внутренний баланс)

---

## 11. Безопасность

**Rate limiting (Redis):**
```
Обычные API:       100 req/min на user
AI-мок создание:    10 req/min на user
Создание матча:      5 req/min на user
Регистрация/логин:  10 req/min на IP
```

- SQL injection: исключён через `sqlc` (параметризованные запросы)
- CORS: только druz9.online в продакшне
- Input validation: `go-playground/validator`, max код 50KB
- DDoS: Cloudflare бесплатный план перед сервером
- Секреты: `.env` + переменные окружения, `git-secrets` pre-commit hook
- OAuth tokens: AES-256 шифрование в БД
- Judge0: изолированная Docker сеть, не доступен снаружи
- WebSocket: проверка origin при handshake, автодисконнект при протухшем токене

---

## 12. Метрики и аналитика

### Стек
```
Prometheus + Grafana   — технические метрики и алерты
Loki                   — структурированные логи
ClickHouse             — аналитические данные
```

### Технические метрики (Prometheus)
```
http_request_duration_seconds{p50, p95, p99}   Алерт: p99 > 2s
http_errors_total                               Алерт: > 1% за 5 мин
ws_active_connections{hub}                      Алерт: > 500
llm_request_duration_seconds                    Алерт: > 30s
llm_tokens_total{type}                          Алерт: > $5/час
judge0_pending_submissions                      Алерт: > 50
pg_stat_activity_count                          Алерт: > 80% pool
redis_memory_used_bytes                         Алерт: > 80%
node_filesystem_avail_bytes                     Алерт: < 20% свободно
```

### Бизнес-метрики (ClickHouse + Grafana)
```
DAU / MAU                      Алерт: DAU упал > 20% за день
Retention D1 / D7 / D30        Алерт: D7 < 25%
Конверсия free → premium       Цель: > 5%
Матчей в день по секциям
Среднее время ожидания матча   Алерт: > 3 мин
AI-моков завершено / брошено   Алерт: dropout > 40%
Средний балл по секциям
Активные гильдии в неделю
```

Все алерты → Telegram бот.

---

## 13. Open Source и контрибьюторы

### GitHub настройки

**Branch protection (main):**
- Только через PR, минимум 1 аппрув
- Ты — обязательный reviewer через CODEOWNERS
- CI должен быть зелёным перед мержем
- Dismiss stale reviews при новых коммитах

**Файлы:**
```
.github/CODEOWNERS                  * @yourusername
.github/PULL_REQUEST_TEMPLATE.md
.github/ISSUE_TEMPLATE/bug_report.md
.github/ISSUE_TEMPLATE/feature_request.md
CONTRIBUTING.md
SECURITY.md
LICENSE (MIT)
```

### Линтер

**Go — golangci-lint:**
```yaml
linters:
  enable:
    - errcheck, gosimple, govet, staticcheck
    - gofmt, goimports, misspell
    - exhaustive   # обязательно! все case в switch для enum'ов
    - forbidigo    # запрет fmt.Println
    - noctx        # context в HTTP функциях
    - wrapcheck    # оборачивать ошибки с контекстом
```

**TypeScript — ESLint + Prettier:**
```json
"rules": {
  "@typescript-eslint/no-explicit-any": "error",
  "no-console": "warn"
}
```

**Makefile:**
```makefile
lint:     golangci-lint + eslint
test:     go test -race + npm test
build:    npm run build + go build
dev:      docker-compose up + go run + npm run dev
seed:     go run ./scripts/seed
migrate:  goose up/down
```

### Health Checks
```
GET /health        — liveness (Docker healthcheck)
GET /health/ready  — readiness: проверяет postgres, redis, minio, judge0, llm
```

Response: `{"status": "ok|degraded|unavailable", "checks": {...}}`

---

## 14. Дорожная карта

### MVP (месяц 1–2)
- [ ] Auth (Яндекс + Telegram)
- [ ] Monaco Editor + Judge0
- [ ] AI-мок (одна секция, OpenRouter)
- [ ] Профиль + Skill Atlas (базовый)
- [ ] Лобби в PoE-стиле
- [ ] Деплой на VPS

### v1.0 (месяц 3–4)
- [ ] Арена 1v1
- [ ] ELO рейтинг
- [ ] Все 5 секций в AI-моке
- [ ] Season Pass (базовый)
- [ ] Уведомления в Telegram
- [ ] Онбординг
- [ ] Human Mock (слоты + Google Meet)

### v1.5 (месяц 5–6)
- [ ] Гильдии и Гильдейские войны
- [ ] Replay сессий
- [ ] Стресс-метрика
- [ ] Голосовой режим
- [ ] Подкасты
- [ ] ClickHouse аналитика
- [ ] Boosty монетизация

### v2.0 и далее — см. раздел 15

---

## 15. Промпты для AI-инструментов

### Промпт для дизайна (Claude / Figma AI) — v3.0

```
Ты опытный product designer. Разработай экраны для druz9 — гейм-фицированной
платформы подготовки к собесам. Стиль — современный pro-tool, как Linear,
Vercel, Raycast, Riot client. Геймификация в механиках, не в украшениях.

ВИЗУАЛЬНЫЙ СТИЛЬ:
- Modern dark UI, OLED-friendly. Bento-сетка карточек.
- Лёгкий glassmorphism, subtle violet+cyan акценты.
- Никакого RPG: ни Cinzel, ни золотых рамок, ни рун, ни pergament.
- Light + dark темы (CSS-переменные, рaboтают через Tailwind).

ЦВЕТА (Tailwind tokens, dark тема):
#0A0A0F bg / #141425 surface-1 / #1A1A2E surface-2 / #2D1B4D surface-3
#222233 border / #2A2A3F border-strong
#FFFFFF text-primary / #C0C0C0 text-secondary / #8A8A9E text-muted
#582CFF accent / #6D43FF accent-hover
#10B981 success / #EF4444 danger / #FBBF24 warn / #22D3EE cyan / #F472B6 pink

ШРИФТЫ: Geist (headings 700-800) / Inter (body 400-600) / Geist Mono (mono).

КОМПОНЕНТЫ-ЯДРО:
- Button — primary (фиолет + shadow-glow) / ghost (border) / danger
- Card — rounded-xl, surface-2 fill, border тонкая
- Avatar — gradient circle с инициалами (no SVG character, no portraits)
- Tabs — pills / underline / segmented
- Lucide иконки — никаких рун

ИКОНОГРАФИЯ: только Lucide. Эмодзи допустимы для эмоциональных моментов
(🔥 серия, ⚔️ дуэль) но в основном UI — Lucide.

ЭКРАНЫ ДЛЯ РЕДИЗАЙНА (если нужно перерисовать конкретный):

1. SANCTUM — bento-сетка из 6-7 карточек:
Hero (Daily kata + таймер + статы), Season Rank, Arena мини, Guild war,
AI Coach (gradient violet→pink), Recent activity feed, Топ друзей mini.
TopNav: druz9 logo (gradient 32x32) + nav (Sanctum/Arena/Kata/Guild/Atlas/Codex)
+ search + theme toggle + lang + bell + avatar.

2. ARENA MATCH — split-screen:
Header 120h: левый игрок (avatar 64 + nick + tier) | center timer "12:43" + 3 round dots
| правый игрок mirror.
Body: Task panel 340w (tags + heading + примеры + ограничения)
| Editor (центр, fill, line numbers + syntax-highlighted Go код)
| Sidebar 300w (test list 5 строк + chat).

3. ATLAS (Skill Tree) — modern PoE-стайл:
Center hex ROOT, 6 keystone хексов радиально (ALGO/DATA/STR/MATH/GRAPH/DP),
20+ ellipse nodes scattered, connection lines (rectangles 2-4px), 3 состояния
(unlocked accent / available dashed / locked muted). Right sidebar 380w:
selected node details (badge + heading + description + effects + prerequisites
+ allocation card с "Вложить очко" primary CTA).

4. WEEKLY AI REPORT:
Header + 4 метрик-карточки (XP/матчей/streak/avg LP), большой Heatmap
24×7 (часы × дни) с gradient cells from surface-1 to accent-hover.
Strengths/Weaknesses cards + 3 actions card (P1/P2 priorities) + сравнение 4 недель.

5. ОНБОРДИНГ — 4 шага + Welcome + AllSet:
Welcome (splash, 2 H1 c gradient text), Register (form + OAuth),
Stack (12 lang grid), First Kata (intro + mock preview),
AI Mentor Sparring (без LP/таймера, AI учит). AllSet (success circle + confetti
polygons + 3 reward cards + suggested action).

6. SYSTEM DESIGN INTERVIEW:
Excalidraw-style canvas в центре с архитектурными нодами
(сервисы/БД/очереди rectangles + connection lines + sticky notes).
Left: requirements panel. Right: PRIMARY CTA "Отправить скриншот AI" gradient
card сверху (AI on-demand, не listening постоянно — экономит $0.40/сессия),
ниже live evaluation метрики "по последнему разбору".

ПРИНЦИПЫ:
- Mobile-first (390px → 1440px). Все sidebars стакаются вертикально под lg:
- Framer Motion: page transitions fade+slide 250ms, hover/tap scale на CTA, stagger.
- Reduced motion respect.
- Loading: skeleton placeholders OR "—" fallbacks.
- Empty states: дружелюбный текст ("Здесь пока пусто, сыграй первый матч").

Источник правды: design/v2/druz9.pen (Pencil-файл, 60+ экранов уже отрисованы).
Реализация: frontend/src/ (45 страниц React + Tailwind + Lucide).
```

---

### Промпт для бэкенда (Claude Opus)

```
Ты Senior Go-разработчик. Работаешь над druz9 — платформой подготовки
к техническим собеседованиям с RPG-геймификацией.

СТЕК:
Go 1.22, модульный монолит с Go Workspaces → микросервисы в будущем
PostgreSQL 16, Redis 7, ClickHouse, MinIO (S3)
chi router, pgx/v5, sqlc, goose, golangci-lint

АРХИТЕКТУРА — Go Workspaces, service boundaries:
backend/services/{domain}/  — каждый домен отдельный Go-модуль
  domain/    — entity, interfaces, domain services (чистые, без фреймворков)
  app/       — use cases, оркестрация
  infra/     — реализации interfaces (postgres, redis)
  ports/     — HTTP handlers, WebSocket hub
backend/shared/             — module druz9/shared
  enums/     — ВСЕ enum'ы
  domain/    — typed domain events
  pkg/       — logger, config, middleware

ПРАВИЛО: домены не импортируют друг друга.
Общаются только через EventBus и shared/domain/events.go.

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА КОДА:

1. ENUMS — никаких string/int для ограниченных значений:
   type Section string
   const (SectionAlgorithms Section = "algorithms" ...)
   func (s Section) IsValid() bool { ... }
   Все enum'ы в shared/enums/, метод IsValid() у каждого.

2. ОШИБКИ — всегда оборачивать:
   return fmt.Errorf("arena.StartMatch: %w", err)

3. CONTEXT — первым параметром везде.

4. БД — только sqlc, никаких ORM, параметризованные запросы.

5. ЛИНТЕР — перед ответом мысленно прогони golangci-lint:
   - Все error обработаны
   - Нет fmt.Println (только slog logger)
   - В switch по enum — все значения (exhaustive линтер)
   - HTTP функции принимают context (noctx)
   - Ошибки обёрнуты (wrapcheck)

6. ТЕСТЫ — unit тест с mockgen мок для каждого use case.

7. solution_hint из таблицы tasks — НИКОГДА не отдавать клиенту.
   Только читать на бэкенде для system prompt LLM.

8. LLM — приоритет модели:
   user preference → task override → section override → company override → default

ПРОЦЕСС РАБОТЫ:
Когда получаешь задачу:
1. Предложи структуру файлов и интерфейсы
2. Жди подтверждения
3. Напиши реализацию
4. Напиши тесты

Так мы не тратим время на переделки неправильной архитектуры.
```


---

## 16. Порядок разработки — Contract-First подход

### Главное правило: сначала контракт

Никакого хардкода URL, типов и enum'ов ни на фронте ни на бэке.
Единственный источник правды — `shared/openapi.yaml`.

```
shared/openapi.yaml
       ↓                          ↓
frontend/src/api/generated/    backend/internal/generated/
(TypeScript типы и клиент)     (Go интерфейсы хендлеров)
```

**Генерация:**
```bash
# Фронт: openapi-typescript
npx openapi-typescript shared/openapi.yaml -o frontend/src/api/generated/schema.ts

# Бэк: oapi-codegen
oapi-codegen -package api shared/openapi.yaml > backend/internal/generated/api.gen.go
```

Добавить в `make` и CI — если спецификация изменилась а код не перегенерирован, пайплайн падает.

### Порядок по неделям

**Неделя 1 — Контракт**
- Написать `shared/openapi.yaml` для MVP эндпоинтов
- Все enum'ы, типы запросов и ответов
- Промпт Claude Opus: "Опиши OpenAPI спецификацию для этих эндпоинтов"
- Промпт Claude: "Напиши MSW моки для этой спецификации"

**Неделя 2–3 — Параллельная разработка**
- Фронт работает на MSW (Mock Service Worker) — реальные запросы, фейковые данные
- Бэк реализует логику по сгенерированным интерфейсам
- Когда бэкенд готов — фронт переключается одной строчкой в конфиге

**Неделя 4+ — Интеграция**
- Фронт переключается на реальный API
- Интеграционные тесты по спецификации

### Структура заглушек

**Фронт (MSW):**
```typescript
// frontend/src/mocks/handlers/arena.ts
import { http, HttpResponse } from 'msw'
import { components } from '../api/generated/schema'

export const arenaHandlers = [
  http.post('/api/v1/arena/match/find', () => {
    return HttpResponse.json<components['schemas']['MatchFoundResponse']>({
      matchId: 'mock-match-123',
      opponent: { username: 'mock_user', elo: 1200 },
      taskId: 'two-sum',
      section: 'algorithms',
    })
  }),
]
```

**Бэк (заглушки хендлеров):**
```go
// backend/services/arena/ports/http/match.go
func (h *Handler) FindMatch(w http.ResponseWriter, r *http.Request) {
    // TODO: implement real matchmaking
    // Заглушка возвращает фейковый матч
    render.JSON(w, r, &MatchFoundResponse{
        MatchID: uuid.New(),
        Status:  enums.MatchStatusSearching,
    })
}
```

### Конвенция для заглушек

Заглушки помечаются комментарием `// STUB:` — легко найти через grep:
```
grep -r "// STUB:" backend/
grep -r "// STUB:" frontend/src/
```

В CI добавить проверку что в `main` нет заглушек без соответствующего issue:
```bash
# Предупреждение (не блокирует): показывает список STUB комментариев
git diff origin/main | grep "// STUB:" || true
```

---

## 17. Версия v2 — фичи

### 17.1 Публичные профили и Skill Atlas как резюме

Разработчик делится ссылкой `druz9.online/u/alexivanov` — рекрутер видит:
- Красивый skill atlas с прогрессом по секциям
- Верифицированные достижения (пройдено подземелье Яндекса, топ-100 арены)
- История активности и рост рейтинга
- Бейджи для вставки в LinkedIn / HH.ru

**Ценность:** не "5 лет опыта" в резюме, а реальные доказательства навыков.
**Вирусность:** каждый разработчик хочет показать прогресс — органический контент.
**B2B:** рекрутеры платят за доступ к базе профилей.

### 17.2 AI-симуляция конкретного интервьюера

Парсинг публичных выступлений и постов человека с конференций.
AI имитирует стиль вопросов, любимые темы, уровень строгости.
"Пройди мок как будто тебя собеседует [известный разработчик]."

Юридически: только публичные данные, без идентификации личности в промпте к LLM. Фича называется "стиль интервью: строгий технарь / менторский / FAANG-стиль" — не имя человека.

### 17.3 Командные задачи в редакторе

Трое в одной комнате решают архитектурную задачу вместе.
Один рисует схему (whiteboard-режим), двое пишут код, AI-интервьюер задаёт вопросы всей команде.
Как настоящий system design интервью в FAANG где несколько интервьюеров.
Никто так не делает.

### 17.5 Интеграция с вакансиями (B2B)

Компания публикует вакансию на druz9. Кандидат проходит их подземелье.
Если набрал порог — автоматически попадает в воронку найма компании.
Рекрутинговый продукт внутри игры — уникальная позиция на рынке.


---

## 18. Пересмотр версий — финальная структура

### Логика версий (с учётом open source и комьюнити)

```
v1–v2  Ядро + AI-Native + Daily Kata + Interview Calendar     Месяц 1–6
v3     Multi-Track (QA, DevOps, Analyst, Security)             Месяц 7–12
v4     Career World (Campaigns, AI Mentor, Guild Base, Raids)  Месяц 13–18
v5     Daily Kata 2.0 + Interview Calendar Pro + новые режимы  Месяц 18+
```

---

## 19. v1–v2 — обновлённый scope (включает AI-Native)

### Что добавляется к уже описанным модулям

#### 19.1 AI-Native Round (перенесён из v5 в v1–v2)

Новый режим рядом с обычным AI Mock Review. Пользователю официально разрешён встроенный AI-ассистент, система оценивает качество взаимодействия с AI, а не только финальный ответ.

**Что измеряется:**
- Context Score — насколько качественно пользователь ставит задачу AI
- Verification Score — проверяет ли он ответы модели
- Judgment Score — замечает ли опасные или неверные советы
- Delivery Score — доводит ли AI-output до чистого результата

**Механики:**
- Prompt/Response Timeline — отдельная лента взаимодействий с AI
- Provenance Graph — визуализация что написал человек, что AI, что переработано
- Verification Gate — нельзя завершить сессию без хотя бы одной проверки
- Hallucination Traps — система встраивает правдоподобные но неверные ответы AI
- AI Responsibility Report — итоговый отчёт об инженерной зрелости

**Новые титулы:** Prompt Apprentice, Context Crafter, Hallucination Hunter, Responsible Engineer

**MVP:** один режим, только Algorithms/Backend Coding, 3 score-оси, 10–20 сценариев.

#### 19.2 Daily Kata

Одна маленькая задача в день, 5–15 минут. Система streak как в Duolingo.

**Механики:**
- Каждое утро в 9:00 новая задача в Telegram
- Задача адаптируется под слабые зоны skill atlas пользователя
- Streak счётчик в профиле, визуально сгорает если пропустить
- Freeze токены — можно пропустить день без потери streak (получаешь за активность)
- Специальные "Проклятые Kata" по пятницам — сложнее, но тройной XP
- Weekly Kata Boss — воскресенье, задача сложнее обычного, за прохождение редкий титул

**Почему это retention:** ежедневный повод открыть платформу. Streak психологически сложно бросить. Telegram уведомление = бесплатный daily active user.

#### 19.3 Interview Calendar

Пользователь вводит дату реального собеседования — платформа автоматически строит персональный план подготовки с обратным отсчётом.

**Механики:**
- Ввод: компания, роль, дата, текущий уровень
- AI строит countdown-план: "до собеса 21 день, вот что делать каждый день"
- Каждый день конкретное задание: сегодня — две Easy задачи на деревья, завтра — AI-мок SQL секция
- Прогресс-бар "готовность к собесу" в %
- За 3 дня до собеса — финальный mock с максимальным давлением
- После собеса: "Как прошло?" → заполняешь результат → автоматически запускается Interview Autopsy

**Почему это мощно:** конкретная дата = конкретная мотивация. Пользователь не уходит потому что у него есть план.

---

## 20. Новые киллер-фичи

### 20.1 Interview Autopsy (v1–v2)

После реального собеседования пользователь вводит: компания, секция, вопросы которые задавали, что ответил, чем закончилось. AI делает полный разбор:
- Где именно потерял
- Что нужно было сказать
- Почему именно такой вопрос задают в этой компании
- Какие узлы skill atlas нужно прокачать

Строится карта слабых мест которую невозможно построить иначе — только на основе реального провала.

**Почему вирусно:** люди делятся разборами анонимно. "Вот почему меня не взяли в Яндекс" — такой контент разлетается в профессиональных сообществах.

### 20.2 Real Offer Simulator (v1–v2)

После прохождения подземелья компании AI разыгрывает сцену оффера: дата выхода, зарплата ниже рынка, equity, испытательный срок. Пользователь ведёт переговоры — просит больше, обосновывает, не теряет оффер. AI оценивает навык переговоров, даёт конкретные фразы и стратегии.

**Почему уникально:** все готовят к техническому собесу. Никто не тренирует переговоры об офферах. Это буквально помогает пользователю заработать больше денег — конкретная измеримая ценность.

### 20.3 Code Obituary (v1–v2)

После провала задачи AI пишет "некролог" решению в стиле RPG эпитафии:

> *"Здесь покоится решение alexivanov. Пало от O(n²) сложности и забытого edge case с пустым массивом. Прожило 23 минуты. Не проверяло граничные условия."*

Делится как мем в Telegram. Органический виральный контент.

### 20.4 Ghost Runs (v2)

Решаешь задачу и видишь полупрозрачный "призрак" рядом — его курсор, его паузы, его откаты в реальном времени. Варианты призраков:
- Твоя прошлая попытка (соревнуешься с собой)
- Топ-игрок секции
- AI-run (эталонное решение)
- Интервьюерский разбор

Как Mario Kart ghost mode но для кода. Таблицы рекордов по каждой задаче.

### 20.5 War Room — командное ЧП (v2–v3)

Внезапное событие для гильдии в любое время: *"Продакшн упал. У вас 30 минут."*

Каждый участник получает свой кусок: один дебажит Go-код, другой SQL запрос, третий system design решение. Командный инцидент с ролями как в реальном oncall. Оценивается командная коммуникация и скорость решения.

**Почему уникально:** первый режим который тренирует именно командную работу под давлением, а не индивидуальные навыки.

### 20.6 Cognitive Load Test (v2–v3)

Режим с постепенно нарастающими помехами:
1. Обычная задача
2. Таймер сжимается вдвое
3. Интервьюер задаёт вопросы пока пишешь код
4. Требования задачи меняются на ходу

AI строит "Cognitive Resilience Score" — насколько деградирует качество кода под давлением. Именно так устроены реальные интервью в FAANG.

### 20.7 Salary Radar (v2)

На основе skill atlas и рейтинга платформа показывает реальный диапазон зарплат прямо сейчас:

> *"Твой текущий уровень: 180–220k в Авито, 200–250k в Яндексе. Прокачай System Design до 70% → диапазон станет 250–300k."*

Данные агрегируются анонимно от пользователей которые прошли реальные собесы (через Interview Autopsy). Со временем самая точная зарплатная база по IT в РФ.

### 20.8 Code DNA (v2)

AI анализирует все решения пользователя и строит "генетический отпечаток кода" — паттерны, любимые подходы, типичные ошибки, стиль. Визуализируется как уникальная спираль которая меняется при росте навыков. Можно сравнить свою DNA с DNA топ-игроков.

Делится как красивая картинка — вирусный контент.

### 20.9 Blind Hiring Mode (v3–v4)

Компания задаёт требования. Платформа находит топ-кандидатов анонимно — без имён, фото, вузов. Только реальные навыки подтверждённые игрой:

> *"Кандидат A: 89/100 алгоритмы, 94/100 Go, прошёл 3 boss-подземелья, стресс-профиль стабильный, Cognitive Resilience Score: высокий."*

Компания раскрывает личность только тех кого хочет пригласить.

**Почему это убийца рынка:** решает hiring bias, даёт более качественный сигнал чем резюме. LinkedIn и HH не могут это сделать — у них нет реальных данных о навыках.

### 20.10 Dungeon Raid Events (v2–v3)

Раз в месяц — лимитированное событие:
- *"Яндекс открыл найм — 48 часов, топ-100 игроков получают реальный фастрек на собес"*
- *"Секретная компания X открыла скрытое подземелье только на выходные"*
- *"Война корпораций: Ozon vs Яндекс — за какую гильдию ты?"*

FOMO механика = взрывной трафик в определённые дни. B2B: компании платят за спонсирование события.

---

## 21. Финальная карта версий

```
v1–v2 (месяц 1–6):
  Ядро: Auth, Editor, AI-Mock, Arena 1v1, Skill Atlas, Season Pass
  Уникальное: AI-Native Round, Stресс-метрика, Replay, Психологический профиль
  Retention: Daily Kata, Interview Calendar, Streak
  Виральное: Interview Autopsy, Code Obituary, Real Offer Simulator, Twitch Overlay
  Соревновательное: Ghost Runs, Hardcore Mode, Проклятые задачи
  Данные: Salary Radar (накапливается), Code DNA

v3 (месяц 7–12, open source комьюнити):
  Multi-Track: QA, DevOps, Analyst, Security пути
  Role-specific AI Mock, Atlas ветки, Company Dungeons по ролям
  War Room — командные ЧП, Cognitive Load Test
  Blind Hiring Mode MVP, Dungeon Raid Events

v4 (месяц 13–18):
  Career Campaigns, AI Mentor Memory
  Guild Base, Company Raids
  Replay 2.0 Ghost System, Trusted Hiring Graph
  Creator Layer, Mobile Companion

v5 (месяц 18+):
  Daily Kata 2.0 — адаптивные серии, голос, мобильный режим
  Interview Calendar Pro — AI коуч, предсказание результата
  Twitch Overlay (skill atlas + матч в стриме), Speedrun таблицы рекордов
  Showmatch (публичные дуэли с AI-комментатором)
```


---

## 22. Новые киллер-фичи — второй раунд

### 22.1 "Тёмная лошадка" — анонимный рейтинг без имени

Новый соревновательный режим: ты выходишь на арену без username, без рейтинга, без истории. Просто ник-маска — "Тёмная лошадка #4821". Противник не знает кто ты. Победа засчитывается в рейтинг, но противник узнаёт кто победил только после матча.

**Почему мощно:** снимает психологический барьер против сильных соперников. Новички перестают бояться играть против сеньоров. Сеньоры получают непредсказуемые матчи. Создаёт легенды — "меня уничтожила Тёмная лошадка #777, оказалось это был топ-1 рейтинга."

**Вирусность:** скриншоты анонимных побед над сильными противниками.

### 22.2 "Код на стол" — публичный code roast

Пользователь добровольно выкладывает своё решение на публичный разбор. Сообщество голосует и комментирует: что плохо, что хорошо, как переписать. AI модерирует токсичность и агрегирует feedback в структурированный отчёт.

**Изюминка:** есть режим "Blind Roast" — код выложен анонимно, никто не знает чьё решение. Голосование заканчивается, потом раскрывается автор. Топ-игроки иногда выкладывают специально плохой код чтобы увидеть реакцию.

**Почему уникально:** публичное обучение через чужие ошибки. Контент генерируют пользователи. Платформа получает органический engagement.

### 22.3 "Зеркало интервьюера" — ты проводишь собес

Режим в котором пользователь становится интервьюером. AI играет роль кандидата с заданным уровнем (джун, мид, сениор). Задача: провести интервью, задать правильные вопросы, оценить кандидата, написать hiring decision.

**Что оценивается:**
- Качество вопросов (раскрывают ли они реальные навыки)
- Способность вытащить максимум из слабого кандидата
- Объективность финальной оценки

**Почему это мощно:** опытные разработчики которые сами проводят интервью — это огромный недооценённый сегмент. Им не нужно готовиться к собесу, но им нужно готовиться к роли интервьюера. Нигде этого нет.

**Монетизация:** "Interviewer Certificate" — верифицированный бейдж что ты умеешь проводить интервью. Компании платят за это как за сигнал.

### 22.4 "Технический долг" — живая карта легаси

Отдельный режим задач: тебе дают реальный "легаси-код" (специально написанный плохо) и ты должен:
- Найти все проблемы
- Приоритизировать рефакторинг
- Переписать критические части
- Написать план миграции без остановки продакшна

AI оценивает не только что исправил, но и в каком порядке и почему. Называется "Tech Debt Hunter" — новый класс персонажа.

**Почему уникально:** реальная работа разработчика на 80% состоит из работы с легаси. Все платформы учат писать с нуля. Никто не учит работать с чужим плохим кодом.

### 22.5 "Детектив" — debugging quest

Вместо "решить задачу" — "найти баг в работающей системе". Тебе дают: логи, метрики, код нескольких сервисов, описание симптомов от "пользователей". Нужно найти root cause.

**Механика:** как детективная игра. Запрашиваешь дополнительные данные (AI их генерирует), строишь гипотезы, проверяешь. Есть красные герринги — ложные следы. Финал: объясняешь причину и пишешь fix.

**Уровни сложности:**
- Easy: баг в одном месте, явные симптомы
- Hard: race condition, проявляется раз в 1000 запросов
- Boss: цепочка из 3 сервисов, баг появился 2 недели назад от казалось бы невинного PR

**Почему убийца:** debugging — самый важный навык разработчика и самый непроверяемый на обычных собесах. Первые кто делает это системно.

### 22.6 "Живое резюме" — auto-updated CV

После каждой активности платформа автоматически обновляет "живое резюме" пользователя:

```
Алексей Иванов — Go Backend Developer
Реальный уровень (обновлено вчера):
  Алгоритмы:    ████████░░ 82/100 (топ 15%)
  System Design:████████░░ 74/100 (топ 22%)
  SQL:          █████████░ 91/100 (топ 8%)

Верифицированные достижения:
  ✓ Прошёл подземелье Яндекс (Boss) — 14 янв 2025
  ✓ Топ-50 арены Go секции — сезон III
  ✓ AI-Native Round: Judgment Score 89/100

Публичная ссылка: druz9.online/cv/alexivanov
```

Встраивается в LinkedIn, HH.ru, Telegram-профиль как виджет. Обновляется автоматически — не нужно ничего делать.

**Почему вирусно:** разработчики хотят показывать рост. Это первое резюме которое обновляется само и содержит верифицированные данные а не самооценку.

### 22.7 "Ментор на один вопрос" — micro-mentoring

Пользователь задаёт один конкретный вопрос опытному разработчику на платформе. Не "научи меня Go", а "почему мой код на задаче Two Sum медленнее чем у топ-игроков". Ментор отвечает текстом или голосовым сообщением до 2 минут.

**Монетизация для менторов:** за ответ получают внутреннюю валюту которая конвертируется в Boosty-баллы или премиум-дни. Качество ответа оценивает AI и сам пользователь.

**Почему работает:** Stack Overflow мёртв для новичков — токсично и долго. Это быстрый асинхронный ответ от человека который только что сам прошёл этот путь.

### 22.8 "Предсказание собеса" — AI prediction engine

Перед реальным собесом пользователь указывает компанию и роль. AI на основе:
- Текущего skill atlas
- Истории моков в этой компании
- Паттернов других пользователей которые ходили в эту компанию
- Публичных данных о процессе найма

Выдаёт:
- Вероятность оффера в %
- Топ-5 тем которые скорее всего спросят
- Слабые места которые нужно закрыть за оставшееся время
- Оптимальный план подготовки

После собеса пользователь вводит результат → модель обучается → предсказания становятся точнее.

**Почему мощно:** это первый инструмент который говорит не "готовься лучше" а "вот твои конкретные шансы и вот что изменит расклад". Данные накапливаются с каждым Autopsy.

### 22.9 "Клан-академия" — гильдия обучает новичков

Гильдии могут открыть внутреннюю академию: создать учебный трек, добавить новичков как "студентов", назначить менторов из числа участников.

**Механика:**
- Студент проходит задания созданные гильдией
- Ментор видит прогресс и может оставлять комментарии
- По завершении трека — приглашение вступить в гильдию
- Гильдия получает XP за каждого успешно обученного студента

**Почему мощно:** это виральная петля. Опытные разработчики набирают комьюнити, учат новичков, те приходят на платформу. Гильдия сама становится маркетинговым каналом.

### 22.10 "Архив провалов" — Hall of Shame & Fame

Анонимный публичный архив самых интересных решений:
- Hall of Shame: самые творческие провалы (с согласия автора)
- Hall of Fame: самые элегантные решения
- "WTF Code": решение которое каким-то образом прошло все тесты но выглядит как ужас

Пользователи голосуют, лучшие попадают в еженедельный дайджест в Telegram-канале платформы.

**Почему работает:** юмор + обучение. Люди подписываются на канал ради мемов и остаются ради обучения. Telegram-канал как бесплатный маркетинговый канал.

---

## 23. Промпт для Claude Design — полная версия

```
Ты world-class product designer уровня Linear, Vercel, Figma.
Тебе нужно создать полную дизайн-систему и все ключевые экраны
для платформы druz9 (Друзья) — подготовки к техническим
собеседованиям в стиле Dark Fantasy RPG.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ВИЗУАЛЬНЫЙ ЯЗЫК
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Стиль: Path of Exile 2 + Diablo IV UI + Elden Ring меню.
Не "тёмная тема" — полноценный игровой интерфейс.
Геральдика, угловые орнаменты, рунические символы, Cinzel шрифт.

Персонаж в левом сайдбаре: SVG-геометрия из прямоугольников
и полигонов (голова, тело, броня, оружие, аура). Меняется
при прокачке. Никаких внешних изображений — код генерирует всё.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ТОКЕНЫ ДИЗАЙНА
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Цвета (использовать строго эти значения):
  bg-base:      #07080a   основной фон
  bg-surface:   #0d0e12   поверхности
  bg-card:      #12141a   карточки
  bg-panel:     #181c24   панели
  gold:         #c8a96e   главный акцент (XP, рамки, активные)
  gold-bright:  #e8c87a   имена, заголовки
  gold-dim:     #4a3c28   неактивные бордеры
  text-bright:  #e8dcc8   основной текст
  text-mid:     #9a8c76   вторичный текст
  text-dim:     #3a3428   третичный текст

Цвета секций (для узлов skill atlas, тегов, индикаторов):
  Алгоритмы:    fill #1a3a6a / accent #6a9fd4  (синий)
  SQL:          fill #0d2808 / accent #639922  (зелёный)
  Go/Backend:   fill #2a1800 / accent #EF9F27  (янтарный)
  SysDesign:    fill #1a1040 / accent #7F77DD  (фиолетовый)
  Behavioral:   fill #04180f / accent #1D9E75  (бирюзовый)

Сложность:
  Normal: #639922   Hard: #EF9F27   Boss: #c0392b

Шрифты:
  Заголовки/навигация: Cinzel Decorative (Google Fonts)
  UI / тело:           Inter
  Код:                 JetBrains Mono

Компоненты:
  Бордеры:     1px solid #4a3c28, ПРЯМЫЕ углы (не rounded)
  Угловые акценты: L-образные золотые линии в углах карточек
  Разделители: ✦ НАЗВАНИЕ ✦ + горизонтальные линии по бокам
  Кнопки:      прямые углы / один срезанный угол
  Иконки:      ◈ ⚜ ⚗ ⚔ ✦ ⊕ ◉ ⊘ (рунические, не emoji)
  Запрещено:   градиенты, тени, blur, скруглённые рамки

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
НАВИГАЦИЯ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Топбар (высота 48px):
  [DRUZ9] [Season II · The Recursion] | Sanctum Arena Guild Atlas Codex | [XP бар 62%] [Ascendant Lvl 24] [аватар-гексагон]

Разделы (игровые названия, не переводить):
  Sanctum  — главное лобби / профиль
  Arena    — PvP режимы
  Guild    — гильдия и войны
  Atlas    — skill tree
  Codex    — подкасты и обучение

Левый сайдбар (220px):
  SVG персонаж + имя (Cinzel Decorative, gold) + класс + уровень
  4 атрибута со шкалами (Интеллект/Сила/Ловкость/Воля)
  Меню: Практика (AI-мок, Live-мок, AI-Native Round, Редактор)
         Испытания (Арена 1v1, 2v2, Гильдийские войны)
         Тренировка (Daily Kata, Interview Calendar)

Правый сайдбар (180px):
  4 флакона силы разного заполнения (синий/красный/зелёный/янтарный)
  Топ-5 рейтинга лиги (твоя позиция выделена gold)
  Сезонный трек с ромбовидными чекпоинтами

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ЭКРАНЫ ДЛЯ ДИЗАЙНА
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ЭКРАН 1 — SANCTUM (главное лобби)
Layout три колонки (220px | flex | 180px):

Центральная зона:
  Верх: заголовок ✦ ПОДЗЕМЕЛЬЯ КОМПАНИЙ ✦
  Сетка 3×2: карточки компаний с угловыми L-акцентами
    Каждая карточка: бейдж Normal/Hard/Boss, название компании,
    "N секций · M испытаний", прогресс-бар, иконка ◈
    Locked карточка: иконка ⊘, opacity 0.35, "Требуется Lvl N"
  Ниже: ✦ ХРОНИКИ БИТВ ✦ — лог активности
    Строки: иконка ⚔/⚗/✦ + текст активности + XP справа

ЭКРАН 2 — AI-МОК СЕССИЯ
Шапка: хлебные крошки (Ozon › Leetcode › Two Sum) + таймер в gold рамке
Прогресс 5 секций: пилюли в ряд (done=зелёные, active=фиолетовая, locked=серые)
Layout (60% | 40%):
  Редактор (60%): Monaco Editor, bg #0a0c10, Go синтаксис,
    нумерация строк gold-dim, мигающий курсор
  AI панель (40%): заголовок "AI-интервьюер" + статус-dot,
    сообщения двух типов:
      Серое (вопрос): bg #13161e, border #1e2130
      Янтарное (предупреждение): bg #200d00, border #854F0B, текст #EF9F27
      Красное (стоп): bg #1a0808, border #8b1a1a, текст #c0392b
    Стресс-метрика (три шкалы): Паузы / Откаты / Хаос правок

ЭКРАН 3 — AI-NATIVE ROUND
Похож на AI-мок но с отличиями:
  Бейдж "AI ALLOWED" в шапке (фиолетовый, gold бордер)
  Правая панель разделена на три зоны:
    Верх: AI-ассистент чат (встроен прямо в сессию)
    Середина: Provenance Graph — визуальная лента:
      [AI draft] → [human revision] → [accepted/rejected]
      Цвета: AI = фиолетовый, human = gold, rejected = красный dim
    Низ: три score-индикатора (Context / Verification / Judgment)
      в реальном времени, обновляются по ходу сессии

ЭКРАН 4 — SKILL ATLAS
Полный экран, тёмный фон с еле заметной сеткой точек:
  Центральный узел: большой, gold, класс персонажа, r=20px
  5 ветвей расходятся в разные стороны (каждая своим цветом)
  Узлы малые (r=9px): обычные навыки
  Узлы крупные (r=14px): keystone достижения
  Пройденные: залиты цветом + слабое свечение + маленький ✓
  Заблокированные: bg #12141a, бордер #2a2d38, пунктирные связи
  Особый узел ⚜ Вознесение: большой, gold, требует 80%+ в 2 секциях
  Hover: показывает название + описание + стоимость в очках
  Нижняя легенда: цвета 5 секций

ЭКРАН 5 — ПРОФИЛЬ + WEEKLY REPORT
Hero-зона: SVG персонаж (крупнее) + имя + класс + уровень + XP бар
  Рядом с персонажем: класс + атрибуты + косметика

Блок Weekly AI Report:
  Заголовок ✦ ОТЧЁТ ЗА НЕДЕЛЮ ✦
  4 метрики-карточки (стиль PoE stat): задачи / победы / рейтинг / XP
  Тепловая карта активности: 7 дней × интенсивность (gold градации)
  3 AI-рекомендации как карточки с иконками ◈ и кнопками

Карьерная линия (горизонтальная):
  Junior → Middle → Senior → Staff → Principal
  Текущая позиция помечена gold ромбом

Мини Skill Atlas: уменьшенный preview, слабые узлы мигают dim

ЭКРАН 6 — АРЕНА 1v1
  Шапка: имя + ELO игрока 1 | ТАЙМЕР (большой, центр) | имя + ELO игрока 2
  Split: два Monaco редактора рядом (каждый 50%)
  Над каждым редактором: статус тестов (зелёный прогресс / красный fail)
  Снизу: статус "Ищем соперника..." → "Соперник найден!" → "Готов?" кнопки

ЭКРАН 7 — DAILY KATA
  Компактный экран, не полная страница:
  Streak счётчик (большой, в центре, gold число + "дней подряд")
  Текущая задача дня: название + сложность + секция + время
  Прогресс этой недели: 7 ячеек (выполнено/нет/сегодня)
  Freeze токены: иконка ❄ + остаток
  Кнопка "Начать Kata" (крупная, gold бордер)

ЭКРАН 8 — INTERVIEW CALENDAR
  Большой countdown таймер: "До собеса в Яндекс: 21 день"
  Круговой прогресс "готовность": N%
  Сегодняшний план: 2–3 задания с чекбоксами
  Недельный план: 7 колонок с заданиями
  Слабые зоны которые нужно закрыть: список с приоритетами

ЭКРАН 9 — ГИЛЬДЕЙСКАЯ ВОЙНА
  Заголовок: [Герб гильдии A] vs [Герб гильдии B] — осталось N дней
  5 линий войны (одна под другой):
    Каждая: название секции + прогресс-бар A (слева, gold) vs B (справа, red)
    + вклад участников иконками аватаров
  Внизу: вклад каждого участника (имя + очки + статус линии)

ЭКРАН 10 — INTERVIEW AUTOPSY
  Форма ввода в стиле "протокол расследования":
    Компания (выбор из списка), Секция, Дата
    "Что спросили" — textarea с подсказкой
    "Что ответил" — textarea
    "Чем закончилось" — выбор: оффер / отказ / думают
  После отправки: полноэкранный AI разбор в стиле
    "РАЗБОР ПРОВАЛА" с секциями:
    Причина провала / Что сказать нужно было /
    Слабые узлы atlas / План восстановления

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
МОБИЛЬНАЯ ВЕРСИЯ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Отдельный экран для Daily Kata на телефоне:
  Компактный редактор / квиз
  Streak крупно
  Telegram-стиль уведомление "Ваша Kata готова"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ДОПОЛНИТЕЛЬНО
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Онбординг (5 экранов):
  1. Выбери путь — три большие карточки с иконками
  2. Быстрый тест — 5 вопросов, прогресс-бар
  3. Твой персонаж — анимированное появление класса
  4. Первое подземелье — стрелка указывает на карточку компании
  5. Что дальше — три крупные кнопки действий

Пустые состояния (empty states):
  Арена без соперника: анимированный поиск в стиле RPG
  Skill Atlas новичка: всё серое, только центральный узел gold
  Гильдия без войны: "Следующая война через N дней"

Анимации (указать где):
  Level up: золотые частицы снизу вверх
  XP gain: +120 XP float вверх с fade
  Skill node unlock: пульсация свечения
  Match found: красная вспышка по краям экрана

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ФОРМАТ РЕЗУЛЬТАТА
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Нужно:
1. Design tokens (CSS переменные)
2. Компонент-библиотека (кнопки, карточки, бейджи, шкалы)
3. Все 10 экранов в полном разрешении (1440px desktop)
4. Мобильные версии для Daily Kata и профиля
5. Состояния компонентов: default / hover / active / disabled / empty
6. Анимационные спецификации

Дизайн должен ощущаться как настоящая RPG-игра.
Пользователь — герой строящий билд, а не студент на курсе.
Каждый экран усиливает это ощущение.
```

---

## 24. Промпт для Claude Opus — бэкенд + OpenAPI спецификация

```
Ты Senior Go-разработчик и Tech Lead.
Работаешь над druz9 — платформой подготовки к техническим
собеседованиям с RPG-геймификацией (Dark Fantasy стиль).

Твоя первая задача: написать полную OpenAPI 3.1 спецификацию
для всех эндпоинтов MVP (v1–v2). Это единственный источник
правды — фронт и бэк генерируют код из этой спецификации.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
КОНТЕКСТ ПРОЕКТА
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Домены платформы:
  auth         — Яндекс OAuth, Telegram Login Widget, JWT
  editor       — совместный редактор, WebSocket, Yjs OT
  arena        — PvP матчи, матчмейкинг, WebSocket
  ai_mock      — AI интервью, LLM через OpenRouter
  ai_native    — AI-Native Round, Provenance Graph, scoring
  rating       — ELO/MMR, skill atlas, weekly report
  guild        — гильдии, войны, участники
  profile      — профиль, прогрессия, достижения
  notify       — уведомления Telegram/email
  season       — season pass, задания, награды
  admin        — CMS, задачи, компании, dynamic config
  daily        — Daily Kata, Interview Calendar, Autopsy

Стек:
  Go 1.22, Go Workspaces, chi router, pgx/v5, sqlc, goose
  PostgreSQL 16, Redis 7, ClickHouse, MinIO
  Judge0 self-hosted (sandbox)
  OpenRouter (LLM gateway)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
АРХИТЕКТУРА — Go Workspaces
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

backend/services/{domain}/
  domain/    entity, interfaces, domain services (без фреймворков)
  app/       use cases, оркестрация
  infra/     реализации (postgres, redis)
  ports/     HTTP handlers, WebSocket hub

backend/shared/
  enums/     ВСЕ enum'ы (Section, MessageRole, Difficulty,
             LLMModel, MatchStatus, SubscriptionPlan...)
  domain/    typed domain events
  pkg/       logger, config, middleware

Правило: домены не импортируют друг друга.
Общение только через EventBus и shared/domain/events.go.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА КОДА
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ENUMS — никаких string/int для ограниченных значений:
   type Section string
   const (
     SectionAlgorithms   Section = "algorithms"
     SectionSQL          Section = "sql"
     SectionGo           Section = "go"
     SectionSystemDesign Section = "system_design"
     SectionBehavioral   Section = "behavioral"
   )
   Каждый enum: IsValid() bool + String() string

2. ОШИБКИ — всегда оборачивать:
   return fmt.Errorf("arena.StartMatch: %w", err)

3. CONTEXT — первым параметром везде

4. БД — только sqlc, никаких ORM

5. ЛИНТЕР — перед каждым ответом проверь:
   ✓ Все error обработаны
   ✓ Нет fmt.Println (только slog)
   ✓ Switch по enum — все значения (exhaustive)
   ✓ HTTP функции принимают context (noctx)
   ✓ Ошибки обёрнуты с контекстом (wrapcheck)

6. solution_hint из tasks — НИКОГДА не отдавать клиенту

7. LLM приоритет: user pref → task → section → company → default

8. Заглушки помечать: // STUB: описание

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ЗАДАЧА #1: OpenAPI спецификация
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Напиши shared/openapi.yaml для следующих групп эндпоинтов:

AUTH:
  POST /api/v1/auth/yandex          — OAuth callback
  POST /api/v1/auth/telegram        — Telegram Login Widget
  POST /api/v1/auth/refresh         — refresh JWT
  DELETE /api/v1/auth/logout        — выход

PROFILE:
  GET  /api/v1/profile/me           — текущий профиль
  GET  /api/v1/profile/{username}   — публичный профиль
  GET  /api/v1/profile/me/atlas     — skill atlas узлы
  GET  /api/v1/profile/me/report    — weekly AI report

ARENA:
  POST /api/v1/arena/match/find     — поиск матча
  DELETE /api/v1/arena/match/cancel — отмена поиска
  GET  /api/v1/arena/match/{id}     — статус матча
  POST /api/v1/arena/match/{id}/submit — сдать решение
  WS   /ws/arena/{matchId}          — WebSocket матча

AI_MOCK:
  POST /api/v1/mock/session         — создать сессию
  GET  /api/v1/mock/session/{id}    — статус сессии
  POST /api/v1/mock/session/{id}/message — отправить сообщение
  GET  /api/v1/mock/session/{id}/report  — итоговый отчёт
  WS   /ws/mock/{sessionId}         — WebSocket сессии

AI_NATIVE:
  POST /api/v1/native/session       — создать AI-Native Round
  POST /api/v1/native/session/{id}/prompt — отправить промпт к AI
  GET  /api/v1/native/session/{id}/provenance — граф происхождения
  GET  /api/v1/native/session/{id}/score  — текущие scores

DAILY:
  GET  /api/v1/daily/kata           — задача дня
  POST /api/v1/daily/kata/submit    — сдать решение
  GET  /api/v1/daily/streak         — текущий streak
  POST /api/v1/daily/calendar       — создать/обновить Interview Calendar
  GET  /api/v1/daily/calendar       — текущий план
  POST /api/v1/daily/autopsy        — создать Interview Autopsy
  GET  /api/v1/daily/autopsy/{id}   — результат Autopsy

RATING:
  GET  /api/v1/rating/leaderboard   — топ по секции
  GET  /api/v1/rating/me            — мой рейтинг по секциям

GUILD:
  GET  /api/v1/guild/my             — моя гильдия
  GET  /api/v1/guild/{id}/war       — текущая война
  POST /api/v1/guild/{id}/war/contribute — вклад в линию войны

ADMIN:
  GET/POST/PUT /api/v1/admin/tasks
  GET/POST/PUT /api/v1/admin/companies
  GET/PUT      /api/v1/admin/config  — dynamic config
  GET          /api/v1/admin/anticheat

Требования к спецификации:
  - OpenAPI 3.1 формат
  - Все схемы с $ref в components/schemas
  - Все enum'ы как отдельные $ref компоненты
  - Коды ошибок: 400 (validation), 401 (auth), 403 (forbidden),
    404 (not found), 429 (rate limit), 500 (internal)
  - Описание каждого поля
  - Примеры запросов и ответов
  - WebSocket эндпоинты документировать через x-websocket

После написания спецификации жди подтверждения,
затем приступай к реализации домен за доменом.

Порядок реализации:
  1. shared/enums + shared/domain/events
  2. auth домен
  3. profile домен (заглушки atlas и report)
  4. daily домен (Kata + Calendar + Autopsy)
  5. arena домен
  6. ai_mock домен
  7. ai_native домен
  8. rating домен
  9. guild домен
  10. season домен
  11. notify домен
  12. admin домен

Для каждого домена:
  1. Предложи структуру файлов
  2. Жди подтверждения
  3. Напиши domain/ слой
  4. Напиши app/ use cases
  5. Напиши infra/ реализации
  6. Напиши ports/ HTTP/WS handlers
  7. Напиши unit тесты с mockgen
```


---

## 25. Twitch Overlay — интеграция вместо замены

Вместо встроенного стриминга — Twitch Extension (Overlay) который работает поверх любого стрима.

**Что показывает overlay:**
- Текущий skill atlas пользователя в углу экрана
- Live статус матча: таймер, соперник, секция
- XP и streak в реальном времени
- Уведомление когда выиграл/проиграл матч
- "Replay этого решения" — ссылка для зрителей

**Как подключается:** стример авторизуется через druz9 в Twitch Extension Manager, выбирает что показывать. Никакой инфраструктуры на нашей стороне — только Twitch Extension API.

**Почему это лучше:** стримеры уже на Twitch. Мы не конкурируем с их привычкой, а даём им инструмент который делает стрим интереснее. Каждый стример с нашим оверлеем — живая реклама платформы.

**Speedrun таблицы (без стриминга):** отдельная публичная страница рекордов по каждой задаче и компании-подземелью. Стримеры бьют рекорды на Twitch, зрители проверяют таблицу на druz9. Связь между платформами без технической сложности.

**Showmatch (асинхронный формат):** два топ-игрока объявляют дату матча, зрители приходят в арену druz9 как spectators. Не стрим — просто публичный матч с аудиторией. AI-комментатор пишет текстовый разбор в реальном времени.

---

## 26. Стратегия контента на старте

### Принцип

Не покрывать всё сразу. 20 отличных задач лучше 200 средних.
Пользователь должен пройти полный цикл одного AI-мока и почувствовать ценность — вот критерий минимального контента.

### Минимальный набор для запуска

**Алгоритмы — 30 задач:**
- 10 Easy: Two Sum, Valid Parentheses, Reverse Linked List, Maximum Subarray, Climbing Stairs, Contains Duplicate, Best Time to Buy Stock, Valid Palindrome, Merge Two Lists, Binary Search
- 15 Medium: LRU Cache, Merge Intervals, Group Anagrams, Top K Elements, Word Search, Coin Change, Number of Islands, Longest Substring, Rotate Array, Product Except Self, Jump Game, 3Sum, Unique Paths, Find Duplicate, Sort Colors
- 5 Hard: Trapping Rain Water, Median of Arrays, N-Queens, Word Ladder, Regular Expression

**SQL — 15 задач:**
Агрегации, оконные функции (ROW_NUMBER, LAG/LEAD), CTE, рекурсивные запросы, JOIN сложные кейсы, индексы и планы. Реальные кейсы которые спрашивают в Avito и Ozon.

**Компании — 3 для запуска:**
- Avito (Normal) — существующие задачи + специфические follow-up вопросы
- Ozon (Hard) — тот же принцип
- Яндекс (Boss) — разблокируется от Lvl 30

Компания = набор уже существующих задач сгруппированных в секции + уникальные follow-up вопросы под стиль компании. Не нужно писать новые задачи для каждой компании.

**System Design и Behavioral:**
Не задачи в классическом смысле — качественные промпты и scoring rubrics. Пишутся один раз. 10 SD сценариев + 15 behavioral вопросов достаточно для запуска.

### Три источника контента параллельно

**1. Ты сам — первые 30 задач за неделю:**
LeetCode задачи нельзя копировать, но паттерн можно переиспользовать с другим контекстом.
Two Sum → "Найди два числа в массиве транзакций которые дают целевую сумму".
Та же механика, другой контекст, оригинальный контент.

**2. Open source комьюнити:**
В CONTRIBUTING.md — раздел "Как добавить задачу" с шаблоном:
```markdown
## Шаблон задачи
- title_ru / title_en
- description (markdown)
- difficulty: easy/medium/hard
- section: algorithms/sql/go/system_design/behavioral
- starter_code (Go + Python)
- test_cases (минимум 5: 3 открытых + 2 скрытых)
- follow_up_questions (2-3 вопроса)
- solution_hint (только для AI)
```
Оффер для первых контрибьюторов: premium навсегда за каждые 3 качественно добавленные задачи.

**3. AI-генерация с проверкой:**
Claude Opus генерирует задачи по паттерну — ты задаёшь тип (sliding window, BFS, DP), он генерирует задачу с тест-кейсами. Ты проверяешь и правишь. Скорость: 10-15 задач в час.

### Поддержание качества

- Рейтинг задачи пользователями (1-5 звёзд) накапливается автоматически
- Минимальный рейтинг для показа в AI-моке: 3.5+
- Поле `is_active` — деактивировать плохие задачи без удаления
- Поле `version` — фиксирует версию на момент матча (честность арены)
- Скрытые тест-кейсы (is_hidden=true) — пользователь не видит до сдачи

### Подкасты — добавить через 2-3 месяца

Первый контент: твои собственные разборы задач в формате аудио, записанные за выходные. Потом — приглашённые разработчики из комьюнити.

---

## 27. SEO и органический трафик

### Принцип

Платформа за логином невидима для поисковиков. Решение — вынести несколько типов страниц наружу как публичный контент. Они работают как постоянный источник трафика без рекламного бюджета.

### Публичные страницы с высоким SEO-потенциалом

**`/u/{username}` — публичный профиль:**
Skill atlas, верифицированные достижения, карьерная линия, статистика.
Запросы: "[имя разработчика]", "разработчик [компания]".
Пользователи сами мотивированы делиться ссылкой — ставят в резюме и LinkedIn.

**`/salary` — зарплатная база:**
Анонимная агрегация из Interview Autopsy данных по ролям и компаниям.
Запросы: "зарплата Go разработчика 2025", "сколько платят в Яндексе backend".
Это один из самых частых запросов в IT — конкурентов много но актуальных данных мало.
Обновляется автоматически с каждым новым Autopsy — всегда актуально.

**`/companies/{slug}` — страница компании:**
Анонимная статистика: какие секции спрашивают, средний балл прошедших, топ темы, частота вопросов.
Запросы: "собес в Яндекс 2025", "как пройти интервью в Avito", "что спрашивают в Ozon".
Миллионы запросов в год. Страница отвечает лучше любого форума — данные реальные и свежие.

**`/problems/{slug}` — страница задачи:**
Разбор подходов к решению (без кода), сложность, статистика платформы.
Запросы: "Two Sum решение объяснение", "LRU Cache алгоритм".
Предлагает попрактиковаться → конвертирует в регистрацию.

**`/blog` — технический блог:**
Статьи: "Как я прошёл собес в Яндекс за 30 дней", "Топ-10 ошибок на System Design интервью", "Разбор: почему 80% проваливают SQL секцию".
Пишутся один раз, трафик идёт годами. Цель: 1-2 статьи в месяц.

**`/cv/{username}` — живое резюме:**
Виджет для встраивания в LinkedIn / HH.ru / GitHub профиль.
Обновляется автоматически. Каждый виджет = ссылка на платформу.

### Техническая реализация

Публичные страницы — отдельный легковесный Go-сервис (SSR) который рендерит HTML для поисковиков. Основное React SPA остаётся как есть. Не нужен Next.js для всего — только для публичных страниц.

```
public-svc/   — отдельный Go-сервис
  handlers/
    profile.go    GET /u/{username}
    company.go    GET /companies/{slug}
    salary.go     GET /salary
    problem.go    GET /problems/{slug}
    blog.go       GET /blog/{slug}
  templates/    HTML шаблоны (html/template)
```

**Structured data (JSON-LD)** на страницах компаний и задач — Google показывает rich snippets в результатах поиска.

**Sitemap** автогенерируется из БД: все публичные профили, все компании, все публичные задачи. Обновляется раз в час.

**Open Graph теги** на всех публичных страницах — красивый превью при шаринге в Telegram и соцсетях.

---

## 28. Community-driven growth

### Фаза 0 — до запуска (за 2-3 недели)

Не анонсируй платформу — анонсируй проблему.

Пост в своих каналах:
> *"Я устал от LeetCode. Готовлюсь к собесу и понимаю что все существующие инструменты это просто списки задач без контекста и без фидбека. Строю что-то другое — RPG-платформу где ты не решаешь задачи, а прокачиваешь персонажа. Кто хочет помочь сформировать продукт?"*

Собираешь 20-30 человек которые хотят участвовать в создании. Это будущее ядро комьюнити.

### Фаза 1 — закрытая бета (первые 50 человек)

**Оффер конкретный:**
"Premium навсегда если в течение месяца: добавляешь задачи, находишь баги, даёшь фидбек по каждому экрану. Нужно минимум 5 осмысленных действий в неделю."

Это не просто пользователи — это совладельцы продукта. Они рассказывают другим потому что вложили своё время.

Закрытая бета создаёт FOMO — "только 50 мест" работает лучше чем "открыто для всех".

**Tracking:** таблица бета-тестеров с их вкладом. Публичная внутри команды — создаёт здоровую конкуренцию за активность.

### Фаза 2 — публичный запуск

**Не Product Hunt** — там нет твоей аудитории.

**Telegram каналы (приоритет):**
- golang_ru (~25k участников)
- backend_ru, devops_ru
- Чаты по собесам в IT компаниях (их много в Telegram)
- Русскоязычные чаты разработчиков

Формат поста — не реклама, история:
> *"Полгода строил платформу для подготовки к собесам потому что сам ненавижу LeetCode. Сделал RPG-игру где ты прокачиваешь персонажа вместо решения задач в пустоту. AI-мок интервьюер анализирует стресс по паттернам набора кода, skill tree как в Path of Exile, арена 1v1 с ELO рейтингом. Вот ссылка — первые 100 регистраций получают premium на 3 месяца."*

**Хабр статья:**
"Как я построил RPG-платформу для подготовки к собесам на Go за N месяцев"
Технический разбор: WebSocket арена, AI-мок архитектура, стресс-метрика, Go Workspaces.
Хабр даёт 5-20k просмотров за первый день для хорошей технической статьи.
Плюс остаётся в поиске навсегда — долгосрочный органический трафик.

**GitHub репозиторий:**
Хороший README с GIF-демо, чёткое описание, инструкция по запуску.
Звёзды приходят сами от технического комьюнити. 100+ звёзд = социальное доказательство.

### Виральные петли

**Interview Autopsy → шаринг:**
После разбора провала — кнопка "Поделиться анонимным разбором". Генерирует красивый пост для Telegram. Люди читают чужие провалы с удовольствием — честный контент которого нигде нет. Один пост = 10-20 новых пользователей.

**Code Obituary → мемы:**
Смешной некролог решению расшаривается в тематических чатах. Мем формат не воспринимается как реклама. Один виральный некролог = сотни переходов.

**Публичный skill atlas → резюме:**
Разработчик ставит ссылку `druz9.online/u/username` в LinkedIn и HH.ru.
Рекрутер переходит → видит платформу → рассказывает другим кандидатам.
Это пассивный постоянный источник трафика.

**Живое резюме виджет → LinkedIn:**
Каждый виджет в чужом LinkedIn профиле = реклама платформы для всех кто смотрит этот профиль.

**Daily Kata streak → Telegram:**
"Я на 30-дневном стрике в druz9" — люди делятся streak как в Duolingo.
Автоматическое поздравление в бот при достижении 7/30/100 дней + кнопка "Поделиться".

### Метрики первых 3 месяцев

Главная метрика — **NPS (Net Promoter Score)**, а не DAU.
Спрашиваешь раз в месяц: "По шкале 0-10 как вероятно вы порекомендуете druz9 другу?"
NPS > 50 = продукт работает, рост будет органическим.
NPS < 30 = что-то фундаментально не так, нужно разбираться до масштабирования.

Дополнительные метрики:
- Доля пользователей которые вернулись на 7-й день (D7 retention > 25%)
- Количество задач добавленных комьюнити (цель: 50% контента от комьюнити к месяцу 3)
- Среднее время первой сессии (> 20 минут = хороший знак)
- Конверсия регистрация → первый завершённый AI-мок (цель > 60%)

