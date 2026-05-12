# Implementation plan — текущий статус

> **2026-05-12 update:** comprehensive 24-26-week roadmap утверждённый 2026-05-11 — **Phases A-H полностью shipped в single-day marathon session** (17 parallel agents). Phase I (docs + final polish + admin Phase 3) — remaining ~2-3 weeks.

## Marathon session 2026-05-12 — shipped

**17 agents executed in parallel rounds:**

| Round | Agent | Scope | Status |
|---|---|---|---|
| 1 | F6 daemon | curation auto-promote + cron | ✅ |
| 1 | F2 + F10 backend | Goal CRUD + InterviewSession ingestion + migrations 86/87 | ✅ |
| 1 | D8 cleanup | RPG/review/arena drop + migration 85 + use_for_arena drop | ✅ |
| 2 | Stream E | Google Calendar service + OAuth + 5-min cron + migration 90 | ✅ |
| 2 | Stream F | W/E migration (Hone delete + web solo + backend WS strip + migration 91) | ✅ |
| 2 | D9 | Admin observability 5 panels → 1 ObservabilityDashboard | ✅ |
| 3 | Stream D | Tutor mode polish + role toggle + reading paths + migration 93 | ✅ |
| 3 | R7 Phase 1 | Company Manager DnD + Stage Templates + ValidatePipeline + migration 92 | ✅ |
| 3 | R2 Coding+SysDesign+Behavioral+Radar | + voice MediaRecorder + Excalidraw integration | ✅ |
| 3 | Intelligence Phase 2 | LLM milestones + NodeCoverage + Memory list/delete + migration 94 | ✅ |
| 3 | Polish sweep | 9 Hone+Cue items: archive drag-ghost, vault 🔒, OfflineBanner 5-state, ConflictModal, area-overlay toast, quota stripe, etc | ✅ |
| 4 | Stripe MVP | checkout + webhook + cancel + migration 95 | ✅ |
| 4 | D7 voice-mock | delete legacy + BehavioralStage voice MediaRecorder/SpeechRecognition | ✅ |
| 4 | F2 Hone mirror | api/store/Coach chip/Today section/GoalEditModal | ✅ |
| 5 | CI1 sweep | 9 surfaces wrapped в ErrorBoundary + DataLoader | ✅ |
| 5 | ConflictModal 409 wire | updateWhiteboard / pushOperations / outbox executors | ✅ |
| 5 | Per-product polish | AITutor markdown + FormField hint + Input/Textarea/Select + Hone inline-edit + Palette Recent + Cue lang picker | ✅ |
| 5 | Admin Phase 2 starter | Goal presets CRUD + GoalWizard quick-start + migration 96 | ✅ |

**Plus main thread:** D5 finalize (Hone Podcasts delete), CI2 onboarding flag, Cue F10 ingest wire, MemoryPage frontend, milestones cache invalidation on goal mutation, HumanTutorsCard defensive fix, docs polish.

## Original roadmap reference

| Phase | Status |
|---|---|
| **A — Cleanup + foundation** | ✅ shipped (D1/D2/D3/D5/D7/D8/D9/D10 + CI1 + CI2 + CI4 partial + R8 redirect) |
| **B — Identity foundation** | ✅ F1 + F9 |
| **C — Goal + predictions + Cue ingestion** | ✅ F2 + F3 + F10 + F7 |
| **D — Activity loop + browser extension** | ✅ F5 UI + Chrome MV3 ext MVP + F6 daemon + F4 14 rules |
| **E — Mock pipeline + admin** | ✅ R2 all 5 stages + radar + R7 Admin Phase 1 (Company Manager DnD + Templates + Validate) |
| **F — Atlas progress + Cue stealth + W/E migration** | ✅ R3 (frontend trajectory + atlas coverage + Agent I backend per-node) + CI3 partial (tray swap + persona fallback; process masquerade builds deferred) + Stream F W/E migration |
| **G — Google Calendar + Podcast + Admin Phase 2** | ✅ Stream E + Stream G + Admin Phase 2 starter (Goal presets) |
| **H — Subscription + Tutor mode** | ✅ Stream C subscription + Stream D tutor mode + Stripe Agent K |
| **I — Docs + Launch prep** | 🚧 этот файл + final smoke tests; Admin Phase 3 (A/B + audit + roles) deferred post-launch |

## Что уже сделано (pre-2026-05-11)

| Фаза | Что осталось в проде |
|---|---|
| Phase 0-1 — Backend foundation | DB v52 (миграции 00047-52): learning_state, curation, ai_mock DE pool, seed_resources CLI |
| Phase 1.7 — AI readiness | DB v60: 10 LLM tasks, role-only personas (00057-58), readers / producers, throttle + observability |
| Phase 2 — Coach (learning-companion) | DB v63: SetLearningMode + GetForkSnapshot + GetNextAction + GetResourceTrail + GetSkillRadar + GetCoachStats + LogResource RPCs; Hone Coach.tsx (mode switcher / hero CTAs / KPIs / radar / fork / activity feed) |
| Phase 3 — Atlas customization | DB v64: AtlasNode.is_user_owned + SetAtlasNodePref RPC + pin/hide |
| Phase 3.5 — Personal resource library | DB v65: user_resource_overrides + resource_promotion_signals + domain_reputation + reflection-quality scoring |
| Phase 4 — Stats apply | Hone Stats.tsx (range / KPIs / 7-day heatmap / external activity feed) |
| Phase 5 — Notes + AI-link | SuggestNoteLinks + reflection note auto-create + embed |
| Phase 7a — Developer tools section | DeveloperToolsSection в Settings (room CTAs / lists / share / restore / free-tier counter) |
| Phase 9a — Standalone rooms backend | DB v66: archived_at + free_tier + user_room_quota; services/rooms + RoomService Connect-RPC + TTL daemon |
| Phase 10 — TaskBoard auto-categorise | CategoriseTask UC fire-and-forget + AICursor SSE event |
| Phase 11a — Palette cleanup | Flat 7-item palette (после vacancies delete 2026-05-11: 6 items) |
| Phase 12.5 — Admin extensions | DB v60 observability + v63 audit_log + REST endpoints (rooms / observability / eval-runs) |
| **D1 Vacancies delete** | 2026-05-11: backend service + frontend pages + DB migration 00082 + protos / locales / metrics cleanup |

## Deferred / replaced by new roadmap

- Phase 6 (Onboarding v2) → **replaced** F9 Diagnostic quiz (Phase B W5)
- Phase 8 (Tutor pages) → **rework** в Phase H (Stream D tutor mode polish, role toggle approach)
- Phase 9 web Editor cursor labels → **replaced** Stream F (W/E migration to web solo, no peer-collab WS)
- Phase 11b (offline UI states) → **subsumed** in CI1 Error/retry/skeleton pattern (Phase A W2)
- Phase 12 (Welcome ship) → **replaced** F9 Diagnostic quiz

## Curation principle (immutable)

druz9 **не создаёт content.** Мы — ranking-proxy + interview cockpit + AI coach. Конкурировать со Strang / mlcourse.ai / DDIA на качестве материала бессмысленно.

`atlas_nodes.external_resources` + `track_steps.external_resources` jsonb (mig 00051) — линки на чужое. `user_resource_overrides` (00065) — per-user mutations (added / hidden / replaced / reordered / unhelpful). Auto-promote daemon (Phase D F6) обновляет `resource_promotion_signals.avg_quality` из reflection grades.

## Migrations cheat-sheet (свежие)

- 00065 — user_resource_overrides + resource_promotion_signals + domain_reputation + user_resource_log extension (Phase 3.5)
- 00066 — editor_rooms + whiteboard_rooms archived_at + free_tier + user_room_quota (Phase 9a)
- 00067 — hone_focus_mode_valid CHECK expanded (`pomodoro|stopwatch|free|plan|pinned|countdown`)
- 00079 — db_cleanup_orphans (drop coach_episodes.embedding + onboarding_version + 21 dynamic_config orphan rows)
- 00080 — drop personal_events (calendar bounded context removed)
- 00081 — drop xp_events (gamification cleanup)
- 00082 — drop_vacancies (D1 cleanup 2026-05-11)
- **2026-05-12 marathon (00083 → 00096):** F6 deprecate cols / D8 RPG drop / F2 user_primary_goals / F10 cue_sessions / drop_use_for_arena / BYOK subscription_tiers / google_calendar / drop_peer_collab / stage_templates (R7) / tutor_mode_paths / user_milestones + memory soft-delete / stripe_subscriptions / goal_presets (admin Phase 2)
- Полный список в [../../backend/migrations/README.md](../../backend/migrations/README.md)

## llmchain tasks (текущие)

- `TaskInsightProse` (70B) — weekly killer-stats Russian prose
- `TaskCopilotStream` (70B streaming) — Cue chat
- `TaskReasoning` (70B) — session analyzer + structured analysis
- `TaskCodingHint` (8B, low latency) — on-demand подсказки во время mock
- `TaskCodeReview` (reasoning-heavy) — анализ submit'а
- `TaskSysDesignCritique` (long-context, quality > speed)
- `TaskSummarize` (cheap) — фон для bg-summarizer
- `TaskCustomPathGenerate` (70B) — onboarding «Свой путь»
- `TaskAtlasClassify` (8B) — user TODO → atlas узел
- `TaskCurateResource` (70B) — Phase 1b learning-companion seeding
- `TaskCheckpointGrade` (70B) — Phase 1.7 grading 5-question quiz
- `TaskReflectionExtract` (8B) — Phase 1.7 atlas-node mentions из reflection
- `TaskExtractResourceContent` / `TaskReflectionGrade` / `TaskValidateResource` (Phase 3.5 curation)
- (existing) `TaskAITutorCompact` / `TaskAITutorAssignment` / `TaskMLEngMock` / `TaskCoachInsight`

**Removed 2026-05-11:** `TaskVacanciesJSON` (vacancies feature deleted)

## AI personas — naming rule

`display_name = role-only, lowercase, без human first names.` «algo coach» not «Алёша · алго-коуч». Юзер не должен думать что это реальный человек (Sergey 2026-05-04).

Slugs (post 00057_persona_rename + 00058 ml_de): `algo coach` · `sql mentor` · `system design guru` · `english coach` · `go coach` · `ml coach` · `de mentor`.
