# druz9 — identity (clarified 2026-05-11, MVP implementation 2026-05-12, refined 2026-05-13)

## Что мы

**AI-guide** который наблюдает за external learning (LeetCode, deep-ml.com, NeetCode, Coursera, любая платформа) и **ставит цели + строит планы + предсказывает готовность**. Не строим content — ранжируем чужой.

**Three surfaces, one identity (Wave 8 refinement: doing / learning / performing):**

| Surface | Verb | Где | Что делает |
|---|---|---|---|
| **Web** (druz9.online) | **learning** | `frontend/` | Entry + AI-coach + AI-mock interview (5-axis radar) + Atlas + Codex + tutor toolkit + Whiteboard/Editor solo + Podcasts + **Lingua** (English hub: reading / writing / listening / speaking + vocab SRS, PWA-offline для vocab review) |
| **Hone** | **doing** | `hone/` | Тихий daily focus-cockpit для разрабов: AI-план, focus-timers (6 modes), заметки с AI-link, taskboard с auto-categorise. **Не содержит learning UI** — English / Atlas / Codex живут в web. Offline-first («должен работать в самолёте») |
| **Cue** | **performing** | `cue/` | Stealth tray-copilot для собесов: невидим при screen-share (NSWindowSharingNone + setContentProtection), live-транскрипт + AI-подсказки |

**Tracks (3 equal):** Go senior · ML engineering · English (opt-in toggle). Все три — first-class, нет «главного». User picks один (primary) или несколько (sticky combo). Каждый трек — свой mock-rubric, свой Atlas-подграф, свой AI-coach persona (go-coach / ml-coach / english-coach). **English surface = web Lingua** (read / write / listen / speak + vocab SRS). Hone больше не содержит English UI — Wave 8 (2026-05-13) перевёл learning в web; existing Hone-юзеры получают one-time LinguaMigrationModal с deep-link на `druz9.online/lingua`.

**Memory + Goal + Predictions = главный moat.** AI-coach **с памятью** что юзер сделал на любой external платформе → ставит правильные цели → разбивает на weekly milestones → предсказывает «65% готов к Google L4 algo, ещё 3 недели до SysDesign ready».

## Что мы НЕ

- ❌ Не content platform — не LeetCode, не deep-ml.com, не NeetCode, не Skyeng, не Coursera
- ❌ Не job board / marketplace — Vacancies surface удалён (2026-05-11)
- ❌ Не peer collaboration в Hone — Whiteboard/Editor переезжают в web solo-mode; Circles заменяется на Google Calendar sync
- ❌ Не RPG / rating system — Arena / Sanctum / GhostRuns / friends / cohort / achievements — всё удалено
- ❌ Не paid marketplace — Boosty leftovers вычищены

## Главный axis

Юзер живёт в external resources, druz9 — **invisible co-pilot** который знает **где** он, **что** сделал, **где** запутался, **куда** идти дальше.

- **Cue** ловит interview-сигналы (live транскрипт + persona подсказки)
- **Hone** — daily focus (3-5 AI-generated actions, reflection capture)
- **Web** — diagnostic checkpoints (AI-mock pipeline 5 stages) + reference (Codex / Atlas)

Three products **работают вместе**. После Cue session транскрипт → Coach memory. Coach видит: «вчера на Google interview struggled with sharding question. Want to review?»

## Curation = ranking-proxy (не build)

`atlas_nodes.external_resources jsonb` + `track_steps.external_resources jsonb` (mig 00051) — линки на чужое (Strang LA / DDIA / mlcourse.ai / Kleinberg / HuggingFace / NeetCode / Kaggle / Strang lectures / deeplearning.ai). Per-user overrides в `user_resource_overrides` (mig 00065). Auto-promote daemon (Phase D) обновляет `resource_promotion_signals.avg_quality` из reflection grades.

**Никогда не строим:** свой курс, свою задачу, свою книгу. Только ранжируем + объясняем тонкости через AI-coach.

## Что unique наше (build, not link)

| Слой | Где |
|---|---|
| **AI-mock** simulation 5 stages (HR / Algo / Coding / SysDesign / Behavioral) per company (Yandex имеет Algo, Ozon — нет) | `services/ai_mock` + `services/mock_interview` |
| **AI-coach** с persistent памятью per-user | `services/ai_tutor` + `services/intelligence` |
| **Hone** focus cockpit | `hone/` + `services/hone` |
| **Cue** stealth tray-copilot | `cue/` + `services/copilot` + `services/transcription` |
| **Intelligence** — daily brief, predictions, fork-analysis, proactive insights | `services/intelligence` |
| **Curation** — ranking-proxy с user overrides + auto-promote | `services/curation` |

## Монетизация (decided 2026-05-11)

**Free covers learning. Pro covers evaluation. BYOK escape.**

- **Free (default):** AI-coach с памятью (unlimited chat), Atlas full, Codex, Hone basic, Cue basic (20 calls/day), activity log + browser extension, manual mock without AI feedback, reflection grading
- **Pro 990₽/mo:** unlimited AI-mock pipelines, deep readiness analytics, premium Cue personas + unlimited LLM + 8h sessions, Google Calendar sync, F8 diagnostic mode, advanced goal analytics, priority LLM cascade (Cerebras/Groq for speed)
- **BYOK unlock (free):** user provides own LLM API key → Pro features unlocked, cost shifts to user

**Tutor mode** = role toggle в /profile (не отдельное app). Free per identity claim.

## Hard rules

- **Free LLM only.** Cascade: groq → cerebras → google → cloudflare → zai → mistral → openrouter → deepseek → ollama. Anthropic / OpenAI напрямую — запрещены.
- **B/W only design.** `#FF3B30` ТОЛЬКО как точка-индикатор / 1.5px stripe / SVG stroke. Никогда bg/fill/gradient.
- **Offline-first Hone.** Любая client-initiated write → outbox-able.
- **Responsive everywhere.** Flex на любое разрешение, no fixed widths без min/max + flex-wrap.
- **Curation = ranking-proxy.** Никакого собственного content.
- **Контракт через `.proto`.** После любых изменений → `make generate`.
- **Solo founder constraints.** YAGNI absolutely. No feature flags / migration shims / hypothetical abstractions.

## Implementation status (2026-05-12 marathon + Phase J/H6 polish)

Identity claim полностью реализован end-to-end. Идентификатор реализации — DB v109 (marathon migrations 00083-00109, full list в [../tech/backend.md](../tech/backend.md)).

**Phase J shipped 2026-05-12:** light theme kill switch finalised (B/W only across web/Hone/Cue), Cue onboarding wizard (4 screens), Cue interview-prep wizard (CV+JD upload, mig 00108), C4 diarization SpeakerLabel chips, stealth-verifier probe (DesktopConfig warns), Cue masquerade builds CI'd (cue-masquerade-release + validate workflows). H6 README refresh (page count Hone 16→15, Cue feature surfaces, root + docs/tech/frontend.md, docs/feature/identity.md + CLAUDE.md migrations/roadmap).

**Loop end-to-end (verified):**
1. **Goal set** → wizard (F2) → backend persists (intelligence service) → cache mirror в frontend localStorage
2. **Diagnostic** (F9 multi-track quiz) seeds readiness factors
3. **Readiness compute** (F3 deterministic engine) consumes goal + diagnostic + activity + streak + mini-mock + trajectory + LLM milestones
4. **Daily plan** (F7) generates 3-5 actions per readiness/budget/weakness
5. **Activity log** (F5 UI + Chrome MV3 extension MVP) — 1-click ✓ + Cmd+L hotkey → readiness ticks immediately
6. **Mock pipeline** R2 — 5 stages (HR / Algo + Judge0 / Coding + LLM rubric / SysDesign + canvas + 5-axis / Behavioral + voice MediaRecorder) + radar debrief
7. **Cue session.end** → analysis ready → POST `/intelligence/interview-sessions/ingest` → coach_episodes row → memory visible at next coach interaction
8. **Memory audit** (F1 Phase 2) — `/profile/memory` surface shows everything AI remembers + delete one entry → AI больше не reads
9. **Insights** (F4 14 rules) — coach speaks first: «3 дня без активности», «streak 5 дней», «mini-mock устарел», «дедлайн 14d / readiness 35%»
10. **Pro purchase** — Stripe checkout → webhook → tier flip → unlimited gating через `<ProGate>`. **BYOK escape** — paste OpenRouter/Groq/Cerebras/Anthropic/OpenAI key → tier=pro source=byok

**Cross-product moat live:** Cue session-end → backend ingest → Coach memory → web `/profile/memory` + AITutorChatPage CoachMemoryCard slice + F4 insight «свежая Cue session — разобрать с coach?».

## Identity-документы (источник правды)

- **Этот файл** — каноническая identity, обновлять при сдвиге фокуса
- [../README.md](../README.md) — entry для docs/
- [../../CLAUDE.md](../../CLAUDE.md) — orientation для AI-агентов
- `~/.claude/plans/system-design-ux-copy-user-research-compiled-beacon.md` — 24-26-week roadmap (private)
