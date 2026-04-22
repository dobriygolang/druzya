# druz9 — Project Bible

> Compact onboarding doc для Claude / Cursor / любого нового разработчика.
> Версия 3.0 · apr 2026 · домены druz9.online · druz9.ru
> Старая многостраничная версия — `druz9-bible-archive.md`.

---

## 1. Что это

**druz9** (Друзья) — гейм-фицированная платформа подготовки к техническим собеседованиям.

- **Аудитория:** разработчики junior–senior, готовящиеся к собесам в IT-компании (FAANG / Yandex / Tinkoff / VK / Avito / Ozon).
- **Чем отличается:** не "очередной LeetCode". Live-дуэли с другими разработчиками (1v1 / 2v2), AI mock-интервью, peer mock-интервью с человеком, гильдии с командными войнами, Skill Atlas (PoE-style web прогресс), сезонные награды, daily kata streak, viral-фичи (Code Obituary, Ghost Runs, Necromancy).
- **Платформа:** web-first (React SPA), мобильный браузер тоже работает (responsive). Native app — позже.
- **Визуал:** modern dark professional (Linear / Vercel / Raycast вайб). Не RPG — серьёзный pro-tool с геймификацией в механиках.
- **Языки:** русский (основной), английский (i18n готов).
- **Темы:** dark + light (toggle).

---

## 2. Стек

### Frontend (`frontend/`)
- **React 18 + TypeScript + Vite**
- **Tailwind CSS 3.4** — все токены в `tailwind.config.ts` через CSS-переменные
- **TanStack Query** — серверный стейт
- **React Router v6** — все 47 страниц через lazy import
- **Framer Motion** — page transitions, hover/tap, stagger
- **Lucide React** — иконки
- **i18next** — RU/EN, namespaced JSON в `src/locales/{ru,en}/`
- **MSW** — моки API в dev (`src/mocks/handlers/`)
- **Native WebSocket** — live-страницы (Arena/Spectator/Mock/WarRoom)
- **Sentry** — error tracking + replay (через `VITE_SENTRY_DSN`)
- **Playwright** — E2E (`tests/e2e/`)

### Backend (`backend/`)
- **Go 1.25, модульный монолит** через Go Workspaces
- **PostgreSQL 16** — основное хранилище, sqlc для типобезопасных запросов
- **Redis 7** — матчмейкинг, кеши, rate limit, WS pub/sub
- **MinIO** — S3-совместимое хранилище (replays, podcasts, аватары)
- **ClickHouse** — аналитика (events, mock_analytics)
- **Judge0** — sandbox для исполнения кода (изолированный Docker network)
- **chi** router, **pgx/v5**, **goose** миграции, **golangci-lint**, **mockgen**

Каждый домен — отдельный Go-модуль (`backend/services/{arena,ai_mock,auth,editor,rating,guild,profile,notify,season,podcast,admin}`). Общаются только через `shared/domain/events.go` (event bus). Прямые импорты между сервисами запрещены — это держит границы для будущей миграции в микросервисы.

### Инфраструктура
- **VPS в Германии** (один сервер для MVP)
- **Docker Compose** для всех сервисов в двух сетях (`app-net` + изолированный `judge-net`)
- **Nginx** — реверс-прокси, SSL Let's Encrypt
- **GitHub Actions** — CI/CD с ручным апрувом для prod

---

## 3. Модули платформы (что уже спроектировано)

| Модуль | Backend service | Frontend page(s) | Статус |
|---|---|---|---|
| Auth (Yandex + Telegram OAuth) | `auth` | (через main app) | designed |
| Sanctum (главный хаб) | `profile` + composite | `/sanctum` | UI done |
| Arena 1v1 + 2v2 | `arena` | `/arena`, `/arena/match/:id`, `/arena/2v2/:id` | UI done |
| Custom Lobby (peer rooms) | `editor` | `/lobby` | UI done |
| AI Mock Review (Coding Interview) | `ai_mock` | `/mock/:id`, `/mock/:id/result`, `/mock/:id/replay` | UI done |
| AI-allowed Interview (AI-Native) | `ai_mock` | `/native/:id` | UI done |
| System Design Interview (canvas) | `ai_mock` | `/sd-interview/:id` | UI done |
| Voice Mock Interview | `ai_mock` | `/voice-mock/:id` | UI done |
| Mock Online (Human peer) | `slot` | `/slots` | UI done |
| Daily Kata + Streak | `daily` | `/daily`, `/daily/streak` | UI done |
| Skill Atlas (PoE-style tree) | `profile` | `/atlas` | UI done |
| Codex (подкасты) | `podcast` | `/codex` | UI done |
| Profile + Leaderboard | `profile`, `rating` | `/profile` | UI done |
| Guilds + War Room | `guild` | `/guild`, `/guild/warroom/:id` | UI done |
| Tournaments | `arena` | `/tournament/:id` | UI done |
| Spectator + Replay | `arena` | `/spectator/:id` | UI done |
| Match History + Diff | `arena` | `/history` | UI done |
| Match End (post-game) | `arena` | `/match/:id/end` | UI done |
| Season Pass + Shop | `season` | `/season` | UI done |
| Achievements | `profile` | `/achievements` | UI done |
| Hero Cards Collection | `profile` | `/cards` | UI done |
| Interview Calendar (countdown plan) | `profile` | `/calendar` | UI done |
| Interview Autopsy (post-real-interview) | `ai_mock` | `/autopsy/:id` | UI done |
| Code Editor / Playground | `editor` | `/playground` | UI done |
| Code Obituary (viral epitaph) | `arena` | `/obituary/:id` | UI done |
| Ghost Runs (replay overlay) | `arena` | `/practice/ghosts/:id` | UI done |
| Necromancy (find bug bounty) | `daily` | `/necromancy/:id` | UI done |
| Dungeons (companies map) | `profile` | `/dungeons` | UI done |
| Weekly AI Report + Heatmap | `profile` | `/report` | UI done |
| Stress Meter | `ai_mock` | `/stress` | UI done |
| Notifications | `notify` | `/notifications` | UI done |
| Friends Hub | `profile` | `/friends` | UI done |
| Settings | `profile` | `/settings` | UI done |
| Help / FAQ | `(static)` | `/help` | UI done |
| Welcome / Onboarding 4 шага | `auth` | `/welcome`, `/onboarding`, `/onboarding/done` | UI done |
| 404 / network error | — | `/*`, inline | UI done |
| Status page (uptime) | — | `/status` | UI done |
| Admin panel | `admin` | `/admin` | UI done |

**Итого:** 47 React-страниц + 5 переиспользуемых компонентов (Button, Card, Avatar, Tabs, AppShell) + WS layer + i18n RU/EN + dark/light themes + responsive 390px–1440px.

Все backend-сервисы — designed (есть структура и enums), не все реализованы. См. `backend/services/<name>/` для деталей.

---

## 4. Архитектура

```
druz9/
├── backend/
│   ├── services/                # один Go-модуль на домен
│   │   ├── arena/               # PvP, матчмейкинг, ELO
│   │   │   ├── go.mod
│   │   │   ├── domain/          # entity + interfaces (чистые, без фреймворков)
│   │   │   ├── app/             # use cases
│   │   │   ├── infra/           # postgres, redis реализации
│   │   │   └── ports/           # HTTP handlers, WS hub
│   │   ├── ai_mock/             # mock-интервью, AI session
│   │   ├── auth/                # OAuth, JWT, sessions
│   │   ├── editor/              # collaborative editor rooms
│   │   ├── guild/               # гильдии, войны
│   │   ├── notify/              # Telegram, email, web push
│   │   ├── podcast/             # подкасты, прогресс
│   │   ├── profile/             # профиль, skill atlas, achievements
│   │   ├── rating/              # ELO, leaderboards
│   │   ├── season/              # season pass, прогресс
│   │   ├── slot/                # human mock booking
│   │   └── admin/               # CRUD панель
│   ├── shared/                  # module druz9/shared
│   │   ├── enums/               # ВСЕ enum'ы здесь, метод IsValid() у каждого
│   │   ├── domain/events.go     # типизированные domain events
│   │   └── pkg/                 # logger, config, middleware, otel
│   ├── cmd/monolith/            # точка входа MVP — один бинарник
│   └── tools/                   # codegen tools (вне workspace)
├── frontend/
│   ├── src/
│   │   ├── components/          # Button, Card, Avatar, Tabs, AppShell, ws/, RouteLoader
│   │   ├── pages/               # 47 страниц, lazy imports в App.tsx
│   │   ├── lib/                 # apiClient, queries/, ws/, theme.ts, i18n.ts, observability.ts, motion.ts, cn.ts
│   │   ├── locales/{ru,en}/     # i18n JSON namespaces
│   │   ├── mocks/               # MSW handlers (по домену)
│   │   ├── api/generated/       # gen из docs/legacy/openapi-v1.yaml
│   │   ├── styles/main.css      # Tailwind + CSS vars (dark/light)
│   │   └── main.tsx             # bootstrap + ErrorBoundary + i18n + MSW + QueryClient
│   ├── tests/e2e/               # Playwright
│   ├── public/                  # robots.txt, sitemap.xml, manifest, favicon
│   └── tailwind.config.ts       # design tokens
├── proto/                       # gRPC schemas (для будущих микросервисов)
├── infra/                       # docker, nginx, ansible
├── docs/                        # observability.md и т.д.
├── design/v2/druz9.pen          # источник правды дизайна (Pencil)
├── go.work                      # Go workspace
└── docker-compose.yml
```

### Стратегия: модульный монолит → микросервисы

Один разработчик + 1–2 месяца до MVP = микросервисы сразу убьют темп. Сейчас — модульный монолит с **строгими границами доменов** через Event Bus. Когда домен начнёт упираться в нагрузку — вырезается в отдельный сервис за неделю (границы уже есть).

**Когда резать:**
- `arena` → отдельный сервис при WebSocket > 500 одновременно
- `ai_mock` → когда LLM запросы блокируют API
- `notify` → когда очередь > 10k/час
- `editor` → когда совместных сессий > 200

### Event Bus
Домены **не импортируют друг друга**. Только через события:
```go
eventBus.Publish(ctx, events.MatchCompleted{...})
// в cmd/monolith/main.go:
bus.Subscribe("MatchCompleted", ratingService.OnMatchCompleted)
bus.Subscribe("MatchCompleted", notifyService.OnMatchCompleted)
```
При переходе на микросервисы — заменяешь in-process bus на NATS/Kafka. Сигнатуры обработчиков не меняются.

---

## 5. CI/CD

### Окружения
```
local       — docker-compose up, всё локально, MSW во фронте
staging     — автодеплой из main, тестовые ключи
production  — ручной апрув в GitHub Environments
```

### CI pipeline (`.github/workflows/`)
- **PR / push:** lint (golangci-lint per module + eslint) → test (go test -race + vitest) → build (npm run build + go build)
- **Merge to main:** auto deploy to staging → smoke tests → ручной "Approve" в GitHub Environments → production
- **E2E:** Playwright suite на каждом PR (`npm run test:e2e`)

### Frontend build
```bash
cd frontend
npm ci
npm run build    # → dist/
npm run preview  # локальный prod-preview на :4173
```

### Backend build
```bash
go work sync
cd backend/cmd/monolith
go build -o ../../../bin/monolith
```

### Docker (prod)
- Один VPS, две Docker сети: `app-net` (api, postgres, redis, minio, clickhouse, nginx) + изолированная `judge-net` (Judge0)
- `restart: always`, healthchecks с `condition: service_healthy`
- Migrate-сервис с `restart: on-failure` — гонит миграции на старте
- MinIO console — только через SSH tunnel

### Nginx
- `/` → SPA (фронт)
- `/api/` → backend monolith :8080
- `/ws/` → backend WS (upgrade headers)
- `/storage/` → MinIO (presigned URLs)
- `/metrics` → Prometheus (auth-restricted)
- Judge0 — НЕ проксируется наружу

---

## 6. Правила кода

### Go (backend)
- **golangci-lint** обязателен. Конфиг в `backend/.golangci.yml`. Включены `errcheck`, `gosimple`, `govet`, `staticcheck`, `gofmt`, `goimports`, `misspell`, `exhaustive`, `forbidigo`, `noctx`, `wrapcheck`.
- **Enums** — никаких `string`/`int` для ограниченных значений. Все в `shared/enums/`, метод `IsValid()` у каждого:
  ```go
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
- **Ошибки** — всегда оборачивать: `return fmt.Errorf("arena.StartMatch: %w", err)`
- **Context** — первым параметром везде
- **БД** — только sqlc, никаких ORM, параметризованные запросы
- **Никаких `fmt.Println`** — только `slog`
- **`solution_hint` из `tasks`** — НИКОГДА не отдавать клиенту, только бэк читает для system prompt LLM
- **Тесты** — unit-тест с mockgen-моком для каждого use case

### TypeScript (frontend)
- ESLint + Prettier. `@typescript-eslint/no-explicit-any: error`. `no-console: warn`.
- Все pages — lazy imports в `App.tsx`. Не добавляй static import нового pages — ломает code-split.
- API запросы — только через TanStack Query hooks из `src/lib/queries/<domain>.ts`. Не дёргай `fetch` напрямую.
- Стили — только Tailwind utility classes + дизайн-токены из `tailwind.config.ts`. Никаких inline `style={{ color: '#abc' }}` для брендовых цветов (только для редких градиентов hero-блоков).
- i18n — топовые страницы через `useTranslation()`. Остальные — TODO.
- Новый компонент — сначала Button/Card/Avatar/Tabs reuse. Если нет подходящего — обсуди структуру перед написанием.

### Contract-First
Спека API — `docs/legacy/openapi-v1.yaml`. Источник правды.
- Фронт: `npm run gen:api` → `frontend/src/api/generated/schema.ts`
- Бэк: `oapi-codegen` → `backend/internal/generated/api.gen.go` (TODO setup)
- CI должен падать если spec изменился, а код не перегенерён.

---

## 7. AI-интеграция

### Провайдеры через OpenRouter
```go
type LLMProvider interface {
    Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error)
    Stream(ctx context.Context, req CompletionRequest) (<-chan Token, error)
}
```

### Модели
- **Free:** `openai/gpt-4o-mini`, `mistralai/mistral-7b`
- **Premium:** `openai/gpt-4o`, `anthropic/claude-sonnet-4`, `google/gemini-pro`

### Приоритет выбора
```
user preference (premium only) → task override → section override → company override → default
```

### Mock session
- LLM stateless. Бэкенд хранит историю в `mock_messages`, при каждом запросе шлёт полный контекст.
- System prompt: роль + задача + текущий код + elapsed time + стресс-метрика + правила (наводи при молчании > 2 мин, не давай решение, фиксируй ошибки).
- Управление контекстом: system + последние 10 сообщений всегда; старые — суммаризируются.

### Стресс-метрика
Клиент шлёт events каждые 500ms (`pause`, `backspace_burst`, `chaotic_edit`, `paste_attempt`). Бэкенд агрегирует, передаёт в system prompt.

### System Design AI on-demand
В UI System Design Interview — большая кнопка "Отправить скриншот AI" (не listening постоянно — экономит ~$0.40/сессия). Только по клику AI разбирает текущее состояние канваса.

### Стоимость сессии (45 мин mock)
- gpt-4o-mini: ~$0.08–0.12
- gpt-4o: ~$0.40–0.60

---

## 8. База данных (компактно)

Полный список таблиц — `backend/migrations/`. Ключевые:
- `users`, `oauth_accounts`, `profiles`
- `ratings (user_id, section, elo, matches_count)` — UNIQUE(user_id, section)
- `skill_nodes`, `seasons`, `season_progress`, `achievements`
- `companies`, `tasks`, `test_cases`, `task_templates`, `follow_up_questions`
- `arena_matches`, `arena_participants`, `mock_sessions`, `mock_messages`
- `editor_rooms`, `editor_participants`
- `guilds`, `guild_members`, `guild_wars`
- `slots`, `bookings`, `slot_reviews` (human mock)
- `boosty_accounts`, `subscriptions`, `ai_credits`
- `dynamic_config`, `notifications_log`, `anticheat_signals`, `podcasts`, `podcast_progress`, `onboarding_progress`, `llm_configs`

ClickHouse: `events`, `mock_analytics` (для аналитики).
Redis: `rating:{section}:{userID}` zsets, `{section}:queue` матчмейкинг, `session:{id}` WS, `cache:*` TTL 5 мин.

---

## 9. Авторизация

**Провайдеры:** Яндекс OAuth + Telegram Login Widget.

JWT: access 15 мин (в памяти клиента), refresh 30 дней (httpOnly cookie). Активные сессии в Redis для инвалидации без смены ключа.

**WS auth:** JWT в query param `?token=...`.

**Frontend:** токен в `localStorage.druz9_access_token`, инжектится в каждый fetch через `apiClient`. На 401 — clear + redirect to `/welcome`.

---

## 10. Монетизация

**Boosty** — донаты/подписка (юридически проще чем pay).

| Тир | Цена | Что даёт |
|---|---|---|
| Поддержка | ~0₽ | базовый доступ, free LLM |
| Искатель | ~299₽/мес | premium LLM (gpt-4o-mini+) |
| Вознёсшийся | ~799₽/мес | все фичи + gpt-4o / claude-sonnet |

**Принцип:** никакого pay-to-win. Premium = лучший AI и косметика, не преимущество в рейтинге.

**v2:** компании платят за размещение реальных задач + доступ к топу как к кандидатам. Entry fee в арене (внутренний баланс).

---

## 10.5. Хранение данных (retention policy + storage budget)

### 🎯 Бюджет VPS — 120 GB disk / 14 GB RAM (Hetzner CX21/CPX21)

**Всё (БД + Redis + MinIO + логи + трейсы + сам бинарник + ОС) живёт на одном диске 120 GB.** Каждый байт важен. План:

```
OS + system:                           ~15 GB
Docker images (api+nginx+judge0+pg):   ~10 GB
Judge0 sandbox + ephemeral submissions: ~5 GB
PostgreSQL (data + WAL):               ~40 GB   ← главный potлок
Redis (RDB snapshots на диск):          ~3 GB
MinIO (только аватары + критичное):    ~20 GB
Loki (14 дней retention):              ~10 GB
Локальные ClickHouse агрегаты (опц.):  ~10 GB
Логи приложения (json) до Promtail:     ~3 GB
Buffer + free space:                    ~5 GB
________________________________________________________
ИТОГО:                                ~120 GB ✓
```

**RAM 14GB бюджет:**
- PostgreSQL `shared_buffers` 4GB + `work_mem`/connections ~2GB = **6 GB**
- Redis maxmemory 2 GB (LRU eviction)
- API monolith (Go) ~500 MB при 1000 concurrent users
- Judge0 workers (2 шт × 256 MB) = 512 MB
- nginx + minio + ClickHouse-если-есть = ~1 GB
- OS + Docker overhead ~2 GB
- **Свободно:** ~2 GB на пиковые скачки ✓

### 🌥 Что ВЫНОСИМ НАРУЖУ — бесплатно до 10k MAU

| Сервис | Куда | Free tier | Зачем |
|---|---|---|---|
| **Replays** (keystrokes timeline) | Cloudflare R2 | 10 GB/мес + 0 egress | Может расти на 50-100 GB/мес — на VPS не влезет |
| **Podcasts** (MP3, тяжёлые) | Backblaze B2 / R2 | 10 GB бесплатно | Контент тяжёлый |
| **Voice recordings** (если включит юзер) | Cloudflare R2 | в общем лимите | Ephemeral, 7 дней TTL |
| **Sentry** (errors + session replay) | sentry.io | 5k events + 50 replays/мес free | Не на нашем диске |
| **Grafana Cloud** (logs/metrics/traces) | grafana.com | **50GB логов · 10k метрик · 50GB traces — навсегда free** | Убирает Loki/Jaeger/Prometheus с VPS |
| **Email транзакционный** | Resend | 3k/мес free | Не нужен SMTP-сервер |
| **Push-уведомления (Web Push)** | self-hosted, бесплатно | — | Уже умеем |
| **Telegram-бот** | Telegram Bot API | unlimited free | Уже в плане |
| **CDN для статики** | Cloudflare free | unlimited bandwidth | Снимает egress с VPS |
| **DNS + DDoS защита** | Cloudflare free | — | Бесплатно |
| **TLS** | Let's Encrypt + cert-manager | бесплатно | — |

**Что остаётся на VPS:** PostgreSQL + Redis + Judge0 sandbox + API monolith + nginx + MinIO (только аватары/иконки).

### ⚠️ Решение по аналитике

Нет смысла поднимать **Loki + Jaeger + Prometheus + ClickHouse + Grafana** на 120GB VPS — это съест 50GB+ только на работу.

**Вместо:**
- Логи: stdout JSON → Promtail (тонкий процесс, ~50MB) → **Grafana Cloud Loki** (50GB/мес free)
- Traces: OTel SDK в Go → OTLP → **Grafana Cloud Tempo** (50GB free)
- Metrics: `/metrics` → Grafana Agent → **Grafana Cloud Prometheus** (10k серий free)
- Alerts: Grafana Cloud Alerting → Telegram-бот (тоже бесплатно)
- ClickHouse аналитика: пока не поднимаем. Когда нужна — внешний managed (Aiven free trial / ClickHouse Cloud free tier 100h/mo).

Эффект: -50GB диска, -2GB RAM, не нужно self-host'ить observability stack.

**Принципы экономии:**
1. **Push to client where possible** — UI state, drafts, recent searches → `localStorage`/`IndexedDB`. Не дёргаем БД на каждый чих.
2. **Aggressive TTL на эфемерные данные** — закрытые лобби, отменённые матчи, abandoned mock — сразу.
3. **Соблюдаем закон 152-ФЗ** — минимум персональных данных, явное согласие, право на забвение.
4. **Агрегаты вместо сырых событий** — для аналитики ClickHouse + downsampling.

### 📦 Что и где живёт

| Тип данных | Где | Срок | Удаление |
|---|---|---|---|
| **Аккаунт** (email, username, password_hash, OAuth tokens) | PostgreSQL `users`, `oauth_accounts` | Бессрочно (пока юзер активен) | Soft-delete на 30 дней → hard-delete (право на забвение) |
| **Профиль** (avatar, bio, prefs, skill atlas) | PostgreSQL `profiles`, `skill_nodes` | Бессрочно | С аккаунтом |
| **Рейтинг** (ELO, history) | PostgreSQL `ratings` | Бессрочно | С аккаунтом (анонимизируется в leaderboard для honor topX) |
| **Матчи** (arena, mock) — метаданные | PostgreSQL `arena_matches`, `mock_sessions` | 12 месяцев | Cron-удаление, агрегаты живут в ClickHouse |
| **Mock messages** (диалог с AI) | PostgreSQL `mock_messages` | 90 дней | Cron-удаление, AI-отчёт остаётся |
| **AI-отчёты** (overall_score, recommendations JSON) | PostgreSQL `mock_sessions.ai_report` | Бессрочно | С аккаунтом |
| **Replay сессий** (keystroke timeline) | MinIO `druz9-replays` | 30 дней | Lifecycle rule (auto-purge S3) |
| **Keystroke logs** (raw events для стресс-метрики) | PostgreSQL `keystroke_events` | **7 дней** | Cron каждые 24ч |
| **Voice recordings** (если включит юзер) | MinIO `druz9-voice` | 7 дней | Lifecycle rule |
| **Подкасты, kata, контент** | MinIO `druz9-podcasts`, PostgreSQL `tasks` | Бессрочно | Контент-команда |
| **Аватары** | MinIO `druz9-uploads` | Бессрочно | С аккаунтом |
| **Уведомления log** | PostgreSQL `notifications_log` | 30 дней | Cron |
| **Antichea signals** | PostgreSQL `anticheat_signals` | 90 дней (или 1 год для бан-кейсов) | Hard-delete по cron |
| **Onboarding answers** | PostgreSQL `onboarding_progress` | До завершения онбординга + 30 дней | Cron |
| **Аналитические события** (DAU/clicks/etc) | ClickHouse `events`, `mock_analytics` | 25 месяцев (для YoY-сравнений) | TTL партиции |
| **Логи приложения** | Loki | 90 дней | Loki retention config |
| **Traces** | Jaeger | 7 дней (sampled 10% в проде) | Jaeger TTL |
| **Метрики Prometheus** | local TSDB | 15 дней (raw), 1 год (downsampled) | Prom retention |
| **Sentry events** | sentry.io | 90 дней (free plan) | Sentry policy |
| **Cookies** (refresh token) | Browser | 30 дней | httpOnly, sameSite=strict |
| **Session cache** | Redis | 5 мин — 24 часа (зависит от ключа) | TTL |

### 🚪 Закрытые / отменённые сущности — агрессивное удаление

| Сущность | Триггер | Срок |
|---|---|---|
| **Custom Lobby** (закрытая комната) | Owner закрыл / последний участник вышел | **1 час** → `DELETE FROM editor_rooms` |
| **Editor session** | Idle > 30 мин | **30 мин** → удаление + публикация `RoomExpired` |
| **Abandoned matchmaking** | Юзер не подтвердил матч за 10с | **немедленно** (только Redis) |
| **Cancelled mock session** | Юзер вышел до 5 мин | **немедленно** (всё убираем, не сохраняем) |
| **Cancelled mock session** | Юзер вышел после 5 мин | 7 дней (для возможной аналитики) → удаление |
| **Failed Judge0 submissions** | Без ответа > 30 сек | **немедленно** |
| **Expired invite links** | TTL истёк | **немедленно** (Redis TTL) |
| **Stale notifications** (read + 7 дней) | Прочитано | 7 дней → cron |
| **WS-сессии** | Disconnect | **немедленно** (Redis) |

### 💾 Что хранить НА КЛИЕНТЕ (экономим БД и RAM)

| Данные | Где | Зачем |
|---|---|---|
| **Theme / lang preferences** | `localStorage` | Уже сделано |
| **Recent searches** | `localStorage` (max 20) | Не нужно в БД |
| **Draft kata code** | `localStorage` (per kata, sync to DB только на submit) | Save every 5 sec локально, на бэк — только при Run/Submit |
| **Onboarding answers** | `localStorage` пока не закончил | На бэк только финальный snapshot |
| **Notification badges** (count) | `localStorage` (sync с бэком на focus) | Не дёргаем `/api/notifications/count` каждые 5 сек |
| **Replay viewer state** (zoom, frame) | `sessionStorage` | Per-tab |
| **Code Editor playground files** (если juiced) | `IndexedDB` | До 50MB на юзера, бесплатно для нас |
| **AI mock conversation context** (active session) | `localStorage` (last 20 turns) + бэк хранит только summary | Уменьшает `mock_messages` рост в 5-10× |
| **Filter/sort UI state** | `sessionStorage` | Per-tab UX |
| **Onboarding progress checkboxes** | `localStorage` | Не нужна таблица |
| **Voice recording (active session, не финальный)** | `IndexedDB` blob | Загружается на бэк только если юзер сохранит |
| **Кеши GET-запросов (read-only)** | TanStack Query + `IndexedDB` persister | Survives reload, не дёргает API |

**Эффект:** DB у активного юзера живёт только когда он реально что-то делает (submit, save, finish). Idle юзеры — 0 нагрузки.

### 📊 Прогноз размера PostgreSQL (10k MAU)

```
users + profiles + ratings + skill_nodes:    ~50 MB    (1KB × 10k × коэф)
arena_matches (12 мес × 100/день/user):      ~30 GB    (json metadata + scores)
mock_sessions + ai_report:                   ~12 GB    (JSONB compress)
mock_messages (90 дней):                     ~25 GB    ⚠️ КРИТИЧНО
keystroke_events (7 дней):                    ~8 GB    ⚠️ TTL обязателен
guilds + members + wars:                      ~2 GB
slots + bookings:                             ~1 GB
notifications_log (30 дней):                  ~3 GB
podcasts + podcast_progress:                 ~500 MB
anticheat_signals (90 дней):                ~500 MB
________________________________________________________
ИТОГО:                                       ~82 GB    из 120 GB бюджета
буфер на индексы + WAL + рост:               ~38 GB    ✓ ОК
```

**Risk hot zones:**
- **`mock_messages`** — больше всех растёт. Меры:
  - Хранить компрессом (`COMPRESS pglz` на JSONB-колонке)
  - После 30 дней — суммаризовать в `mock_summary` (1 запись = 100 сообщений)
  - Клиент держит активные turn'ы в `localStorage`, шлёт на бэк только snapshot после `END_SESSION`
- **`keystroke_events`** — НЕ хранить individual keystrokes. Хранить агрегаты по 5-минутным окнам (`{paused_count, backspace_burst_count, idle_seconds}`). Это в 50× меньше.
- **`arena_matches`** — после 12 мес уезжают в ClickHouse `historical_matches`, в PG остаётся только summary.

### 🧠 Redis budget (14 GB)

```
matchmaking queues (5 секций × 100 в очереди × 1KB):    ~500 KB
WS sessions (1000 active × 5KB):                          ~5 MB
rating sortedsets (5 секций × 10k × 100B):                ~5 MB
session cache (10k × 2KB TTL 5 мин):                    ~20 MB
dynconfig cache:                                          ~1 MB
notifications queue (Asynq, в среднем):                ~100 MB
locks + dedup keys (TTL):                                ~10 MB
________________________________________________________
Hot working set:                                       ~150 MB    из 14 GB
буфер на пиковую нагрузку (до 1M concurrent users):    ~14 GB    ✓ с большим запасом
```

**Что НЕ кладём в Redis:**
- Полные профили (только id → cache на 5 мин)
- Историю сообщений (только pointer)
- Большие JSON блобы

### 🗄 MinIO (S3) lifecycle rules

```
druz9-replays:    delete after 30 days
druz9-voice:      delete after 7 days
druz9-uploads:    keep (small)
druz9-podcasts:   keep
druz9-tmp:        delete after 24 hours (одноразовые презигнед урлы)
```

### Право на забвение (GDPR Art. 17 / 152-ФЗ)
- `DELETE /api/v1/account` — soft-delete аккаунт + начинает 30-дневный grace period (можно восстановить)
- После 30 дней — hard-delete: все таблицы с FK к user_id чистятся каскадно, объекты в MinIO удаляются по metadata-tag, записи в Replays уходят сразу (не ждут lifecycle), keystroke и voice — сразу.
- Анонимизация в leaderboard'ах: nick → "deleted_user_NNNN", аватар → дефолт, остальные данные стираются.

### Экспорт данных (GDPR Art. 20)
- `GET /api/v1/account/export` — асинхронная задача, генерирует ZIP со всеми пользовательскими данными в JSON, ссылка на скачивание (TTL 24ч в MinIO) приходит в Telegram + email.

---

## 11. Безопасность

- **Rate limit (Redis):** API 100/мин, AI-mock 10/мин, match 5/мин, login 10/мин IP
- **SQL injection:** исключён через sqlc
- **CORS:** только druz9.online в проде
- **DDoS:** Cloudflare free перед сервером
- **OAuth tokens:** AES-256 в БД
- **Judge0:** изолированная Docker сеть
- **WS:** проверка origin, автодисконнект на протухшем токене
- **Antichea:** paste detection, page-visibility, аномальная скорость → suspicion score → warn → loss → ban

---

## 12. Observability

См. `docs/observability.md`.

- **Frontend errors → Sentry** (drop-in, env-controlled). ✅
- **Backend traces:** OpenTelemetry → Jaeger. TODO.
- **Backend logs:** slog JSON → Loki → Grafana. TODO.
- **Metrics:** Prometheus → Grafana. Алерты в Telegram. TODO.

---

## 13. Roadmap (компактно)

**MVP (месяц 1–2):** Auth · Editor + Judge0 · AI mock 1 секция · Профиль + Atlas базовый · Sanctum · Деплой.
**v1.0 (3–4):** Арена 1v1 · ELO · Все 5 секций · Season Pass · Notifications · Onboarding · Human Mock.
**v1.5 (5–6):** Гильдии + War · Replay · Стресс · Voice · Codex · ClickHouse · Boosty.
**v2.0 (6+):** Hero Cards · Spectator · Code Obituary · Ghost Runs · Necromancy · War Room · Tournaments · Public profiles.

---

## 14. Инструкции для Claude / Cursor

Когда читаешь этот файл — у тебя должна сложиться картина:
1. Это **NOT another LeetCode**. Live PvP, гильдии, AI наставник, viral фичи. Visual = modern pro-tool, не RPG.
2. Backend = Go workspaces, модульный монолит, домены изолированы через event bus.
3. Frontend = React + Vite + Tailwind + TanStack Query + MSW в dev. 47 страниц, 5 компонентов.
4. **Не вводи RPG-эстетику** (Cinzel/золото/руны/SVG-character). Удалили это в v3.0. Всё современно: Inter/Geist/Tailwind tokens.
5. **Перед фичей читай** соответствующую страницу в Pencil (`design/v2/druz9.pen`) или существующий `frontend/src/pages/<Name>Page.tsx` как референс.
6. **Прежде чем писать новый use-case в Go** — сначала предложи структуру файлов и интерфейсы, дождись подтверждения, потом реализация + тест.
7. **Линтер mentaly:** все error обработаны, оборачиваются с контекстом, `exhaustive` switch по enums, context первым параметром, sqlc вместо ORM.
8. **Frontend: lazy import** новых страниц в App.tsx (не статик), Tailwind tokens (не raw hex), TanStack Query hooks (не fetch).
9. **Не комитьти:** `.env*.local`, `playwright-report/`, `test-results/`, `node_modules/`, `dist/`.
10. **Запуск:** `cd frontend && VITE_USE_MSW=true npm run dev` → http://localhost:5173. Для прод-превью: `npm run build && npm run preview` → :4173.

---

## 15. Полезные ссылки внутри репо

- Архив старого bible (RPG-вижн, реализационные планы) — `druz9-bible-archive.md`
- Дизайн (источник правды) — `design/v2/druz9.pen` (открывать в Pencil)
- Observability/tracing TODO — `docs/observability.md`
- Backend ↔ frontend контракт — `docs/legacy/openapi-v1.yaml`
- Frontend integration toggle — `frontend/INTEGRATION.md`
- Local dev guide — `LOCAL-DEV.md`
- Server / deploy — `SERVER-SETUP.md`, `DEPLOYMENT.md`
