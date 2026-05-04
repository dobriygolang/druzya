# Implementation plan — после research + design pass

> **Статус (2026-05-04):** research-doc готов · Claude design отработал **13 mockups** (полный bundle) · Phase 0 / 1 / 1.5 / 1.7 / 2 / 3 ✅ ship'нуты. Этот файл — phased plan для нового чата с пустым контекстом.

## Phase progress (2026-05-04)

| Phase | Статус | Комментарий |
|---|---|---|
| 0 — Decisions | ✅ done | research §7 решения зафиксированы |
| 1 — Backend foundation | ✅ done | DB v52: миграции 00047–00052, services/learning_state, services/curation, ai_mock DE pool, cmd/seed_resources CLI |
| 1.5 — Bundle delta analysis | ✅ done | [bundle-deltas.md](bundle-deltas.md) для 13 mockups |
| 1.7 — AI readiness | ✅ done | DB v60: 10 LLM tasks, 2 personas + 5 prompt cleanup, 3 readers, 2 producers, prompt sections, eval datasets, throttle + observability tables |
| 2 — Coach (learning-companion) | ✅ done | DB v63: SetLearningMode + GetForkSnapshot + GetNextAction + GetResourceTrail + GetSkillRadar + GetCoachStats + LogResource RPCs; backend UCs; Hone Coach.tsx page (mode switcher / hero CTAs / snapshot 4-KPIs / 5-axis radar / fork view / activity feed / AI-cursor); tracks step UX (StartCheckpoint / SubmitCheckpoint) |
| 3 — Atlas customization | ✅ done | DB v64: AtlasNode.is_user_owned + "your todo" badge; SetAtlasNodePref RPC + pin/hide buttons на AtlasDrawer; user_atlas_node_prefs table; SkillNode.pinned/hidden поля в proto + GetAtlas joins prefs; AtlasExplorePage filters hidden + PinnedRibbon |
| 4 — Stats apply | ✅ done | Hone Stats.tsx full page (range picker / 4 KPI cards / 7-day heatmap / top topics / external activity feed / + log session modal через ExternalActivityModal); StatsOverlay (peek через S) остался. Palette → page; reuses GetStats + GetCoachStats + ListExternalActivity, no new RPCs. |
| 3.5 — Personal resource library + adaptive AI | ✅ done | DB v65 (overrides + promotion + reputation + log extension); fetcher.go (5 strategies); 3 LLM tasks (TaskExtractResourceContent / TaskReflectionGrade / TaskValidateResource) + UCs; 5 producers (coverage / gap / redundancy / confusion / auto_promote); curation Connect-RPC (8 methods) + REST aliases; bootstrap wired; build clean. **Notify Sergey hookup в bootstrap для auto_promote — TODO в follow-up**. |
| 5 — Notes + AI-link | ✅ done | Phase 5 native: SuggestNoteLinks RPC + AI-suggested panel + reflection note auto-create + embed. Phase 5 5a-c: ReflectionModal + AddResourceModal + ResourceCard. **ResourceLibrarySection** mounted в Settings — manual add-resource entry-point (Path C low-key). Coach / step-UI auto-trigger flow — TODO follow-up. |
| 11 — Polish + palette | partial | 11a palette cleanup ✅ (7 native-only items). 11b offline UI states (disabled tooltips для AI-mock / AI-tutor) — pending. Stagger / shimmer / View Transitions — pending. |
| 6 — Onboarding v2 | ✅ done | 3-step wizard: pick stack (Go/ML/DE/English/Other) → pick mode (Explore/Commit/Deep) → shortcuts tour. localStorage `hone:profile:v2` + `hone:onboarded:v2`. Recovery в Settings «open onboarding again». |
| 7 — Settings + vault wizard | partial | «Open onboarding again» recovery ✅. **§7a Developer tools section ✅** — DeveloperToolsSection (collapsed-by-default, room create CTAs, active+past lists, share link, restore, free-tier counter). Vault wizard полный mockup re-apply (sections layout, sidebar nav, tabs) — deferred. |
| 9 — Web Editor cursor labels + standalone rooms | partial | **§9a standalone rooms backend ✅** (Path C low-key): DB v66 (archived_at + free_tier + user_room_quota) · services/rooms (Create/List/Extend/Delete/Restore + SweepExpired) · RoomService Connect-RPC + REST aliases · TTL daemon hourly cron в bootstrap modules. Cursor labels (Yjs awareness) — deferred per-session (web). |
| 8 — Tutor pages | deferred | Frontend (web) `TutorDashboardPage.tsx` + `TutorStudentPage.tsx` — full mockup re-apply (585 LOC mockup → 1116 LOC existing). Per-session work. |
| 9 — Web Editor cursor labels | deferred | Frontend (web) `EditorRoomSharePage.tsx` — full mockup re-apply (543 LOC mockup). Per-session work. |
| 10 — TaskBoard auto-categorise | ✅ done | UC `CategoriseTask` wired в Handler + bootstrap. **Caller-gate в CreateTask UC** — fire-and-forget goroutine после Create вызывает Categoriser + SetStatus. **AICursor SSE event publish** при auto-move — frontend AICursor рендерит animation card→column. Mockup full re-apply (1234 LOC kanban) deferred. |
| 12 — Welcome ship | deferred | Frontend (web) `WelcomePage.tsx` — full mockup re-apply (504 LOC mockup → 809 LOC existing). Per-session. |
| 12.5 — Admin extensions | partial | DB v60 (observability) + v63 (audit log) ✅. `ObservabilityReader` + `AdminRoomsReader` ✅. **REST endpoints wired:** `GET /admin/rooms` (filters: user_id/kind/status/limit) · `GET /admin/rooms/top-creators` · `POST /admin/rooms/bulk-archive` · `GET /admin/observability/llm` (task rollups) · `GET /admin/observability/eval-runs`. Admin UI frontend pages — deferred (no mockups in bundle). |
| 12 — Welcome | n/a | `frontend/src/pages/onboarding/Step0Tracks.tsx` уже работает с пo-tier picking + seniority + primary track flow. Mockup web-welcome.html — simplified 3-card alternative; replacement отнесёт ломки backend wiring. Not applied. |
| 5–12 | pending | UI mockup applies |
| 12.5 — Admin extensions | partial | DB v63 audit_log + observability tables; admin UI pages pending |

## Что уже сделано

| Артефакт | Где |
|---|---|
| Identity doc (current) | [docs/feature/identity.md](identity.md) |
| Claude design bundle (13 экранов) | [docs/mocks/druz9-hone-bundle/](../mocks/druz9-hone-bundle/) — coach · stats · taskboard · welcome · logo-lab · notes · settings · web-editor · tutor · onboarding · english-hub · events · podcasts |
| Bundle delta analysis | [bundle-deltas.md](bundle-deltas.md) |

**ВАЖНО:** Claude design в каждом mockup мог добавить новые фичи и убрать старые. Phase 1.5 ✅ — bundle-deltas.md написан, но оставшиеся UI-phases должны при apply сверяться с ним и удалять removed features.

## Curation principle (architectural decision · 2026-05-04)

**druz9 не создаёт content.** Мы — ranking-proxy + interview cockpit + AI coach. Конкурировать со Strang / mlcourse.ai / Andrew Ng / DDIA / Kleinberg на качестве материала бессмысленно.

### Что курируем (links на чужое)

- **Theory** — Strang LA, ods.ai mlcourse, deeplearning.ai, DDIA, Kleinberg, Sebastian Raschka blog, HuggingFace course
- **Practice** — LeetCode tags, Kaggle competitions, HackerRank SQL, NeetCode
- **Reading** — papers, blog-posts, YouTube — линки в `atlas_nodes.external_resources` + `track_steps.external_resources`

### Что unique наше

| Слой | Где |
|---|---|
| **AI-mock** с 5-axis rubric per role (Go/MLE/DE/English HR/sysdesign) | `services/ai_mock` |
| **Codex** — короткие opinion-pieces ~600 слов как bridge theory↔practice | `codex_articles` |
| **AI-tutor** с 4-layer памятью, persona-based | `services/ai_tutor` |
| **Hone** — focus cockpit, daily plan, stats, AI-cursor proactive | `hone/` |
| **Intelligence** — daily-brief, severity, fork-analysis | `services/intelligence` |

### Schema implication

`atlas_nodes` и `track_steps` получают новую колонку `external_resources jsonb` со shape (расширен 2026-05-04 для anchor'а на atlas-ontology — без этого AI-tutor / TaskReflectionExtract / resource-engagement producer слепые на features):

```json
{
  "url": "https://mlcourse.ai/book/topic03/topic03_decision_trees.html",
  "title": "Topic 3 · Decision Trees",
  "author": "ods.ai",
  "kind": "course | video | book | paper | article | tool | kata | podcast",
  "minutes": 45,
  "level": "A | B | C | D",
  "priority": "core | supplement | optional",
  "why": "best intuition for impurity-based splitting without code",

  "topics_covered": ["ml_classical", "ml_evaluation"],
  "prereqs":        ["ml_data_intuition"],
  "summary":        "Decision trees and ensembles intuition. Skips formal information-theoretic derivation; pairs well with Strang for math.",
  "depth":          "intro | intuition | deep | reference",
  "format_notes":   "interactive | paywalled | video-no-transcript | code-only-no-prose | (empty)",
  "reflection_prompt": "<optional 1-line — UI fallback на generic если пусто>"
}
```

Новые поля (omitempty в curation/domain.Resource):
- `topics_covered` / `prereqs` — atlas_node ids; AI-tutor использует чтобы понимать что юзер только что покрыл, resource-engagement producer закрывает gap'ы.
- `summary` — 2-3 предложения; coach hero / AI-tutor цитирует без чтения целого ресурса.
- `depth` — content shape (ortho к `level` — intuition может быть senior-level).
- `format_notes` — UI-hint строкой, не enum (formats разнообразны).
- `reflection_prompt` — optional 1-line; если пусто, step UX берёт generic «1 sentence — главное?».

Старая колонка `recommended_reading text[]` — deprecated, новый UI читает только `external_resources`.

### Seed flow

CLI tool `cmd/seed_resources/main.go`:
1. Читает все atlas_nodes
2. Для каждого зовёт LLM (`TaskCurateResource`) с template-промптом «дай 3-5 best free ресурсов в правильном порядке»
3. Sergey review через generated SQL → edit → apply
4. Tutor добавляет свои через shared-materials (Phase 8)

**Why:** Sergey 2026-05-04: «есть много ресурсов в интернете лучше нас — давайте просто давать ссылки». Совпадает с identity.md «НЕ Coursera».

**Decision rule:** при любом feature design — спроси «есть ли это уже в интернете лучше?». Если да — link, не build. Build только unique (mock / codex / coach / hone / intelligence).

---

## Phase 0 — Decisions (1-2 часа, перед стартом)

Резолв §7 open questions из research-doc:

1. `learning_state.mode` enum vs string — **enum**
2. Custom atlas nodes private vs shareable — **private MVP**
3. `explore → commit` — **manual + auto-suggest от intelligence**
4. Fork-analysis cadence — **weekly cron + on-demand override**
5. DE-pool вопросы — **5-10 sergey-формулировок + LLM expand под фиксированный prompt**
6. Hone /coach mobile — **desktop only MVP**
7. Dead outbox ops UX — **visible с retry button**

Выход: решения зафиксированы в [identity.md](identity.md) (Sergey 2026-05-04).

---

## Phase 1 — Backend foundation + curation seeds (7-10 дней)

**Зачем:** без data-model + первичной курации ML/DE-треки не имеют контента.

### 1a · Schema migrations

> **Numbering shift (2026-05-04):** `00045` / `00046` уже заняты (tutor_session_notes, drop_ml_track_kind), nominal numbers сдвинулись на +2.

- `00047_learning_state.sql` — table (user_id PK, mode enum [explore/commit/deep], fork_branch enum [de/mle/none/null], explore_started_at, committed_track_id FK, committed_at)
- `00048_de_track.sql` — `track_kind ADD VALUE 'de'` (no transaction)
- `00049_de_atlas_seed.sql` — 12 узлов: de_root (hub), de_etl_pipelines, de_warehouses, de_streaming, de_sql_optimization, de_spark, de_data_quality, de_orchestration, de_observability, de_modeling, de_governance, de_mlops_overlap. cluster='de' sort 900-911.
- `00050_de_curated_track.sql` — `tracks` row + 9 `track_steps` (sequences-of-resources). **Включает 3 ALTER TABLE на `track_steps`:**
  - `ADD COLUMN checkpoint_skill_keys text[] NOT NULL DEFAULT '{}'` — какие skill-теги юзаются для checkpoint quiz из mock_pool
  - `ADD COLUMN reflection_required boolean NOT NULL DEFAULT false` — required reflection после core resource (auto-creates Note с auto-link на atlas-node)
  - `ADD COLUMN graduation_mock_section text` — `'ml_eng'` / `'de'` / null. Optional graduation AI-mock в конце шага, score feeds fork-analysis
- `00051_external_resources_schema.sql` — `ALTER TABLE atlas_nodes ADD COLUMN external_resources jsonb NOT NULL DEFAULT '[]'`. Same для `track_steps`.
- `00052_ml_curated_track.sql` — MLE curated track + 9 `track_steps`. Узлы есть (00033, re-tag'нуты в 00046).
- `00056_step_checkpoint_attempts.sql` — таблица результатов checkpoint quiz: `id uuid PK, user_id uuid FK, step_id uuid FK, score int (0..100), attempts jsonb (per-question results), passed_at timestamptz NULL, created_at timestamptz`. Индекс `(user_id, step_id, created_at DESC)` для latest-attempt lookup.

### Step UX flow (2026-05-04 update — track_step layout)

Каждый track_step теперь sequence:
1. **Resources** — curated links (2-3 core + supplement из `track_steps.external_resources`)
2. **Reflection prompt** после каждого core resource (1 sentence «главное?») → save в Notes auto-linked на atlas-node (см Phase 5)
3. **Checkpoint quiz** после ≥2 core (5 questions из `mock_pool` по `checkpoint_skill_keys`, AI-graded, ≥70% — soft-unlock следующего step'а)
4. **Optional graduation mock** (existing AI-mock с rubric, `graduation_mock_section`), score feeds fork-analysis

**Why:** "mark done после resource" делал нас Notion-аналогом без hook'a возврата. Reflection + checkpoint держат юзера в нашем UX (без них он уйдёт на Strang/Andrew Ng и не вернётся).

### 1b · Curation seeds (через AI + review)

CLI tool: `cmd/seed_resources/main.go`
- `--node de_etl_pipelines --kind theory --count 5` → LLM генерит resource-list JSONB
- Output: SQL UPDATE statements для review

Sergey workflow:
1. Run для всех нод DEV/ML/DE/English (~80 нод × 3-5 ресурсов = ~300 entries)
2. Review каждый — drop тухлые / переставить порядок / переписать `why`
3. Apply final migrations: `00053_atlas_resources_seed.sql` (по cluster), `00054_track_steps_resources_seed.sql` (по step_id) — nominal numbers; точные сдвинутся при apply order.

LLM task `TaskCurateResource` в llmchain — структурный output JSON.

**Step-flow consideration (2026-05-04):** для core resources в curated tracks выставлять `reflection_required=true` на корреспондирующем `track_step`. Curation не пишет saved-reflections, но shape ресурса может опционально включать `reflection_prompt` (1-line вопрос для reflection-modal'и Phase 2/5).

### 1c · Code

- `services/ai_mock/domain/de.go` — 20 questions + 5-axis rubric (etl_design / distributed / sql_modeling / streaming / production_ops)
- `enums.SectionDE` + `IsDESection()` helper, branch в `service.go: BuildSystemPrompt`
- `services/learning_state/` — domain + repo + 2 use cases (Get, SetMode/SetFork)
- `services/curation/` (новый) — typed `Resource` struct, JSON marshal/unmarshal, validation rules
- `cmd/seed_resources/` — CLI генератор

**Размер:** L (7-10 дней — основная нагрузка на curation review, не код).
**Блокирует:** Phase 2, 3, 8.

---

## Phase 1.7 — AI readiness checklist (1-2 дня)

**Зачем:** новые LLM tasks, personas, readers, producers сейчас разбросаны по описаниям Phase 2/4/5/10. Implementation легко полу-сделает (один task завершит, два забудет). Эта phase — explicit enumeration. Без неё AI-готовность будет 60-70%, а не 100%.

### 1.7a · Новые LLM tasks (13 штук в `backend/shared/pkg/llmchain/task_map.go`)

| Task | Used in | Cache | JSON | Provider preference |
|---|---|---|---|---|
| `TaskCurateResource` | Phase 1b | ✅ | yes | groq → mistral |
| `TaskAssistantNextAction` | Phase 2 (Coach hero) | ❌ | yes | groq → cerebras |
| `TaskAssistantForkAnalysis` | Phase 2 (weekly cron) | ❌ | yes | groq 70B |
| `TaskAssistantRereroll` | Phase 2 (dismiss flow) | ❌ | yes | cerebras |
| `TaskNotesLinkSuggest` | Phase 5 | ✅ (per note+cand-hash) | yes | groq |
| `TaskTaskboardCategorise` | Phase 10 | ❌ | yes | cerebras |
| `TaskAITutorML` | Phase 1 (chat with ml coach) | ❌ | text | groq 70B |
| `TaskAITutorDE` | Phase 1 (chat with de mentor) | ❌ | text | groq 70B |
| `TaskCheckpointGrade` | Phase 1a/2 (step checkpoint quiz · 5 questions) | ❌ | yes | groq 70B |
| `TaskReflectionExtract` | Phase 5 (reflection → atlas-node mention extraction для auto-link) | ✅ (per text hash) | yes | cerebras 8B |
| `TaskExtractResourceContent` | Phase 3.5 (add-resource flow — fetcher text → Resource shape) | ✅ per URL hash, 7d | yes | groq → mistral |
| `TaskReflectionGrade` | Phase 5 (post-pomodoro multi-takeaway reflection — quality + extracted_topics + confusion_flag) | ❌ user-context | yes | cerebras (fast) |
| `TaskValidateResource` | Phase 3.5 (auto-promote alive/reputable/on_topic check) | ✅ per URL daily | yes | groq |

**`TaskCurateResource` input/output (2026-05-04 patch):** prompt'у нужны title/section/cluster/description исследуемого atlas-узла + список соседних узлов (для подсказки `topics_covered`/`prereqs`). Output — `curation.Resource` со всеми полями включая `topics_covered`/`prereqs`/`summary`/`depth`/`format_notes`. Эмиттер: `cmd/seed_resources/main.go::buildPrompt`.

**`TaskReflectionExtract` input (2026-05-04 patch):** input включает `finished_resource.topics_covered` как expected concepts (ranking signal: «юзер должен был коснуться этих node ids»). LLM сравнивает с reflection text и возвращает actually-mentioned subset + missed concepts (signal для resource-engagement producer).

Per-task deliverable:
- Prompt template (`backend/shared/pkg/llmchain/prompts/<task>.tmpl`)
- Provider chain в task_map с fallback
- Output struct + JSON schema validation (где `JSON=yes`)
- Smoke-test (1 пример) в eval-cmd

### 1.7b · ai_tutor personas (2 новых через `00054_ml_de_personas.sql`) + rename existing (`00057_persona_rename.sql`)

**Naming rule (Sergey 2026-05-04):** `display_name` ВСЕГДА role-only, lowercase. Никаких human first names — юзер не должен думать что это реальный человек. См memory/feedback_persona_names.md.

New personas:

| Slug | display_name | scope_track_kind | LLM task | Pace/week |
|---|---|---|---|---|
| `ml-coach` | `ml coach` | (sub-cluster `ml` под dev_senior) | TaskAITutorML | 3 |
| `de-coach` | `de mentor` | `de` | TaskAITutorDE | 3 |

Existing personas — rename через `00057_persona_rename.sql`:

| Slug | OLD display_name | NEW display_name |
|---|---|---|
| `algo-coach` | Алёша · алго-коуч | `algo coach` |
| `sql-mentor` | Лена · sql-mentor | `sql mentor` |
| `sysdesign-guru` | Кирилл · sysdesign-guru | `system design guru` |
| `english-coach` | Maria · english-coach | `english coach` |
| `go-coach` | (existing — verify) | `go coach` |

Prompt template per persona — placeholder `{{snapshot}}` `{{facts}}` `{{summary}}` `{{user_message}}`. Стиль: technical-direct, role + memory без personification («I'm your algo coach. Я помню что у тебя слабое DP» — НЕ «I'm Алёша»). Drop все references to human names в существующих prompt templates.

### 1.7c · Intelligence readers (3 новых в `services/intelligence/infra/cross_readers.go`)

- **`ResourceEngagementReader`**
  - reads новую таблицу `user_resource_log` (миграция `00055_resource_log.sql`: user_id, resource_url, atlas_node_id, kind enum [clicked/finished/skipped/unhelpful], occurred_at, **`reflection_text text` NULL, `reflection_note_id uuid REFERENCES notes(id) ON DELETE SET NULL`** — для reflection auto-link flow Phase 5)
  - methods: `RecentlyTouched(user, days)`, `UnfinishedCount(user)`, `MarkedUnhelpful(user, days)`, `RecentReflections(user, days)`

- **`ForkProgressReader`**
  - reads `learning_state` + cross-refs mock_sessions per fork_branch
  - methods: `CurrentBranch(user)`, `BranchScores(user, branch)`, `ConfidenceTrail(user, weeks)`

- **`ExternalActivityReader`** (закрытие gap research §3.4)
  - reads `external_activity` (00037 уже существует)
  - methods: `Last7Days(user)`, `BySource(user, source)`, `TopTopics(user)`

### 1.7d · Intelligence producers (7 в `services/intelligence/app/producers/`)

Phase 1.7 ships первые 2; Phase 3.5 добавляет ещё 5.

| Producer | Phase | Cadence | Что делает |
|---|---|---|---|
| `fork_progress.go` | 1.7 | weekly + on-demand | `TaskAssistantForkAnalysis` (branch scores, time spent, voluntary deep-dives) → Insight `kind=fork_recommendation` с `lean_branch`/`confidence`/`severity` |
| `resource_engagement.go` | 1.7 | daily | «5 ресурсов unfinished», «marked unhelpful — есть replacement?» → Insight `kind=resource_followup` |
| `coverage_confirmation.go` | 3.5 | daily | atlas-node mark `confirmed-mastered` если есть resource finished + `reflection_quality ≥ 0.7` |
| `gap_detection.go` | 3.5 | daily | Prereq atlas-nodes без confirmed coverage → insight «before next step, close gap» |
| `redundancy_signal.go` | 3.5 | weekly | ≥3 finished resources с same `topics_covered` + quality ≥ 0.85 → «well-covered, can move on» |
| `confusion_pickup.go` | 3.5 | daily | Reflections с `confusion_flag=true` → AI-tutor ping |
| `auto_promote.go` | 3.5 | daily cron | См §3.5d auto-promote algorithm |

### 1.7e · Prompt sections (в `daily_brief_prompt.go`)

Добавить 2 новых блока к существующим (USER GOALS / PENDING FOLLOW-UPS / etc.):

- **`FORK STATUS`** (только если user в explore mode):
  ```
  FORK STATUS
  branch: explore · week 3 of 6
  scores: MLE 3/5 (avg mock 62) · DE 4/5 (avg mock 71)
  signals: 4 voluntary DE deep-dives, 1 MLE
  current lean: DE · confidence 0.68
  ```

- **`RESOURCE TRAIL`**:
  ```
  RESOURCE TRAIL · last 7 days
  finished: Strang ch.3 · mlcourse topic-3 · DDIA ch.7
  unfinished: Andrew Ng W2 (started 5d, 30%)
  unhelpful: «distilbert tutorial» (marked 2d ago)
  ```

### 1.7f · Eval datasets (extend `make eval-coach` → `make eval-ai`)

В `backend/services/intelligence/cmd/eval_ai/`:

- `dataset_next_action.json` — 5 scenarios. Regression: action должен цитировать конкретный mock weak axis / track step. Generic action = FAIL
- `dataset_fork_analysis.json` — 4 scenarios. Regression: confidence не должен прыгать > 0.3 без нового сигнала
- `dataset_curate_resource.json` — 6 scenarios. Regression: 3-5 ресурсов always + valid URLs + non-empty `why`
- Existing `dataset.json` для coach остаётся

Makefile target: `make eval-ai` runs all 4 datasets, exit 1 на любой failure (CI-friendly).

### 1.7g · Cost / throttle

- CLI `cmd/seed_resources/main.go` — throttle 10 calls/min, batch 5 nodes per run
- `TaskNotesLinkSuggest` — client-side debounce 5min idle перед запросом
- `TaskAssistantNextAction` — 1/day per user (cached till midnight)
- Per-user daily quota — `ai_chat_quota` table (user_id, date, count, soft_limit=30, hard_limit=100)

### 1.7h · Admin observability hooks (intercept для Phase 12.5)

- Per-task volume / latency / cost — экспортировать в `dynamic_config_metrics` table
- Per-user quota usage — viewable via admin
- Eval suite latest scores — store в `eval_runs` table

**Размер:** S-M (2-3 дня — 10 LLM tasks + smoke-tests + миграции 00054 + 00055 + 00057_persona_rename).
**Зависит:** Phase 1 (schema migrations + curation).
**Блокирует:** Phase 2 (TaskAssistantNextAction + TaskCheckpointGrade), Phase 5 (TaskNotesLinkSuggest + **TaskReflectionExtract**), Phase 10 (TaskTaskboardCategorise) + Phase 12.5 admin observability.

---

## Phase 1.5 — Bundle delta analysis (1-2 дня)

**Зачем:** Claude design в каждом mockup мог добавить новые фичи / убрать старые. Без анализа frontend поедет с UI без backend, или мёртвые handlers будут копиться. Этот phase — обязательный gate перед всеми UI-implementations (Phase 2,4,5,6,7,8,9,10,12).

### Процесс per file

1. Открыть [bundle/{name}.html](../mocks/druz9-hone-bundle/) + соответствующий current page (e.g. `Notes.tsx`)
2. Diff layout / props / mock-data / EDITMODE-TWEAK keys
3. Зафиксировать в `docs/feature/bundle-deltas.md` секциями:
   - **Added** — новые UI фичи (нужен новый backend)
   - **Removed** — фичи которых не стало (нужен cleanup)
   - **Schema implications** — новые миграции / удалить старые таблицы
   - **Phase impact** — какие Phase 2-12 затронуты
4. Update affected Phase описание в этом плане с concrete delta

### Per-file checklist (13 экранов)

- [ ] **coach** ([learning-companion.html](../mocks/druz9-hone-bundle/learning-companion.html)) → `hone/src/renderer/src/pages/Coach.tsx`
- [ ] **stats** ([hone-stats.html](../mocks/druz9-hone-bundle/hone-stats.html)) → `hone/src/renderer/src/pages/Stats.tsx`
- [ ] **taskboard** ([hone-taskboard.html](../mocks/druz9-hone-bundle/hone-taskboard.html)) → `hone/src/renderer/src/pages/TaskBoard.tsx`
- [ ] **welcome** ([web-welcome.html](../mocks/druz9-hone-bundle/web-welcome.html)) → `frontend/src/pages/WelcomePage.tsx`
- [ ] **notes** ([notes.html](../mocks/druz9-hone-bundle/notes.html)) → `hone/src/renderer/src/pages/Notes.tsx`
- [ ] **settings** ([settings.html](../mocks/druz9-hone-bundle/settings.html)) → `hone/src/renderer/src/pages/Settings.tsx`
- [ ] **web-editor** ([web-editor.html](../mocks/druz9-hone-bundle/web-editor.html)) → `frontend/src/pages/EditorRoomSharePage.tsx`
- [ ] **tutor** ([tutor.html](../mocks/druz9-hone-bundle/tutor.html)) → `frontend/src/pages/{TutorDashboardPage,TutorStudentPage}.tsx`
- [ ] **onboarding** ([onboarding.html](../mocks/druz9-hone-bundle/onboarding.html)) → `hone/src/renderer/src/components/OnboardingModal.tsx`
- [ ] **english-hub** ([english-hub.html](../mocks/druz9-hone-bundle/english-hub.html)) → `hone/src/renderer/src/pages/{EnglishOverview,Reading,Writing,Listening}.tsx`
- [ ] **events** ([events.html](../mocks/druz9-hone-bundle/events.html)) → новая страница (events не было) или `frontend/src/pages/clubs/`
- [ ] **podcasts** ([podcasts.html](../mocks/druz9-hone-bundle/podcasts.html)) → `frontend/src/pages/PodcastsPage.tsx`
- [ ] **logo-lab** ([hone-logo-lab.html](../mocks/druz9-hone-bundle/hone-logo-lab.html)) — design exploration, не ship surface

### Cleanup rule (применять в каждой UI-phase)

При apply mockup на real page — **обязательно выполнить и cleanup**:
- Backend handler/usecase/repo method для removed feature → delete
- Connect-RPC port (если был) → drop method, regenerate proto
- Migration cleanup (если data not needed) → отдельной миграцией с DROP TABLE / column
- Mock handlers в `frontend/src/mocks/handlers/` → drop соответствующие
- Tests на removed handlers → drop

### Output

`docs/feature/bundle-deltas.md` со структурой:

```markdown
## coach (learning-companion.html)
### Added
- AI-cursor для proactive suggestions (новый ai_cursor_state RPC)
- Mode switcher explore/commit/deep (нужен learning_state · уже в Phase 1)

### Removed
- Старый daily-brief feed-list → удалить `GetRecentBriefs` метод и handler
- ...

### Schema implications
- ...

### Phase impact
- Phase 2 (Coach upgrade) — гл deliverable
- Phase 12.5 (Admin) — добавить ai_cursor toggle
```

**Размер:** S (1-2 дня).
**Блокирует:** Phase 2, 4, 5, 6, 7, 8, 9, 10, 12.

---

## Phase 2 — Hone /coach upgrade (3-4 дня)

**Источник:** [bundle/learning-companion.html](../mocks/druz9-hone-bundle/learning-companion.html) → React production.

**Что делаем:**
- Apply mockup в [Coach.tsx](../../hone/src/renderer/src/pages/Coach.tsx) — interactive companion заменяет read-only feed
- Mode switcher (explore/commit/deep) wired в `hone_user_settings`
- Hero «one daily action» — backend `TaskAssistantNextAction` LLM task
- Fork view (explore-only) — read из `learning_state` + UI buttons
- AI-cursor pattern (из bundle taskboard) для proactive suggestions
- Stagger + animations 1:1 с mockup

**Step UX layout (2026-05-04 update):** CTA «start step» из coach открывает новый step layout — Resources → Reflection → Checkpoint → Optional graduation mock. Backend wires:
- `track_steps.checkpoint_skill_keys` → mock_pool subset (5 questions, не full mock)
- `step_checkpoint_attempts` upsert через `TaskCheckpointGrade`
- `track_steps.graduation_mock_section` — если non-null, optional CTA «full graduation mock» через existing AI-mock с rubric (DE / ML_eng / Algorithms / etc.)

**Backend:**
- `TaskAssistantNextAction` в `llmchain/task_map.go`
- `TaskCheckpointGrade` для 5-question grading
- `services/intelligence/app/next_action.go` — UC
- `services/tracks/app/checkpoint_*.go` — UCs (StartCheckpoint / SubmitCheckpoint), читают `step_checkpoint_attempts`

**Размер:** M.
**Зависит:** Phase 1, Phase 1.7 (TaskCheckpointGrade).

---

## Phase 3 — Atlas customization UI (3 дня)

**Что делаем:**
- `/atlas` «+ свой узел» modal с classify-LLM integration (`TaskAtlasClassify` уже есть)
- TrackDetail отображает user-owned nodes наряду с curated
- Pin/hide actions per-card на ribbon
- Hone read-only consumption — already supported via merged `GetAtlas`

**Источник:** не было mockup — design в процессе работы.

**Размер:** S-M.
**Зависит:** Phase 1.

---

## Phase 3.5 — Personal resource library + adaptive AI (5-7 дней)

**Offline coverage (Sergey 2026-05-04 «Hone должен работать в самолёте»):**
- New outbox op-kinds в [hone/src/renderer/src/offline/outbox.ts](../../hone/src/renderer/src/offline/outbox.ts):
  - `resource.add` (payload: `{target, resource}`) — URL fetch defer'ится: offline path skip'ает `previewResource` и переходит сразу к manual fields. Backend re-fetch'нет на drain (можно extend в follow-up).
  - `resource.hide` / `resource.unhelpful` / `resource.replace`
- Backend OverrideRepo.Insert уже idempotent (ON CONFLICT DO NOTHING + partial UNIQUE indexes) — replay safe; Idempotency-Key header гарантия на HTTP layer.
- UI: [ResourceCard](../../hone/src/renderer/src/components/ResourceCard.tsx) + [AddResourceModal](../../hone/src/renderer/src/components/AddResourceModal.tsx) optimistic — show «added/hidden» сразу, sync позже.


**Зачем:** user должен мочь add свои ресурсы / hide curated / mark unhelpful / replace. AI сам читает URL контент (best-effort fetch); при fail — fallback на user free-text. После pomodoro собирает 3-5 takeaways (не 1-line). Auto-promotes URL в curated если 5+ users добавили + avg `reflection_quality ≥ 0.7`.

**Decision (Sergey 2026-05-04):** NO admin approval. Auto-promote решает algorithm + LLM validation + `domain_reputation`. Sergey notification post-hoc.

### 3.5a · Schema migrations (DB v65)

```sql
CREATE TYPE user_override_action AS ENUM ('added','hidden','replaced','reordered','unhelpful');

CREATE TABLE user_resource_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  atlas_node_id   TEXT REFERENCES atlas_nodes(id) ON DELETE CASCADE,
  step_id         UUID REFERENCES track_steps(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  action          user_override_action NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  -- 'added': full Resource shape
  -- 'replaced': {original_url, reason}
  -- 'unhelpful': {reason}
  -- 'reordered': {prev_index, next_index}
  auto_promoted_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (atlas_node_id IS NOT NULL OR step_id IS NOT NULL),
  UNIQUE(user_id, atlas_node_id, step_id, url, action)
);
CREATE INDEX user_resource_overrides_lookup
  ON user_resource_overrides(user_id, atlas_node_id, step_id);

-- extend user_resource_log (created in Phase 1.7)
ALTER TABLE user_resource_log
  ADD COLUMN reflection_takeaways    JSONB     DEFAULT '[]',  -- string array
  ADD COLUMN reflection_quality_score REAL,                   -- 0..1 from TaskReflectionGrade
  ADD COLUMN extracted_topics        TEXT[]    DEFAULT '{}',  -- atlas-node ids
  ADD COLUMN confusion_flag          BOOLEAN   NOT NULL DEFAULT FALSE;

-- promotion tracking
CREATE TABLE resource_promotion_signals (
  url                 TEXT PRIMARY KEY,
  atlas_node_id       TEXT NOT NULL REFERENCES atlas_nodes(id),
  user_count          INT  NOT NULL DEFAULT 0,
  avg_quality         REAL,
  last_user_added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  promoted_at         TIMESTAMPTZ,
  blocked_reason      TEXT
);

-- spam protection
CREATE TABLE domain_reputation (
  domain           TEXT PRIMARY KEY,
  reports_count    INT  NOT NULL DEFAULT 0,
  unhelpful_count  INT  NOT NULL DEFAULT 0,
  blocked          BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3.5b · Backend code

**Files:**
- [services/curation/fetcher.go](../../backend/services/curation/fetcher.go) — ~150 LOC. Best-effort URL→text:
  - HTML: `github.com/go-shiori/go-readability`
  - YouTube: timedtext API (no auth)
  - PDF: `github.com/ledongthuc/pdf` (first 5 pages)
  - GitHub: README.md raw URL
  - Fallback: `<title>` + meta-description + first 500 chars
  - Total timeout 5s; graceful empty on fail.
- [services/curation/app/overrides.go](../../backend/services/curation/app/overrides.go):
  - UC `AddResource(user, target, url, optional_meta)` → fetcher → `TaskExtractResourceContent` → preview struct → user confirms → INSERT `user_resource_overrides` + UPSERT `resource_promotion_signals`.
  - UC `HideResource`, `MarkUnhelpful`, `ReplaceResource`, `ReorderResource`.
  - UC `ApplyOverrides(user, target, base_resources[])` → merged list per user.
- [services/curation/ports/server.go](../../backend/services/curation/ports/server.go) — Connect-RPC handlers.

### 3.5c · 3 новых LLM tasks (Phase 1.7 extension: 10 → 13)

| Task | Cache | JSON | Provider |
|---|---|---|---|
| `TaskExtractResourceContent` | ✅ per URL hash, 7d | yes | groq → mistral |
| `TaskReflectionGrade` | ❌ user-context | yes | cerebras (fast) |
| `TaskValidateResource` | ✅ per URL daily | yes | groq |

**Prompts** в `backend/shared/pkg/llmchain/prompts/`:
- `task_extract_resource.tmpl` — input `{url, extracted_text}` → output Resource shape (см §Schema implication выше).
- `task_reflection_grade.tmpl` — input `{takeaways[], resource.topics_covered}` → output `{quality_score, extracted_topics, confusion_flag}`.
- `task_validate_resource.tmpl` — input `{url, atlas_node_desc}` → output `{alive, reputable, on_topic, score}`.

### 3.5d · 5 новых producers в intelligence (Phase 1.7 extension: 2 → 7)

[services/intelligence/app/producers/](../../backend/services/intelligence/app/producers/):

| Producer | Cadence | Что делает |
|---|---|---|
| `coverage_confirmation.go` | daily | atlas-node mark `confirmed-mastered` если есть resource finished + `reflection_quality ≥ 0.7` |
| `gap_detection.go` | daily | Prereq atlas-nodes без confirmed coverage → emit insight «before next step, close gap» |
| `redundancy_signal.go` | weekly | ≥3 finished resources с same `topics_covered` + quality ≥ 0.85 → «well-covered, can move on» |
| `confusion_pickup.go` | daily | Reflections с `confusion_flag=true` → AI-tutor ping |
| `auto_promote.go` | daily cron | См алгоритм ниже |

**Auto-promote algorithm** (`auto_promote.go`):

```
SELECT * FROM resource_promotion_signals
  WHERE user_count ≥ 5 AND avg_quality ≥ 0.7 AND promoted_at IS NULL
FOR EACH:
  TaskValidateResource(url, atlas_node)
  IF score ≥ 0.7
     AND domain NOT IN domain_reputation WHERE blocked
     AND now() - last_user_added_at > 24h:
    INSERT INTO atlas_nodes.external_resources
      (priority='supplement', auto_promoted=true)
    UPDATE resource_promotion_signals SET promoted_at = now()
    Notify Sergey via admin channel (post-hoc)
```

### 3.5e · Frontend (extension Phase 5)

UI deliverables живут в Phase 5 (см расширенный scope ниже). Backend Phase 3.5 должен быть готов **до** Phase 5 frontend — иначе reflection multi-takeaway / add-resource modal / per-resource overrides будут висеть на mock'ах.

**Размер:** L (5-7 дней).
**Зависит:** Phase 1 (curation seed) + Phase 1.7 (llmchain tasks).
**Блокирует:** Phase 5 (frontend overrides UI).

---

## Phase 4 — External activity UI в Hone Stats (2 дня)

**Что делаем:**
- Apply [bundle/hone-stats.html](../mocks/druz9-hone-bundle/hone-stats.html) на [Stats.tsx](../../hone/src/renderer/src/pages/Stats.tsx)
- «+ log session» modal — structured form (source/topic/minutes), без чата
- Intelligence reads `external_activity` для daily-brief

**Размер:** S-M.
**Зависит:** ничего критичного.

---

## Phase 5 — Notes + AI-link UI (4-5 дней)

**Источник:** [bundle/notes.html](../mocks/druz9-hone-bundle/notes.html) → React production.

**Что делаем:**
- Sidebar: tree + flat + filter chips (date/tag/folder)
- Connections panel переработать — AI-suggested секция с per-edge `reason` (1 sentence)
- Backend `TaskNotesLinkSuggest` — embed-based candidate retrieval + LLM rerank
- AI-cursor pattern (опционально): cursor подходит к note title, ai-pulse, ai-label «linking X → Y»
- AI-log toast (нижний) при появлении suggestions

**Offline coverage (Sergey 2026-05-04):**
- New outbox op-kind `reflection.submit` (payload: `{userResourceLogId, takeaways[], confusionText, expectedTopics, allowedAtlasNodeIds}`)
- Local fallback grade — `naiveLocalQuality()` mirrors backend `naiveQuality()` (same 0.15 × len + length-bonus formula); UI shows grade сразу, server `TaskReflectionGrade` overwrite'нет через UPDATE `user_resource_log` (idempotent — scalar overwrite, не accumulator)
- AI-mock CTA / AI-tutor chat / Coach hero `start mock` — online-only с graceful tooltip «requires online» (Phase 11 polish)
- Coach `GetNextAction` — cached response с TTL 24h (chip «from yesterday · refresh when online», TODO в Phase 2 follow-up)

### 5a · Multi-takeaway reflection modal (Phase 3.5 frontend)

Replace 1-line «1 sentence — главное?» на multi-field modal:

```
focus block done · 25 min
{resource.title}

What did you learn? (3-5 key points · helps AI tune your plan)
1. (required)  ___________________________
2. (optional)  ___________________________
3. (optional)  ___________________________
[ + add another ]                        (up to 5)

Optional: anything confused you?  ___________

[ skip ] [ save · ⌘⏎ ]
```

UX:
- Field 1 required, 2-5 optional
- Auto-Tab между полями
- Voice input (Web Speech API на macOS) — mic-icon справа от каждого field'а
- lowercase microcopy (см bundle examples)
- B/W only — NO red в bg/fill (#FF3B30 = точка-индикатор/1.5px stripe only)

Submit flow:
- POST `/api/v1/curation/reflection`:
  ```json
  {
    "user_resource_log_id": "...",
    "takeaways": ["...", "...", "..."],
    "confusion_text": "..."
  }
  ```
- Backend → `TaskReflectionGrade` → save `reflection_takeaways`/`reflection_quality_score`/`extracted_topics`/`confusion_flag` в `user_resource_log`
- Auto-creates Note(s) auto-linked на atlas-nodes из `extracted_topics`
- `ai_tutor_facts` upsert per extracted topic (confidence based on `quality_score` + takeaway count)

### 5b · Add-resource modal (Phase 3.5 frontend)

В step UI / atlas-node detail добавь «+ add resource» button. Click → modal:

```
add resource:
URL: [______________________________]    [paste from clipboard]
  ↓ ai прочитал статью (skeleton 1-2s)
title:    "{auto-filled}"                    [edit]
topics:   ✓ {auto-filled tags}              [+ add topic]
summary:  "{auto-filled 2-3 sentences}"      [edit]
depth:    {auto-detected ▼}                  [change]
minutes:  ~{auto-estimated}                  [edit]
why это полезно: ___________________________  [optional]

[ add resource · ⌘⏎ ]   [ cancel ]
```

Backend flow:
1. POST URL → `services/curation/fetcher.Fetch(url)` (5s timeout)
2. Fetch ok → `TaskExtractResourceContent(url, fetched_text)` → preview Resource shape
3. Fetch fail → preview с empty topics; user fills manually (autocomplete по atlas-nodes)
4. User confirms → `services/curation.AddResource(user, target, full_resource)` → INSERT `user_resource_overrides` + UPSERT `resource_promotion_signals`

### 5c · Per-resource hover actions (Phase 3.5 frontend)

На каждом curated resource card hover-menu:
- **`hide for me`** → `user_resource_overrides` `action='hidden'`
- **`mark unhelpful`** → modal с optional reason → `action='unhelpful'` + bumps `domain_reputation.unhelpful_count`
- **`replace with own →`** → opens add-resource modal с `original_url` passed

### 5d · Resource list rendering — apply overrides

В step UI / atlas-node — рендеринг через `services/curation.ApplyOverrides`:
- Hidden ресурсы — не показываются
- Replaced — показывают user's версию вместо original
- Reordered — user's order
- Added — новая «your resources» секция под curated

### 5e · Reflection auto-link flow (Phase 5 native part)

- Reflection submission создаёт Note автоматически: title = «reflection · <step.title>» / «reflection · <YYYY-MM-DD HH:MM>», body = takeaways joined + confusion
- `TaskReflectionExtract` (Phase 1.7) — atlas_node mentions из takeaways
- `user_resource_log` (00055): `reflection_text` + `reflection_note_id` FK + новые поля Phase 3.5 (см §3.5a ALTER TABLE)

**Размер:** M-L (5d native + 3 days frontend overlay для 5a-c).
**Зависит:** Phase 1.7 (TaskReflectionExtract + TaskNotesLinkSuggest + TaskReflectionGrade + TaskExtractResourceContent), Phase 3.5 backend (curation overrides API + fetcher).
**Зависит:** Phase 0 (LLM task budget).
**Блокировка:** Phase 5 frontend (5a-c) **не стартует** пока Phase 3.5 backend не готов — иначе UI висит на mocks.

---

## Phase 6 — Onboarding modal v2 (2-3 дня)

**Источник:** [bundle/onboarding.html](../mocks/druz9-hone-bundle/onboarding.html) → React production.

**Что делаем:**
- 3-step wizard с visual progress (dots)
- Step 1: stack (Go/ML/English/Other)
- Step 2: mode (Explore/Commit/Deep)
- Step 3: interactive hotkey tour с overlay-highlights над реальной панелью
- Recovery: «Open onboarding again» в Settings

**Backend:**
- `hone_user_settings.onboarding_version int` — bump при выходе wizard

**Размер:** S-M.

---

## Phase 7 — Settings + vault wizard (3-4 дня)

**Источник:** [bundle/settings.html](../mocks/druz9-hone-bundle/settings.html) → React production.

**Что делаем:**
- Two-pane layout (sidebar + content) вместо stacked
- Vault setup как modal wizard, не inline
- Settings search input в header (filter sections)
- Storage / tier upgrade — elevated card-callout
- Все сессии в одном месте: account / privacy / system
- **Recovery section** — «Open onboarding again» button (стирает `hone:onboarded:v2` + reload). ✅ done в этой сессии.

### 7a · Developer tools section (Path C low-key, Sergey 2026-05-04)

Collapsed-by-default «▼ developer tools» section (tooltip «power user feature» на header):

```
▼ developer tools  [optional · advanced section]

Collaboration rooms
──────
Active: {N} of {limit}      ← free tier counter

[+ create code room]    → POST /api/v1/rooms (kind=code) → redirect /editor/room/{id}
[+ create whiteboard]   → POST /api/v1/rooms (kind=whiteboard) → redirect /whiteboard/room/{id}

Active rooms list (with «open» / «share link» / «extend» / «delete»)
Past rooms (last 30 days, «restore» button если в TTL)

Free tier: 3 active · 24h TTL · 3 ppl max
[→ upgrade to pro for unlimited + AI features]
```

Используется как **единственный manual entry-point** для standalone rooms (Path C low-key — НЕ top-level nav, НЕ palette entry, НЕ promo).

Discovery rooms через:
- Tutor session card в Hone TaskBoard
- AI-mock auto-allocate room
- Club session card
- **Settings → Developer tools (manual create)** ← этот раздел
- Direct share-link

**Размер:** M (+1 day на Tools section).

---

## Phase 8 — Tutor pages upgrade (5-6 дней)

**Источник:** [bundle/tutor.html](../mocks/druz9-hone-bundle/tutor.html) → React production.

**Что делаем:**
- Tutor dashboard: sparklines на activity cards, accordion event form, student search (не UUID)
- Tutor student page: weak spots с node title + why weak (e.g., «3 of 10 attempts < 40»), markdown brief rendering, PDF export, share link
- Pre-session brief markdown — мини-renderer (lines / lists / code), без full library

**Backend:**
- PDF export endpoint (через wkhtmltopdf или server-side React render)
- `tutor_brief_share_links` table для share-flow

**Размер:** L.
**Зависит:** Phase 1 для DE-mocks integration.

---

## Phase 9 — Web Editor cursor labels (3-4 дня)

**Источник:** [bundle/web-editor.html](../mocks/druz9-hone-bundle/web-editor.html) → React production.

**Что делаем:**
- Cursor labels (Figma-style: «Alice on line 42») via Yjs awareness state — payload уже есть, нужен render
- Guest prompt → side panel вместо fullscreen gate
- Output panel restructure: collapsible, syntax-coloured stack traces, clickable line numbers
- Participant activity timeline (last edit ts)

### 9a · Standalone rooms backend (Path C low-key, Sergey 2026-05-04)

Существующие rooms (`editor_rooms` / `whiteboard_rooms`) расширяем для standalone-create через Settings → Developer tools (см §7a). Free-tier guarded.

**Migration v66 (`00066_collab_rooms_meta.sql`):**

```sql
ALTER TABLE editor_rooms     ADD COLUMN ttl_at TIMESTAMPTZ, ADD COLUMN free_tier BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE whiteboard_rooms ADD COLUMN ttl_at TIMESTAMPTZ, ADD COLUMN free_tier BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE user_room_quota (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_count  INT  NOT NULL DEFAULT 0,
  tier          TEXT NOT NULL DEFAULT 'free',
  period_start  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**New service `services/rooms/`** (или extend whiteboard_rooms / editor):

UCs:
- `CreateRoom(user, kind, ttl)` — checks `user_room_quota.active_count` против free-tier cap (3) → INSERT room с ttl_at → INCREMENT counter → returns `{room_id, share_url}`
- `ListMyRooms(user, status: active|past)` — split on ttl_at vs now()
- `ExtendRoom(user, room_id, hours)` — pro-only (tier check)
- `RestoreRoom(user, room_id)` — undelete если в 30d window

**Daily cron** (TTL daemon в `services/admin/cleanup_crons.go`):
- archives expired rooms (soft-delete = sets `archived_at`, sохраняет 30d restorable)
- decrements `user_room_quota.active_count`

**RPC `RoomService`** в новом `proto/druz9/v1/rooms.proto`:
- `CreateRoom` / `ListMyRooms` / `ExtendRoom` / `RestoreRoom` / `DeleteRoom`
- REST aliases `/api/v1/rooms/*`

**Free-tier limits:**
- 3 active · 24h TTL · 3 ppl max
- Pro: unlimited + AI features (transcription / code-review on rooms)

**Что НЕ делаем (per Path C low-key):**
- ❌ /rooms hub page как top-level surface
- ❌ Nav-menu entry «Rooms»
- ❌ Cmd+K palette entry
- ❌ Landing page promo
- ❌ Hone palette entry

Discovery — только через tutor card / mock auto-allocate / club / Settings → Developer tools / direct share-link.

**Risk:** power-users могут создавать spam-rooms. Mitigation — free-tier counter (3 cap) + 24h TTL + `domain_reputation` (если share-link domain spam, см [project_curation_model.md](memory/project_curation_model.md) auto-promote spam protection).

**Размер:** M (+2 days на rooms service + RPC + cron).

---

## Phase 10 — TaskBoard ship + AI auto-categorise (3 дня)

**Источник:** [bundle/hone-taskboard.html](../mocks/druz9-hone-bundle/hone-taskboard.html).

**Что делаем:**
- Apply mockup (Notion-style kanban с tutor-rail)
- AI auto-place новых tasks по deadline + kind через `TaskTaskboardCategorise`
- AI-cursor visible когда AI moves task between columns
- Optimistic updates + outbox для offline

**Размер:** M.
**Зависит:** Phase 1, 5 (для shared AI-cursor patterns).

---

## Phase 11 — Polish remaining pages (2-3 дня)

**Что делаем:**
- Stagger entry на: `/atlas/explore` (graph), `/mock` setup wizard, `/goals`, `/insights`
- Shimmer migration (animation defined в tailwind config 68-74, не используется)
- Page transitions через View Transitions API на Hone navigation
- Skeleton dimensions match final cards (нет layout shift)

### 11b · Offline UI states (Sergey 2026-05-04 — «Hone в самолёте»)

- Disabled state с tooltip `requires online` на:
  - AI-mock CTA (Coach hero «start mock», step graduation chip)
  - AI-tutor chat (open conversation)
- Add-resource modal: graceful (manual metadata fallback на offline, не disabled — см [AddResourceModal.tsx](../../hone/src/renderer/src/components/AddResourceModal.tsx) `doPreview` offline branch)
- Checkpoint quiz: pre-cache 5 questions при step open (IndexedDB), local grade для multiple-choice; server `TaskCheckpointGrade` re-grade open-ended ответы при reconnect
- Offline banner extended: outbox count + last-sync timestamp + per-op retry button для dead ops (читает [outbox.ts](../../hone/src/renderer/src/offline/outbox.ts) `listAll()`)

**Default rule** (Sergey 2026-05-04): любая новая write-action → outbox-able (если client-initiated и идемпотентна). Read-only AI → cache-friendly. Heavy LLM (mock / fork-analysis / next-action) → online-only с graceful state.

### 11a · Hone palette cleanup — native-only (Sergey 2026-05-04)

Hone palette должен содержать ТОЛЬКО Hone-native pages. NO web deeplinks в palette.

**Final shape (7 items):**

| Action | Shortcut |
|---|---|
| Today | T |
| Coach | C |
| Stats | S |
| Notes | N |
| TaskBoard | B |
| English (opens Hub с tabs) | E |
| Settings | , |

**Remove из palette** (text + shortcut + handler):
- Tutor — assignments + sessions (был A·M)
- Boards · Code rooms (был D·B·E) — Boards rename'нуть в «TaskBoard»; Code rooms убрать (web-only)
- Group events (circles) (был V)
- Podcasts (был P)
- Stats dashboard (был G·S) — duplicate со Stats

**Web pages по-прежнему доступны через контекстные deeplinks:**
- Coach hero «start mock» button → web `/mock`
- Today AI-plan step CTA «practice» → external URL
- Step UI «graduation» → web `/mock` с pre-set section
- TaskBoard tutor-assignment card → web `/tutor/student/{id}`
- Notes resource-link → external URL
- Atlas chip на Today → web `/atlas/track/{slug}`

Эти deeplinks остаются — это правильное место для перехода на web.

**Cleanup при apply** (per `project_hone` «Hone consumes, Web produces»):
- Удалить routes из Hone router которые соответствуют web-only фичам (если были — Tutor / Podcasts / Events / Codex)
- Удалить mock handlers для этих routes
- Удалить connect-rpc wrappers если были обёртки для Hone-side rendering web-pages

**Why:** Hone = focus cockpit. Каждая web-ссылка в palette = context-switch соблазн. Контекстные deeplinks остаются на конкретных pages — это логичные moments, не «random navigation».

**Размер:** 0.5 day · low-risk.

**Размер total Phase 11:** S-M.

---

## Phase 12 — Welcome ship (1-2 дня)

**Источник:** [bundle/web-welcome.html](../mocks/druz9-hone-bundle/web-welcome.html).

Apply на `/` (WelcomePage.tsx). Simple replacement.

**Размер:** XS.

---

## Phase 12.5 — Admin panel extensions (3-4 дня)

**Зачем:** новые фичи (curation, learning_state, atlas custom-nodes, onboarding versions, AI-cursor toggles) требуют admin-инструментов — proper UI, не runtime-config через `/admin/dynamic_config`. Plus: настройки самой админки (audit log, role-permissions).

### Новые admin-tabs

- **`/admin/curation`** — review queue для AI-сгенерённых external_resources, edit/approve/reject. Аналитика: clicked / skipped / marked-unhelpful per resource. Bulk-edit `why` strings
- **`/admin/atlas-custom`** — moderate `user_atlas_nodes` (мб spam/offensive). Analytics: top user-pinned topics за месяц, dedup-кандидаты на curated-promote
- **`/admin/mock-pools`** — DE/MLE/Go question pool editor. Add/remove вопросы, regenerate prompts через UI, test rubric on sample answers
- **`/admin/learning-state`** — distribution mode (explore/commit/deep) + fork_branch (de/mle) overview по всем юзерам, top-stuck users (в одном mode > N недель), force-set mode для конкретного user
- **`/admin/onboarding`** — onboarding version control: bump `hone_user_settings.onboarding_version` для всех / per-track / per-user. Triggers re-onboarding flow
- **`/admin/feature-flags`** — runtime toggles новых фичей (AI-cursor enable/disable per Hone surface, fork-analysis cron freq, persona override default)
- **`/admin/audit-log`** — кто что менял в admin (новая таблица 00053_admin_audit_log)
- **`/admin/rooms`** — Phase 9 standalone rooms moderation (Sergey 2026-05-04, Path C low-key):
  - list rooms by user / kind (code|whiteboard) / status (active|expired|archived)
  - abuse reports queue (если есть)
  - bulk-archive expired rooms (override TTL)
  - domain blocking для share-links (spam mitigation, использует `domain_reputation` из 00065)
  - Quick stats: per-user `user_room_quota` overview (top creators, free-tier breaches)

### Расширения существующих админ-страниц

- **IntelligenceObservabilityPanel** — добавить metrics: TaskAssistantNextAction latency p50/p95, fork-analysis confidence distribution, onboarding-completion rate, curation accept-rate
- **LLMChainPanel** — per-task cost breakdown (TaskCurateResource — сколько токенов на seed; TaskAssistantNextAction — daily volume)
- **CodexAdmin** — связка codex_articles ↔ atlas_nodes (FK + bulk-link tool)

### Backend

- chi-direct REST endpoints `/api/v1/admin/{curation,atlas-custom,mock-pools,learning-state,onboarding,feature-flags,audit-log}` с role-gate (admin role check)
- Migration `00053_admin_audit_log.sql` — table (id, admin_user_id, action, target_kind, target_id, payload jsonb, occurred_at). Logged via middleware на all admin-write endpoints
- `services/admin/app/audit.go` — audit-log writer

### Cleanup при apply

Если bundle-deltas покажет removed admin-фичи — удалить соответствующие endpoints + frontend pages + tests. Особо: проверить `IntelligenceObservabilityPanel` (4.5 redesign closed уже, мб что-то deprecate'нулось).

**Размер:** M (3-4 дня · backend chi-direct + frontend pages + role-gate sweep + audit middleware) + 0.5 day для `/admin/rooms` tab.
**Зависит:** Phase 1 (curation seeds для curation-tab), Phase 6 (onboarding для version-tab), Phase 1.5 (delta analysis для cleanup list), Phase 9 (rooms backend для `/admin/rooms`).

---

## Phase 13 — Сервер migration + deploy (1-2 дня · вручную)

**Что Sergey делает руками:**
- VPS 16GB / 8c / 80GB SSD (Ubuntu 22.04 LTS, cgroup v1)
- TLS через certbot
- Postgres dump + restore
- MinIO data sync
- Telegram bot webhook → новый домен
- DNS update

**Что Claude делает:**
- Update `infra/scripts/deploy.sh` для нового хоста
- Документация миграции в `docs/tech/migration-2026-05.md`

**Размер:** S (ручная часть для Sergey).

---

## Phase 14 — Ship + monitor (continuous)

- Включить feature flags для каждого phase в `dynamic_config`
- Smoke-test golden paths
- Grafana board для AI-task latency / cache hit rate
- Eval suite расширить (`make eval-coach`) на новые TaskAssistant* tasks

---

## Total estimate

~7-9 недель если 1 человек full-time (Phase 1.5 + 1.7 + 12.5). ~4-5 недель split frontend (Phase 2,5,6,7,8,9,10,11) + backend (Phase 1,1.7,3,4,12.5) parallel.

**Hard gates перед UI-phases:**
- **Phase 1.5** (bundle delta analysis) — без неё frontend поедет с фичами без backend
- **Phase 1.7** (AI readiness) — без неё implementation полу-сделает 8 LLM tasks, 2 personas, 3 readers, 2 producers

## Зависимости (DAG)

```
Phase 0 (decisions)
  └→ Phase 1 (backend foundation · curation seeds)
        ├→ Phase 1.5 (bundle delta analysis) ◄── HARD GATE 1
        └→ Phase 1.7 (AI readiness checklist · 13 LLM tasks) ◄── HARD GATE 2
              │
              └─ оба done → unblock UI-phases:
                    ├→ Phase 2 (Coach + step UX · TaskCheckpointGrade)
                    ├→ Phase 3 (Atlas custom)
                    │     └→ Phase 3.5 (Personal resource library + adaptive AI) ◄── BLOCKS Phase 5 frontend
                    │           · curation overrides API + fetcher
                    │           · 3 new LLM tasks (TaskExtractResourceContent / TaskReflectionGrade / TaskValidateResource)
                    │           · 5 new producers (coverage / gap / redundancy / confusion / auto_promote)
                    ├→ Phase 4 (Stats apply)
                    ├→ Phase 5 (Notes + reflection auto-link · нужен TaskReflectionExtract)
                    │     · 5a-c (multi-takeaway modal + add-resource modal + per-resource overrides)
                    │       требуют Phase 3.5 backend ready
                    ├→ Phase 6 (Onboarding)
                    ├→ Phase 7 (Settings)
                    ├→ Phase 8 (Tutor)
                    ├→ Phase 9 (Editor)
                    ├→ Phase 10 (TaskBoard)
                    └→ Phase 12 (Welcome)

Phase 11 (Polish)              ←── after most UI ship
Phase 12.5 (Admin extensions)  ←── after Phase 1, 1.5, 1.7, 6
Phase 13 (Server migrate)      ←── before final ship
Phase 14 (Monitor)             ←── continuous
```

**Phase 1.5 и 1.7 могут идти parallel** — independent друг от друга, но обе блокируют UI.

**Phase 3.5 — критический gate для Phase 5 5a-c.** Phase 5 native deliverables (notes UI + AI-suggested + reflection auto-link для 1-line case) могут стартовать без 3.5; multi-takeaway modal + add-resource modal + overrides UI требуют 3.5 backend ready (curation overrides API + fetcher + 3 новых LLM tasks).

## Что брать в новый чат cold-start

1. Этот файл (план)
2. [identity.md](identity.md) (current product identity)
3. [docs/mocks/druz9-hone-bundle/](../mocks/druz9-hone-bundle/) — **полный bundle Claude design** на 13 экранов (для Phase 1.5 анализ + всех UI-phases)
4. `docs/feature/bundle-deltas.md` — после Phase 1.5 (этот файл создаётся в нём)
5. [CLAUDE.md](../../CLAUDE.md) (orientation)
6. Memory файлы:
   - `project_state` · `project_hone` · `feedback_color_rule`
   - `project_learning_companion` · `project_curation_model`
   - `feedback_style` · `feedback_providers` · `project_llmchain`

В новом чате стартовать с:

> **«Открой [implementation-plan.md](docs/feature/implementation-plan.md) и [project_curation_model](memory/project_curation_model.md). Какая phase следующая по DAG (без блокировок)? Если Phase 1 завершена — старт с Phase 1.5 (bundle delta analysis), это hard gate перед UI-phases.»**

Claude должен прочитать DAG и выбрать первую невыполненную ноду без блокировок. **Перед любой UI-phase — проверить, что Phase 1.5 выполнена и `bundle-deltas.md` существует.**
