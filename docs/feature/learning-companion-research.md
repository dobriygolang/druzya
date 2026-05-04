# Learning Companion — Research (2026-05-04)

> **Статус:** research-only. Никаких миграций, кода или инфра-изменений до явного go.
> **Автор контекста:** Sergey (Go senior → MLE/DE swap), session 2026-05-04.

## 0. Запрос и анти-цели

**Что нужно:**

1. План перехода Go → MLE / Data Engineer с развилкой (попробовать оба → решить).
2. AI-mock review для треков MLE и DE (вопросы, рубрика).
3. Кастомизация atlas/map пользователем.
4. Умный помощник с интерактивным UI в Hone + web. **НЕ ещё один roadmap.**
5. Offline-mode (Hone уже есть outbox; assistant должен работать оффлайн → подхватываться при онлайне).
6. Server upgrade analysis (сейчас выключен, переезд).
7. Design audit: цветовая палитра ОК, не хватает wow / плавности.
8. Полная local-dev инфра.
9. Workaround для TG auth на localhost.

**Что НЕ делаем:**

- Не строим ещё один статический roadmap «10 шагов от джуна до сеньора».
- Не делаем chat-first (плохая ассоциация с GPT, sergey explicitly).
- Не учим с нуля (мы — preparation, не Coursera).
- Не кэшируем Anthropic/OpenAI/Gemini (free-tier only).

---

## 1. Vision: что такое «smart assistant ≠ roadmap»

Roadmap — статичный список. Прошёл шаг → следующий. Никакой адаптации, никакого «почему сейчас именно это».

Smart assistant — **state-aware agent** с тремя свойствами:

| Свойство | Roadmap | Smart assistant |
|---|---|---|
| **Источник плана** | hardcoded шаги | derived from snapshot (skills, mocks, external activity, goals) |
| **Что показывает** | весь план | one-next-action + почему |
| **Реакция на провал** | блокирует прогресс | переоценивает план, может предложить boundary («не для тебя, попробуй DE») |
| **Чат** | нет | silent LLM сзади, structured UI спереди |
| **Память** | прогресс через checkbox | 4-layer (через `ai_tutor` + `intelligence`) |

### Three-mode state machine

```
       ┌──────────────┐
       │  EXPLORE     │  6 недель / 2 мини-проекта в druz9
       │  «дегустация»│  (1 DE + 1 MLE) → решение
       └──────┬───────┘
              │ commit
              ▼
       ┌──────────────┐
       │  COMMIT      │  3-6 месяцев / выбранный трек
       │  «building»  │  глубокий план через активные mocks/atlas-nodes
       └──────┬───────┘
              │ ready-for-interview
              ▼
       ┌──────────────┐
       │  DEEP        │  собес-prep mode
       │  «interview» │  daily mock-flow + spaced repetition
       └──────────────┘
```

Mode — отдельное поле в `user_settings` (или новой таблице `learning_state`). Меняет:

- Что показывает Hone Today (explore: «daily fork»; commit: «next milestone»; deep: «mock dispatch»).
- Что в priority у assistant suggestions.
- Какие nudges от intelligence приоритезируются.

### Где живёт

- **Hone primary surface** — daily check-in, focus blocks, quick actions. Новая страница `/coach` уже есть (read-only digest), её надо расширить до **interactive companion**.
- **Web secondary** — atlas-customization, deep planning, history view, fork visualization.
- **Cue (stealth)** — out of scope для этого ресёрча.

---

## 2. Что уже есть в коде (state of play)

> Все факты ниже сверены против текущего состояния репо (миграции, файлы, ports), не из памяти.

### 2.1 Atlas + tracks

- `atlas_nodes` table — 11 baseline + 12 ML (00033) + 8 DevOps (00036) узлов. Curated, kind-based (hub/keystone/notable/small).
- `atlas_edges` — prereq/suggested/crosslink.
- `tracks` + `track_steps` + `user_tracks` — 5 курируемых треков (algorithms-full-cycle, system-design, senior-backend-pack, mock-marathon-7, yandex-backend-prep).
- **ML-track:** `track_kind='ml'` enum value уже добавлен (00033). НО: курируемого ML-трека пока нет — только узлы.
- **DE-track:** ничего нет — нужны и enum value, и узлы, и трек.
- Frontend: `/atlas` (track ribbon), `/atlas/explore` (legacy graph), `/atlas/track/:slug` (detail).

### 2.2 User-editable atlas — **уже есть таблица!**

`user_atlas_nodes` (миграция 00044): user_id + node_key + title + description + section + kind + cluster + source_text + created_at.

- Есть UC в `services/profile/app/classify_atlas_todo.go` (LLM task `TaskAtlasClassify`) — пользователь даёт freeform TODO, LLM решает: matched existing node OR создаёт user_atlas_node.
- Merge в read-time: `profile.GetAtlas` возвращает curated + user-owned объединённо.
- **Чего нет:** UI для управления (drag, pin, hide). Нет «add custom track» — только узлы.

### 2.3 AI-mock question pools

`backend/services/ai_mock/domain/`:

- ✅ ml.go — 20 вопросов, 5-axis rubric (theoretical_depth / practical / system_design / data_intuition / production_awareness).
- ✅ devops.go, qa.go, sysanalyst.go, product_analyst.go, system_design_senior.go, tech_lead.go, english_hr.go.
- ❌ **Нет dedicated файла для Go-трека** — Go-собес идёт через default flow (mock_tasks + question_md из БД).
- ❌ **Нет DE-pool**.

Dispatch в `service.go:75-111` — `BuildSystemPrompt` бранчит на `IsMLEngSection() / IsDevOpsSection() / ...`. Чтобы добавить DE — нужен `IsDESection()` + `de.go` + branch.

### 2.4 AI-tutor + intelligence

- 4 курируемых персоны (algo-coach Алёша / sql-mentor Лена / sysdesign-guru Кирилл / english-coach Maria) + Go-coach (00036).
- 4-layer memory: episodic (`ai_tutor_episodes`) / working (`ai_tutor_threads.summary_md`) / facts (`ai_tutor_facts`) / skill (через `tutor.GetStudentSnapshot`).
- Auto-compaction каждые 10 сообщений.
- **Главная UX-проблема (sergey 2026-05-01):** AI-tutor существует как отдельная chat-страница `/tutor/ai/{slug}` — пользователю непонятно что это «coach с памятью», ассоциация с GPT.

### 2.5 External activity — **уже есть таблица!**

`external_activity` (миграция 00037): user_id + source enum (leetcode/coursera/hackerrank/youtube/book/article/course/other) + topic_atlas_node_id (FK, nullable) + topic_free_text + duration_min + notes + occurred_at.

- Есть domain layer.
- **Чего нет:** UI «+ занятие» в Hone Stats; intelligence пока не читает таблицу.

### 2.6 Hone offline outbox

`hone/src/renderer/src/offline/outbox.ts` (342 строки):

- IndexedDB store, FIFO ordered, idempotency-key headers.
- Auto-drain on `online` event + 5s polling.
- 5 attempts, 4xx → dead, 5xx → retry.
- Поддерживает: editor.create_room/delete_room/set_visibility, whiteboard.* (5 kinds).
- Нужно расширить: assistant suggestions, focus-block logs, external-activity entries.

### 2.7 Intelligence — это «мозг»

- 5 producers: urgent-event / long-absence / mock-topic / weak-skill / kata-streak.
- Severity grader: critical/warn/nudge/cruise.
- Two-stage reflective brief (sketch → critique).
- Goal-aware (`user_goals` table 00011).
- Anti-suggestion-fatigue (cooldown по rec_kind).
- Mock-pipeline awareness (RecentAbandonedCount).
- Pending follow-ups (closing-the-loop).
- **Чего нет:** intelligence пока не читает `external_activity`; не строит decision suggestions «попробуй DE-таску» (это новый rec_kind).

### 2.8 Frontend (web) design

- **Tailwind primary** + design tokens в `src/styles/main.css` (CSS vars `--color-bg/surface-1/text-primary/accent`).
- **framer-motion v11** установлен. `src/lib/motion.ts` — централизованные паттерны (staggerContainer, pageTransition, interactiveHover, pulseAnim) + `useMotionSafe()` (`prefers-reduced-motion`).
- **Используется недостаточно:** Button.tsx сознательно отключил hover-scale; Card имеет `whileHover={{y:-2}}`. AtlasPage ribbon рендерит карточки без stagger entry.
- **Loading states:** `animate-pulse` skeleton — но размеры skeleton ≠ финальные карточки → layout shift.
- **Иерархия цветов:** черный bg + белый ink + 1 акцент (#FF3B30 для danger). Это intentional minimalism, и это работает — wow надо добавлять не цветом, а motion + shared element transitions.

### 2.9 Hone design

- Single-file `globals.css` (~1100 строк), CSS custom properties + `.chip / .kbd / .surface / .lift`.
- **No framer-motion** — только CSS transitions + View Transitions API (Chrome native).
- Motion tokens: `--t-fast=150ms / --t-base=220ms / --t-slow=320ms`, ease `cubic-bezier(0.2,0.7,0.2,1)`.
- **Заметные gaps:** нет exit-анимации модалок; ни одного staggered list reveal; Cmd+K появляется без open-анимации.

### 2.10 Local dev / прод

- `make start` — postgres + redis + minio + clickhouse + judge0 + api.
- `make front` — Vite + MSW (frontend работает без backend).
- `cd hone && npm run dev` — Connect-RPC к localhost:8080.
- Ollama profile-gated (`docker compose --profile ollama up`).
- **Прод-эстимат:** ~12GB RAM / 8 cores / 50GB disk (postgres 2.2GB + redis 1.2GB + ollama 5.5GB + judge0 2GB + api/minio/nginx 1GB остальное).

---

## 3. Gaps под задачи Sergey

### 3.1 Atlas customization — backend готов, фронта нет

**Что есть:** `user_atlas_nodes` + LLM-classifier из freeform.
**Чего нет:**
- UI «+ свой узел» в `/atlas` или `/atlas/track/:slug`.
- UX управления: hide curated node, pin custom node, reorder.
- Concept «свой track» (custom track-steps) — таблицы нет.

**Тradeoff:** «полная свобода кастомизации» = дорогая UX (drag-and-drop graph editor, conflict resolution с curated). «Минимум» = форма «добавить тему / связать с trackom», LLM сам кладёт куда надо. Минимум закрывает 80% кейсов.

### 3.2 MLE/DE fork (explore mode)

Нужно добавить:

1. **DE atlas-nodes:** 12-15 узлов (de_root hub + de_etl_pipelines + de_warehouses + de_streaming + de_sql_optimization + de_spark + de_data_quality + de_orchestration + de_observability + de_modeling + de_governance + de_mlops_overlap), cluster='de', sort_order 900-920.
2. **DE track_kind enum** value — миграция аналогично 00033.
3. **Curated DE-track** seed — 8-10 шагов через `track_steps`.
4. **MLE curated track** — узлы есть, трека нет. Тоже seed-step-cы.
5. **Explore-mode marker** — поле `learning_state.mode='explore'` на уровне user_settings.
6. **Fork UI** — компонент «выбираешь между двумя ветками» с прогрессом по обоим.

**Tradeoff:** explore = два параллельных мини-плана. Хранить как 2 active enrolment'а в `user_tracks` (уже поддерживается, но обычно UX подразумевает один active). Решение: `is_explore_branch boolean` поле, и UI трактует пары explore-branch как «вилку», а не как «два независимых».

### 3.3 AI-mock review для DE и Go

- **DE:** новый файл `de.go` с 20-вопросным pool (разбивка: ETL design 4, distributed systems 4, SQL/warehousing 4, streaming 4, data quality + ops 4) + 5-axis rubric (etl_design / distributed / sql_modeling / streaming / production_ops). Branch в service.go.
- **Go-senior:** сейчас generic. Можно добавить `go_senior.go` с pool по runtime/concurrency/profiling/memory model — но это можно отложить, generic flow работает.

### 3.4 Smart assistant UI (Hone + Web)

**Hone /coach сейчас:** read-only feed карточек прошлых брифов. Нужно превратить в **interactive companion**.

Идеи паттернов (никакой реализации, только архитектурные):

1. **«Сегодня одно действие»** — большой карточкой по центру. Не «сделай 10 things». Один атомный совет от intelligence + кнопка «начать focus-block 25 мин» + кнопка «сделано» + кнопка «не подошло, дай другое» (триggers re-roll через LLM).
2. **«Where am I» visualization** — radar-chart по 5-axis из ML/DE rubric (или 3-axis для общего). Обновляется после каждого mock. Показывает trajectory, не моментный снимок.
3. **«Fork view» (только в explore-mode)** — две колонки MLE / DE, в каждой 3 карточки (что попробовал / что осталось / след шаг). Внизу честный анализ «куда тянет интерес» (LLM на основе времени, completion rate, voluntary deep-dives).
4. **«Stream»** — feed событий: «зачекинил 45 мин Coursera ML», «ai-mock МЛ показал weak data_intuition», «AI-tutor предложил статью», «interactive radar updated». Это и есть лента — но без чата, без свободного ввода.

**Web /atlas:** добавить overlay «assistant panel» справа — полупрозрачная sticky-полоса со «следующее предложение» + «show me why» (раскрывает обоснование на основе snapshot).

### 3.5 Offline + sync

Outbox уже есть и работает. Нужно:

- Расширить `OutboxOpKind` на новые типы: `assistant.dismiss_suggestion`, `learning.checkin`, `external_activity.add`, `goal.update`.
- Идемпотентность на бэке — frontend шлёт `idempotency-key`, backend пока игнорирует. **Это open TODO.** Без неё на recovery возможны дубли.
- Локальный read-кеш ассистент-сюжета (last 7 brief-карточек) — IndexedDB. Сейчас брифы кешируются в memory только.

### 3.6 Server upgrade

**Текущий estimate:** 12GB RAM / 8 cores для full prod stack с Ollama.

**Что меняется при assistant + smart-companion:**
- Дополнительные LLM-вызовы (dismiss feedback, fork analysis) → +20% к llmchain нагрузке. Free-tier держит, но self-hosted Ollama на 7B модели уйдёт в 100% CPU.
- IndexedDB-кеш на клиенте → бэк не нагружается дополнительно.
- Embedding'и для atlas-classify → уже есть через bge-small.

**Рекомендация:** 16GB RAM / 8 cores / 80GB SSD — даёт запас для роста и более агрессивного caching.

**Что не делаем:** GPU. Free-tier API + CPU Ollama закрывает 100% задач, GPU — overkill для текущей нагрузки.

### 3.7 Design wow

Не цветом — **motion + shared element transitions**. Конкретные апгрейды:

| Поверхность | Сейчас | Предложение |
|---|---|---|
| AtlasPage track ribbon | Карточки flush | Stagger entry (80ms gap, 240ms each, motion.ts уже умеет) |
| TrackDetailPage step-cards | Static reveal | Sequential reveal сверху-вниз при scroll |
| Cmd+K palette (Hone) | Появляется instant | Scale 0.96→1 + fade 180ms (CSS keyframe в globals.css) |
| Page navigation (Hone) | View Transitions хорошо | Расширить на cross-link «open task → focus block» |
| Loading skeleton | `animate-pulse` quad | Shimmer (gradient x position keyframe) — уже есть в tailwind.config.ts:68-74, не используется |
| Modal exits | Manual class toggle | Standard exit anim wrapper компонент |
| Today insights | Static text | Анимированное число «35 → 42» через `tween` (motion.ts staggerItem) |

«Wow» = три-четыре деталей где motion сообщает state change, а не просто декорация.

### 3.8 Local dev

Работает out of the box (см §6). Единственный реальный pain — TG auth на localhost.

---

## 4. Концепция smart-assistant (детальнее)

### 4.1 Data model — что нужно знать про user

Разбивка по существующим/новым таблицам:

| Что знаем | Источник |
|---|---|
| Active track + step + progress | `user_tracks` (есть) |
| Skill state per atlas-node | `tutor.GetStudentSnapshot` (есть) |
| Mock-результаты + 5-axis | `mock_sessions.ai_report` (есть) |
| External learning | `external_activity` (есть) |
| Goals + deadlines | `user_goals` (есть) |
| AI-tutor facts | `ai_tutor_facts` (есть) |
| **Mode (explore/commit/deep)** | новое поле в `user_settings` или новая таблица |
| **Dismissed suggestions cooldown** | уже есть episodic-style в `coach_episodes` |
| **Fork preference signals** | derived из external_activity + mock-результатов time-spent |

**Новой таблицы почти не нужно** — большинство сигналов уже собирается, intelligence их сводит. Единственное реально новое — `learning_state` (1 row per user) с полями: mode, fork_branch (de/mle/none), explore_started_at, committed_to (track_id), commit_at.

### 4.2 LLM-задачи для assistant

Все через `llmchain` (Groq → Cerebras → Mistral cascade, free only):

- `TaskAssistantNextAction` — generate one daily action из snapshot. Output JSON `{action_md, kind, why_md, time_estimate_min}`.
- `TaskAssistantForkAnalysis` — раз в неделю analyze fork progress. Output `{lean: 'mle'|'de'|'unclear', evidence_md, suggested_next_step}`.
- `TaskAssistantRereroll` — после dismiss «не подошло», generate alternative.
- `TaskAtlasClassify` — уже существует.

Все **silent**. UI показывает результат в structured form, не chat-history.

### 4.3 Surfaces summary

| Surface | Что показывает | Mode-зависимо |
|---|---|---|
| **Hone /today (top)** | one-action card | yes |
| **Hone /coach (новое)** | brief cards stream + radar + fork-view | yes |
| **Hone /stats** | history + external_activity timeline | partial |
| **Web /atlas** | tracks + assistant overlay panel | yes |
| **Web /atlas/track/:slug** | step detail + «why this step now» | yes |
| **Web /goals** | существует — расширить linkage с assistant | shared |

### 4.4 Where chat lives (минимально)

Sergey: «не хочу чат». Согласен. Но zero-chat невозможно, иначе не разрулить free-text input. Решение:

- **Inline contextual chat-pill** на конкретных surface'ах — `/atlas/{node}`, mock result, hone reading: pill «Спросить AI-coach'а». Открывает mini-chat с pre-loaded context.
- **Не в primary surface** — на /coach НЕТ чата, только structured cards.
- **External activity** — structured form (source / topic / minutes), не «расскажи AI'у».

То есть chat = «escape hatch для специфичного вопроса», не основной UX.

---

## 5. Implementation plan (stages, order TBD)

> **Никакого кода** до явного go от Sergey. Здесь — только декомпозиция work.

### Stage A — foundation (sizing: ~1 неделя)

- Migration: `learning_state` table (mode, fork_branch).
- Domain + repo skeleton.
- Migration: DE track_kind enum + 12 DE atlas-nodes seed.
- Migration: curated DE-track + curated MLE-track (seed track_steps).

### Stage B — explore mode UI (sizing: ~1 неделя)

- Web: `/atlas` shows fork-card if `mode='explore'`.
- Hone: `/today` shows fork-action card if explore.
- Backend: `learning_state.fork_branch` toggle UC.

### Stage C — DE mock pool (sizing: ~3 дня)

- `services/ai_mock/domain/de.go` — 20 questions + 5-axis rubric.
- Section enum + dispatcher branch.
- Test coverage parity с ml.go.

### Stage D — atlas customization UI (sizing: ~3-5 дней)

- Web: «+ свой узел» modal с classify integration.
- Web: pin/hide actions on AtlasPage ribbon for user_atlas_nodes.
- Hone: read-only consumption (already supported via merged GetAtlas).

### Stage E — assistant Hone /coach upgrade (sizing: ~1.5 недели)

- Page redesign: one-action card + brief stream + radar.
- LLM tasks: TaskAssistantNextAction.
- Outbox extension: dismiss/reroll/checkin ops.
- Fork-view component (explore-only).

### Stage F — design polish (sizing: ~3 дня)

- Stagger entry на /atlas, /atlas/track/:slug, /coach.
- Cmd+K open animation в Hone.
- Skeleton dimensions match final cards.
- Shimmer migration.

### Stage G — intelligence integration (sizing: ~3 дня)

- Intelligence reads `external_activity` для daily-brief.
- Intelligence emits fork-analysis insight (раз в неделю).
- Cooldown integration для assistant rec_kind'ов.

**Total estimate:** ~5-6 недель календарных, можно бить на 2 параллельных стрима (frontend + backend).

---

## 6. Manual actions / env

Что нужно от Sergey руками — отдельный блок, не code:

### 6.1 Local dev startup

```bash
# Backend stack
make start

# Frontend (with MSW, no backend needed for UI work)
make front

# Hone
cd hone && export VITE_DRUZ9_API_BASE=http://localhost:8080 && npm run dev

# Optional: Ollama sidecar (только если работаем с tasks где нужны embeddings локально)
docker compose --profile ollama up
```

### 6.2 TG auth localhost workaround — два пути

**Путь 1 (без бэка, для UI-работы):**
`make front` уже включает MSW (`VITE_USE_MSW=true`). Кнопка Telegram-login возвращает mock JWT. Для design-работы достаточно.

**Путь 2 (с бэком, реальные данные):**

```bash
# в .env backend
DEV_AUTH=true

# в frontend/.env.development.local (создать если нет)
VITE_DEV_AUTH=true
```

Появится кнопка «DEV login» → вводишь username (alice/sergey/etc.) → mintит реальный JWT-pair, без Telegram-bot-secret.

Прод этот flow не имеет — `DEV_AUTH=true` гейтится `APP_ENV=development` проверкой.

### 6.3 Server upgrade рекомендация

| Ресурс | Текущий минимум | Рекомендуемый при assistant |
|---|---|---|
| RAM | 12 GB | **16 GB** |
| CPU | 8 cores | 8 cores |
| Disk | 50 GB SSD | **80 GB SSD** (postgres растёт + Ollama models cache) |
| Network | публичный IPv4 + домен с TLS | то же |
| Cgroup | v1 (Judge0 требует) | то же |

**Что обязательно при переезде:**
- Ubuntu 22.04 LTS (cgroup v1 совместимость).
- TLS через certbot (auto-renew).
- Postgres backup на S3-совместимое хранилище (minio в `infra/scripts/backup.sh`).
- Telegram bot domain — обновить webhook на новый домен.

### 6.4 Production env vars (must-have)

```
APP_ENV=production
POSTGRES_DSN=...
REDIS_ADDR=...
JWT_SECRET=<random 32 bytes>
ENCRYPTION_KEY=<random 32 bytes>
OPENROUTER_API_KEY=...
GROQ_API_KEY=...
CEREBRAS_API_KEY=...
MISTRAL_API_KEY=...
TELEGRAM_BOT_TOKEN=...
OLLAMA_HOST=http://ollama:11434  # only if Ollama profile активен
LLM_CHAIN_ORDER=groq,cerebras,mistral,openrouter,ollama
```

---

## 7. Open questions (решить до Stage A)

1. **`learning_state.mode` хранить как enum или free string?** Enum безопаснее (compile-time валидация в Go), free string гибче (легче добавлять mode в будущем). Рекомендация: enum.

2. **Custom atlas nodes — visible to other users?** Сейчас private. Если делаем «share my atlas» — это новая поверхность. **Рекомендация:** private only в MVP.

3. **Когда `explore → commit`?** Auto (≥4 explore-actions в одной ветке за 4 недели → suggest commit) vs manual (user explicitly clicks). **Рекомендация:** manual, с auto-suggest от intelligence.

4. **Fork-analysis — LLM вызывается с какой частотой?** Cron weekly (cheap) vs on-demand (expensive but accurate at moment of asking). **Рекомендация:** cron weekly + on-demand override.

5. **DE-pool вопросы — Sergey формулирует сам или curated?** Если curated — нужен список 20 сценариев под РФ-рынок (Yandex DE / Sberbank DE / Avito DE). **Рекомендация:** Sergey даёт 5-10 формулировок, остальное генерится LLM с фиксированным промптом.

6. **Hone /coach — мобильная версия?** Hone desktop only. Если планируется мобайл — это другая поверхность. **Рекомендация:** desktop only в MVP, web /coach view как мобильный fallback.

7. **Offline assistant — что делать если LLM call в outbox умер 5 раз?** dead-state op visible пользователю или silently dropped? **Рекомендация:** показывать в UI «1 предложение не доехало» + retry button.

---

## 8. Что точно НЕ делаем сейчас

- Не строим кастомный track-builder (drag-and-drop curriculum). YAGNI.
- Не вводим mobile app. Web + Hone хватает.
- Не интегрируем с GitHub commits для активности. external_activity pure user-driven.
- Не делаем social «share my progress». Приватный кокпит.
- Не перерабатываем design system целиком. Адсюлим motion, не цвет.
- Не добавляем GPU/тяжёлые модели. Free-tier держит.
- Не делаем chat-first интерфейс (sergey explicit).

---

## 9. Связанные документы

- `docs/feature/identity.md` — главный identity-документ
- `docs/feature/ai-tutor.md` — 4-layer memory architecture
- `docs/feature/next-tasks.md` — текущая очередь (для контекста)
- `CLAUDE.md` — orientation для AI-агентов
- `docs/tech/conventions.md` — free-tier LLM правила
- `docs/tech/architecture.md` — общая архитектура

---

## TL;DR для Sergey

1. **Большая часть инфры под smart-assistant уже есть** (user_atlas_nodes, external_activity, ai_tutor 4-layer, intelligence severity, Hone outbox, ML mock pool). Не строим с нуля — расширяем.
2. **Реально новое:** `learning_state` table + DE atlas/track/mock-pool + interactive Hone /coach.
3. **«Не roadmap» = state-aware single-action UI + silent LLM сзади.** Чат — escape hatch на конкретных страницах, не primary.
4. **Server upgrade:** 16GB / 8 cores / 80GB достаточно. GPU не нужен.
5. **TG auth localhost:** `DEV_AUTH=true` + `VITE_DEV_AUTH=true` → кнопка DEV-login.
6. **Design wow:** не цветом, motion. framer-motion + motion.ts уже есть, underused.
7. **Stages A-G** (~5-6 недель), но не начинаем без явного go и ответов на open questions §7.

**Следующий шаг:** Sergey проходит §7 open questions, выбирает порядок stages — потом стартуем имплементацию.
