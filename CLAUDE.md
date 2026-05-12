# CLAUDE.md — orientation для AI-агентов

Это монорепо проекта **druz9** — экосистема из трёх продуктов: web `druz9.online` (AI-coach + AI-mock + atlas + tutor toolkit), desktop focus-cockpit Hone, stealth tray-copilot Cue.

**Identity (Sergey 2026-05-04):** AI-coach с памятью + free tutor-toolkit + Hone для подготовки senior IT-разрабов. **3 трека:** Go senior · ML engineering · English (opt-in toggle). НЕ LeetCode / НЕ Skyeng / НЕ paid marketplace. См [docs/feature/identity.md](./docs/feature/identity.md).

## С чего начинать

1. **Прочитай [docs/tech/README.md](./docs/tech/README.md)** — там быстрый orientation, где что лежит и какие команды.
2. **Если задача затрагивает несколько слоёв** — открой [docs/tech/architecture.md](./docs/tech/architecture.md).
3. **Если задача про конкретный слой** — читай соответствующий файл в `docs/tech/` ([backend.md](./docs/tech/backend.md), [frontend.md](./docs/tech/frontend.md), [deployment.md](./docs/tech/deployment.md), [conventions.md](./docs/tech/conventions.md)).
4. **Для типовых workflow** (новый RPC, миграция, LLM-задача, code review, релиз Electron) — есть готовые скиллы в [.ai/skills/](./.ai/skills/).

## Что нельзя пропустить

- **Свободный LLM only.** Cascade order (Sergey 2026-05-05): `groq → cerebras → google → cloudflare → zai → mistral → openrouter → deepseek → ollama`. Free-tier приоритетны. Anthropic / OpenAI напрямую для production-чейна — **запрещены**. См [memory/feedback_providers.md](./memory/feedback_providers.md).
- **B/W only design.** `#FF3B30` — точка-индикатор / 1.5px stripe / single SVG stroke. Никогда в bg/fill/gradient.
- **Offline-first Hone.** Любая новая client-initiated write → outbox-able. См memory/feedback_offline_rule.md.
- **Responsive everywhere.** Все surfaces flex на любое разрешение — `flex-wrap`, `minWidth: 0`, auto-fit grid. См memory/feedback_responsive_rule.md.
- **Curation = ranking-proxy.** Не клонируем Strang/mlcourse/DDIA — линкуем через `external_resources` jsonb. Build только unique слой (AI-mock + Codex + AI-tutor + Hone + Intelligence). См memory/project_curation_model.md.
- **Контракт через .proto.** `proto/druz9/v1/` — единственный источник правды API. После любых изменений запускай `make generate` и коммить generated файлы.
- **Работаем в `main`, без worktrees.** Это явное указание Sergey.
- **Отвечай на русском, кратко.** Tradeoff'ы > вода. Что делать руками (deploy/env) — в отдельный блок.

## Как устроены три продукта

| Продукт | Каталог | Что |
|---|---|---|
| **Web (druz9.online)** | `frontend/` | AI-coach + AI-mock (5-axis radar) + AI-tutor (4-layer memory) + Skill Atlas + Codex + tutor toolkit |
| **Hone** | `hone/` | Тихий desktop-кокпит: AI-план, фокус, заметки с AI-link, taskboard с auto-categorise, English hub. **Не делает stealth** |
| **Cue** | `cue/` | Stealth tray-copilot. Невидим при screen-share, live-транскрипт встреч |

Backend — общий Go-монолит в `backend/cmd/monolith/`, ~25 сервисов в `backend/services/`. Контракт API в `proto/druz9/v1/`. Подробнее — [docs/tech/architecture.md](./docs/tech/architecture.md).

**Local dev login:** Hone Vite (`localhost:5173`) → LoginScreen → username «sergey» → DEV LOGIN button (visible только при `import.meta.env.DEV` + backend `DEV_AUTH=true`). Bypass'ит TG flow.

## Часто нужные команды

```bash
# Backend
make start         # docker стек: postgres + redis + minio + clickhouse + judge0 + api
make stop
make logs

# Frontend
make front         # Vite dev (http://localhost:5173, MSW моки включены)

# Hone / Cue
cd hone && npm run dev
cd cue && npm run dev

# Codegen — после любого изменения .proto или .sql
make generate
make gen-check     # CI-style drift check

# Тесты + линтер
make lint
make test
make migrate-up
make seed
make check-stubs   # grep всех // STUB:
```

## Где жить

```
druzya/
├── proto/druz9/v1/          Контракт API (источник правды)
├── backend/                 Go monolith
│   ├── cmd/monolith/        Точка входа + bootstrap + wiring
│   ├── services/            ~25 доменных сервисов
│   ├── shared/              Общие пакеты + generated/pb/
│   └── migrations/          Goose SQL
├── frontend/                Web (Vite + React)
├── hone/                    Hone Electron app
├── cue/                     Cue Electron app
├── infra/                   docker-compose.prod, nginx, monitoring, deploy.sh
├── docs/
│   ├── for_investment/      Инвестор-ориентированное (ecosystem, per-app)
│   └── tech/                Технические доки (читать при работе с кодом)
└── .ai/skills/              Project-specific workflows
```

## Ключевые принципы кода

Полный список — [docs/tech/conventions.md](./docs/tech/conventions.md). Самое важное:

- **Чистая архитектура внутри сервисов:** `ports → app → domain ← infra`.
- **Сервисы не импортируют друг друга** — общаются через `shared/domain/events.go` + EventBus.
- **`@ts-nocheck` запрещён.** Strict TypeScript везде. `any` — только с обоснованием.
- **Conventional Commits** на английском, императив, без «Generated with X» тегов.
- **Чужие credentials никогда в логах / коммитах.** `.env*` — в `.gitignore`.
- **Никаких feature flags / backwards-compat shims «на будущее».** YAGNI.
- **Тестируем где имеет смысл** (use cases, чистые функции). Thin pass-through код не тестим.

## Skills для типовых задач

| Задача | Skill |
|---|---|
| Добавить Connect-RPC endpoint | [.ai/skills/add-rpc.md](./.ai/skills/add-rpc.md) |
| Добавить миграцию | [.ai/skills/add-migration.md](./.ai/skills/add-migration.md) |
| Подключить новую LLM-задачу | [.ai/skills/llmchain-task.md](./.ai/skills/llmchain-task.md) |
| Добавить страницу в web/Hone | [.ai/skills/frontend-page.md](./.ai/skills/frontend-page.md) |
| Code review | [.ai/skills/code-review.md](./.ai/skills/code-review.md) |
| Релиз Electron-приложения | [.ai/skills/electron-app.md](./.ai/skills/electron-app.md) |

## Если что-то стало неактуальным

Документация в этом репо — живая. Если читаешь файл и видишь что код описывает другое (например, упомянут несуществующий сервис) — **доверяй коду, обновляй документ**.

В частности, удалены за 2026-04 / 05:
- **Arena/Lobby/Slot/Rating/Review/Events** — pivot на single-track AI-coach
- **services/friends/season/cohort/achievements/ai_native** — социальный слой через TG channel + circles
- **Sanctum / CodeObituary / Necromancy / GhostRuns** web-страницы — RPG-витрина свёрнута
- **Boosty marketplace** — заменён на free tutor toolkit (двусторонний рынок без денежного шага)
- **Quiz / Daily** — заменены Coach next-action + reflection grade
- **Vacancies** (2026-05-11, D1 cleanup) — off-identity: druz9 is AI-guide, not job board. `services/vacancies/` + frontend pages + protos + migration 00082 — gone

Если встречается ссылка на эти модули — она устаревшая.

## Текущие миграции (2026-05-12)

- **DB v65** — Phase 3.5: `user_resource_overrides` + `resource_promotion_signals` + `domain_reputation` + ALTER `user_resource_log` (4 cols)
- **DB v66** — Phase 9a: ALTER `editor_rooms` / `whiteboard_rooms` (archived_at + free_tier) + `user_room_quota`
- **DB v67** — Phase 10 fix: расширил `hone_focus_mode_valid` CHECK с `free|plan|pinned` до `pomodoro|stopwatch|free|plan|pinned|countdown`
- **DB v79** — db_cleanup_orphans (drop coach_episodes.embedding + onboarding_version + 21 dynamic_config orphan rows)
- **DB v80** — drop personal_events (calendar bounded context removed)
- **DB v81** — drop xp_events (gamification cleanup)
- **DB v82** — drop_vacancies (D1 cleanup 2026-05-11)
- **DB v83** — F6 resource_promotion_deprecate (ALTER `resource_promotion_signals` + deprecated_at + deprecated_reason + partial index)
- **DB v85** — D8 drop RPG leftovers (drop `friendships` + `friend_codes` + remap `'arena'` → `'mock'` в track_step_kind enum)
- **DB v86** — F2 user_primary_goals (single-active goal per user, 5 GoalKind enum)
- **DB v87** — F10 cue_sessions (interview-session ingestion target, jsonb stages)
- **DB v88** — drop llm_models.use_for_arena column (post-D8 Go/proto cleanup)
- **DB v89** — Stream C subscription_tiers (BYOK encrypted keys)
- **DB v90** — Stream E google_calendar (credentials + events_synced + indexes)
- **DB v91** — Stream F drop_peer_collab (editor_rooms.code col removed; presence/WS RAM-only)
- **DB v92** — R7 stage_templates (+ 5 builtin seeds: standard/yandex/ozon/pm/blank)
- **DB v93** — Stream D tutor_mode_paths + users.tutor_mode_enabled
- **DB v94** — F2 user_milestones + coach_episodes.deleted_at (memory soft-delete)
- **DB v95** — Stripe stripe_subscriptions + stripe_customers
- **DB v96** — Admin Phase 2 goal_presets (+ 8 builtin seeds)
- **DB v97** — coach_prompts (admin-editable inline prompts: intelligence / admin / mock)
- **DB v98** — notification_templates (admin compose для inactive-user etc)
- **DB v99** — ab_experiments (Phase 3 starter: experiment + per-user variant)
- **DB v100** — stripe_webhook_dedup (3-day Stripe retry idempotency)
- **DB v101** — coach_episodes.edited_at (user может уточнить formulation entry)
- **DB v102** — telemetry_events (90-day retention enforced via prune job)
- **DB v103** — focus_reflections (Hone Pomodoro grade 1-5 + notes structured)
- **DB v104** — user_app_installs (install-tracking + cross-app suggestion + first-week trial Pro)
- **DB v105** — speaking (Hone English Speaking modality: attempts + grades)
- **DB v106** — task_manual_kind_override (TaskBoard auto-categorise user override)
- **DB v107** — telemetry_consent (consent state table, не profile col — auditable)
- **DB v108** — interview_prep_sessions (Cue interview-prep wizard CV+JD upload)
- **DB v109** — user_atlas_struggle_marks (atlas node struggle handoff signal)

## Текущий roadmap (2026-05-12)

Старый phased plan (Phase 0-12.5 на основе 13 mockups) **закрыт**. Все wave-фазы либо ship'нуты, либо deferred/replaced. См [docs/feature/implementation-plan.md](./docs/feature/implementation-plan.md) для исторического статуса + текущего pointer'а.

Comprehensive roadmap утверждённый 2026-05-11 — identity-driven rebuild на 9 фаз (A → I) + J (polish). **Phases A-H полностью shipped 2026-05-12** в single-day marathon через 17 параллельных агентов (DB v95→v96). **Phase J shipped 2026-05-12 post-marathon**: light theme kill switch finalised (B/W only), Cue onboarding wizard, Cue interview-prep wizard (mig 00108), C4 diarization, stealth-verifier probe, Cue masquerade builds CI'd (workflows `cue-masquerade-release.yml` + `cue-masquerade-validate.yml`), H6 README refresh. Phase I (Admin Phase 3 + final launch readiness) — текущая. Roadmap живёт в `~/.claude/plans/system-design-ux-copy-user-research-compiled-beacon.md` (private).

**Implementation snapshot:** F1-F10 + R1-R10 + D1-D9 + Streams A-G + Phase J shipped. Что осталось:
- Admin Phase 3 (~6 weeks): A/B framework / Audit log / Fine-grained roles
- Polish post-launch: Firefox extension port, Stripe trial/refunds/multi-currency, Hone Dock 6 focus modes, voice audio upload