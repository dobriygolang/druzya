# Bundle delta analysis — Phase 1.5

> **Status:** first pass · 2026-05-04. Источник: 13 mockups в [docs/mocks/druz9-hone-bundle/](../mocks/druz9-hone-bundle/) vs current React pages. Дальнейшие итерации добавят per-component tweaks при apply (Phase 2-12).

**Зачем этот файл:** перед apply каждого mockup на real page (UI-phases) — открой соответствующую секцию здесь, чтобы знать (a) какие новые backend ports / state нужны, (b) что dropнуть как dead code, (c) какие миграции применить, (d) какие Phase затронуты. См implementation-plan.md §Phase 1.5 «Cleanup rule».

**Cross-cutting (применять везде):**
- B/W only · #FF3B30 — точка-индикатор / 1.5px stripe / SVG stroke. Не bg/fill/gradient ([feedback_color_rule.md](../../.claude/projects/-Users-sedorofeevd-Desktop-druzya/memory/feedback_color_rule.md)).
- Lowercase microcopy.
- AI persona display_names — role-only. «algo coach» / «sql mentor» / «ml coach», не human first names ([feedback_persona_names.md](../../.claude/projects/-Users-sedorofeevd-Desktop-druzya/memory/feedback_persona_names.md)). При apply — verify что в mockup'ах нет «Лена · sql-mentor» подписей; если есть — заменить на role-only при copy.
- AI-cursor pattern (animated SVG + ai-pulse + ai-label «linking X → Y» + AI-log toast) ре-используется в Coach / Notes / TaskBoard. Один WebSocket / SSE channel `ai_cursor_events`.
- Curation principle (link-not-build): mockups содержат external resource links — backend должен сначала иметь external_resources jsonb (мig 00051) → cmd/seed_resources наполнил → UI читает.

---

## 1. coach (`learning-companion.html` → [Coach.tsx](../../hone/src/renderer/src/pages/Coach.tsx))

### Added
- 3-mode header switcher (explore / commit / deep) с animated indicator pill — wired в `learning_state.mode` (мig 00047 ✅).
- **Fork view (explore-only)** — dual-track comparison (MLE / DE) с progress bars, "felt" sentiment, weekly fork-confidence. Backend: `ForkProgressReader.Snapshot` (✅ Phase 1.7c) → `ForkProgressSnapshot`. RPC `GetForkSnapshot` нужен.
- 5-axis radar chart (DE rubric: etl_design / distributed / sql_modeling / streaming / production_ops) + красный dot на weakest axis. Backend: derive из `mock_sessions.ai_report` JSONB (existing). RPC `GetSkillRadar`.
- AI-cursor live indicator — events stream через WebSocket / SSE.
- Tutor labels в activity stream — verify role-only display (использует existing `ai_tutor_personas` после 00057 + 00058 ✅).
- "Live" chip — focus block currently active. Backend: existing `hone_focus_sessions`.

### Removed
- Старый daily-brief feed-list (если был статичным rendering of past briefs) → replace с rich fork view + radar + activity stream.
- Простой weekly calendar widget (если есть) → удалить если не используется.

### Schema implications
- `learning_state` ✅ (00047)
- `track_steps.checkpoint_skill_keys` / `reflection_required` / `graduation_mock_section` ✅ (00050)
- Hовая колонка может потребоваться: `mock_sessions.skill_radar jsonb` (denormalized 5-axis для быстрого UI без re-aggregation) — TBD при apply.
- `ai_cursor_events` table если решим persist'ить cursor positions для admin observability — иначе только in-memory stream.

### Phase impact
- **Phase 2** (Coach upgrade) — главный deliverable. Нужны: ForkProgressReader RPC port, RadarReader, AI-cursor WS protocol.
- **Phase 12.5** — admin AI-cursor toggle.

---

## 2. notes (`notes.html` → [Notes.tsx](../../hone/src/renderer/src/pages/Notes.tsx))

### Added
- 3-column layout: Sidebar (folders + tree + flat + chips) | Editor | Connections panel (incoming + AI-suggested links).
- Connection cards: 5 top suggestions с strength% (cosine similarity score). Accept / reject buttons.
- AI-cursor (animated SVG over sidebar) с label «linking «cdc» → «postgres internals»». Auto-link на accept.
- AI-log toast (нижний-правый): «linking «cdc patterns» → «postgres internals» · embed score 0.86 · 3s ago · undo».
- Reflection auto-create flow (учитывая plan §Phase 5): submit reflection → новая Note с auto-link на atlas-node через `TaskReflectionExtract` (✅ зарегистрирован Phase 1.7a).

### Removed
- Если current Notes имеет manual link UI — упростить до accept-AI-suggestions only.
- Right-panel outline view (если есть) → replace на connections panel.

### Schema implications
- `note_connections` table: `(from_note_id, to_note_id, strength float, kind text [incoming|suggested|atlas], created_via_ai bool, accepted_at timestamptz, created_at)`. Indexes `(from_note_id, kind)` + `(to_note_id, kind)`.
- `hone_notes.embedding vector(...)` — если ещё нет, нужен для TaskNotesLinkSuggest candidate retrieval.
- `user_resource_log.reflection_note_id` ✅ (00055) — link от reflection-event на Note.

### Phase impact
- **Phase 5** (Notes + AI-link UI) — главный deliverable. Нужны: TaskNotesLinkSuggest wiring, embedding pipeline, AI-cursor pattern reuse, reflection flow → TaskReflectionExtract.

---

## 3. taskboard (`hone-taskboard.html` → [TaskBoard.tsx](../../hone/src/renderer/src/pages/TaskBoard.tsx))

### Added
- 4-column kanban (todo / in flight / tutor review / done) — Notion-style. WIP limits per column.
- Tutor rail (right sidebar) — 3 tutors с avatar, role, active count, review count, capacity bar (n/12). Coach hint про workload imbalance.
- Card metadata: track color strip (DE/MLE/BE), kind glyph (focus/reading/design/eval/mock/review/note), status dot, progress bar для in-flight.
- AI-cursor visible когда AI moves task между columns (drag-drop animation 520ms arc). Через `TaskTaskboardCategorise` (✅ зарегистрирован Phase 1.7a).
- AI coach autoplay 3 speeds — admin/dev tool для demo, не production feature.
- "+128 −34" diff stat для review tasks; flagged state.

### Removed
- 5-column kanban (если есть «dismissed» column) — replace с 4-column.
- Coloured column headers → monochrome + track-color на cards.

### Schema implications
- `tasks.progress real DEFAULT 0` (0..1) NULL для не-in-flight.
- `tasks.kind text` (focus|reading|design|eval|mock|review|note) — расширить existing если ужe enum.
- `tutors.wip_limit int DEFAULT 12`.
- `task_review_metadata` table или JSONB на `tasks.review_meta` (diff stats + flagged + reviewer_avatar).

### Phase impact
- **Phase 10** (TaskBoard) — главный deliverable. Нужны: TaskTaskboardCategorise wiring, optimistic updates, outbox для offline.
- **Phase 8** (Tutor pages) — tutor rail data (capacity, active count) shared.

---

## 4. onboarding (`onboarding.html` → [OnboardingModal.tsx](../../hone/src/renderer/src/components/OnboardingModal.tsx))

### Added
- 3-step wizard (current = 2-step):
  1. **Stack picker** — 5 options: Go senior / ML eng / DE / English / Other-explore.
  2. **Mode picker** — 3 cards: Explore / Commit / Deep (соответствует `learning_state.mode`).
  3. **Shortcuts tour** — interactive overlay с highlights над real Hone панелью.
- Progress dots + hero stripe.
- "Skip" пункт — marks done без сохранения профиля.
- FakeToday blur backdrop для immersion.

### Removed
- Старый 2-step (профиль + shortcuts) — расширен до 3 с Mode picker.

### Schema implications
- `hone_user_settings.onboarding_version int DEFAULT 0` — bump при выходе wizard. Settings → "open onboarding again" восстанавливает.
- Step 2 (mode) — pipe в `learning_state` UC `SetMode` ✅ (Phase 1c done).

### Phase impact
- **Phase 6** (Onboarding modal v2) — главный deliverable.
- **Phase 7** (Settings) — recovery «Open onboarding» в Settings.

---

## 5. tutor (`tutor.html` → [TutorDashboardPage.tsx](../../frontend/src/pages/TutorDashboardPage.tsx) + [TutorStudentPage.tsx](../../frontend/src/pages/TutorStudentPage.tsx))

### Added
- **Dashboard:** roster 12 students с per-card sparklines (focus_min, mock_count). 5 KPIs (active / sessions / avg score / invites pending). Search by username (не UUID). Accordion event-creation form (вместо separate modal).
- **Student detail:** track, score, snapshot (focus_min, mock_count, weak_spots, notes, atlas_done). AI-generated brief markdown (1:1 recommendation за last week). Weak spots с node title + «3/10 attempts < 40». Markdown mini-renderer (без full library). PDF export. Share link.
- AI brief — `TaskTutorPreSessionBrief` (existing) wired с new shape — verify provider chain.

### Removed
- UUID-based student lookup (если есть) → username search.
- Separate event-creation modal → inline accordion.
- Если current не имеет sparklines / weak-spots / share-link — это все additions.

### Schema implications
- `tutor_brief_share_links` table: `(slug PK, tutor_id, student_id, brief_md, expires_at, created_at)`.
- PDF export endpoint: server-side React render (через chromium-headless или wkhtmltopdf).
- Mini-markdown renderer client-side — никаких backend changes.
- `tutor_students` ✅ existing.

### Phase impact
- **Phase 8** (Tutor pages upgrade) — главный deliverable.
- **Phase 1c done** ✅ DE-mocks integration уже готов через `services/ai_mock/domain/de.go`.

---

## 6. stats (`hone-stats.html` → [Stats.tsx](../../hone/src/renderer/src/pages/Stats.tsx))

### Added
- 4 KPI cards с deltas + sparklines (focus min / streak days / tasks done / mock score). Sparklines анимируются (1.4s draw).
- Activity heatmap 7×24 (день × час), intensity 0..3.
- Top topics table (7 rows): topic, min spent, %, bar chart.
- Anomalies list (3 cards): streak break / spike / mock dip — kind-styled.
- Range picker 7d/30d/90d/all.
- «+ log session» modal (structured form: source / topic / minutes — без чата). Pipes в `external_activity` (existing).

### Removed
- Чат с GPT для логирования external — ✅ already removed earlier (project_state.md mentions external_activity 00037).

### Schema implications
- `user_activity_by_hour` table (user_id, date, hour, focus_min) — derived view материализованной из existing focus events. Можно generated column / matview.
- `user_anomalies` table — derived через cron from existing focus_sessions / kata / mock data.
- Top-topics — already covered ExternalActivityReader (✅ existing).

### Phase impact
- **Phase 4** (Stats apply) — главный deliverable. Light на backend (most data already exists), фокус на UI.

---

## 7. settings (`settings.html` → [Settings.tsx](../../hone/src/renderer/src/pages/Settings.tsx))

### Added
- Two-pane: 7 sections nav (left) + content (right). Sections: appearance / focus / learning / account / privacy / system / shortcuts.
- Per-section badge с count.
- Vault setup как modal wizard (не inline).
- Settings search input в header.
- Storage / tier upgrade — elevated card-callout.
- Devices list (macbook / iphone) с last_active + revoke buttons.

### Removed
- Stacked single-page layout (если есть) → tabbed two-pane.
- Inline vault setup → modal.

### Schema implications
- `user_settings` table: `(user_id, section, key, value text)` или JSONB. Существуют ли уже — TBD при apply.
- `user_devices` table — может быть уже. Verify.

### Phase impact
- **Phase 7** (Settings + vault wizard) — главный deliverable.
- **Phase 6** dependency — onboarding recovery link в Settings.

---

## 8. welcome (`web-welcome.html` → [WelcomePage.tsx](../../frontend/src/pages/WelcomePage.tsx))

### Added
- Hero + tagline + Sign-in/up CTAs.
- Feature cards.

### Removed
- Если current имеет старый пафос (sanctum / arena / etc.) — strip как «выпилено» Wave R0-R6.

### Schema implications
- None (frontend-only).

### Phase impact
- **Phase 12** (Welcome ship) — простой replacement.

---

## 9. web-editor (`web-editor.html` → [EditorRoomSharePage.tsx](../../frontend/src/pages/EditorRoomSharePage.tsx))

### Added
- Cursor labels (Figma-style: «Alice on line 42») via Yjs awareness state. Payload existing, нужен render.
- Guest prompt → side panel (не fullscreen gate).
- Output panel restructure: collapsible, syntax-coloured stack traces, clickable line numbers.
- Participant activity timeline (last edit ts).

### Removed
- Если есть guest fullscreen gate — replace на side panel.

### Schema implications
- Existing Yjs awareness state — никаких миграций.
- `editor_room_participants.last_edit_at timestamptz` — possibly add column если нет.

### Phase impact
- **Phase 9** (Web Editor cursor labels) — главный deliverable.

---

## 10. english-hub (`english-hub.html` → [EnglishOverview.tsx](../../hone/src/renderer/src/pages/EnglishOverview.tsx) + Reading.tsx + Writing.tsx + Listening.tsx)

### Added
- Hub page listing 4 sub-modules с progress bars.
- Per-module: lesson list, vocab tracker.

### Schema implications
- `english_progress` table — TBD при apply, может уже есть.

### Phase impact
- Phase outside DAG (English wave не в скоупе learning-companion). Может pojвиться отдельной phase позже.

---

## 11. events (`events.html`)

**SKIPPED.** events / clubs / lobby выпилены за Wave R0. Mockup сохранён как design exploration; в production не уходит.

---

## 12. podcasts (`podcasts.html` → [PodcastsPage.tsx](../../frontend/src/pages/PodcastsPage.tsx))

### Added
- Podcast listing + episode cards.

### Schema implications
- Existing `podcasts` service — verify shape.

### Phase impact
- Polish-tier (Phase 11).

---

## 13. logo-lab (`hone-logo-lab.html`) — **NOT a ship surface**

Design exploration only — logo variations + design system. **Skip apply phase.** Mention в changelog как exploration artifact. Не создавать React page.

---

## Cross-file cleanup checklist (apply при каждой UI-phase)

При apply mockup → real page обязательно:
1. **Backend handler/usecase/repo для removed feature → delete** (grep по removed RPC method names).
2. **Connect-RPC port → drop method, regenerate proto** (`make generate`).
3. **Migration cleanup** (если data not needed) — отдельной миграцией с DROP TABLE / column.
4. **Mock handlers в `frontend/src/mocks/handlers/` → drop соответствующие** (grep patterns).
5. **Tests на removed handlers → drop**.

## Open questions (для Sergey перед UI-phases)

1. **events.html** — re-introduce или skip mockup? (project_state.md говорит «events выпилены 2026-05-01»).
2. **AI-cursor persistence** — persist'им events в DB (admin observability) или только in-memory WS stream?
3. **PDF export для tutor brief** — chromium-headless или wkhtmltopdf? Влияет на infra deps.
4. **Stats anomalies** — derive cron'ом или real-time? (perf vs freshness tradeoff).
5. **TaskBoard AI coach autoplay** — оставить только dev-mode или production demo feature?

## Next iterations

Этот pass — UI-level diff. Per-component prop-level mapping (e.g. что именно в `<Card>` props новое) делается inline при каждой UI-phase apply. Если при apply встретится конфликт — обновлять этот файл рядом с PR.
