# Execution plan

Сводный roadmap по инициативам из [tracks.md](./tracks.md), [english.md](./english.md), [tutor.md](./tutor.md).

**Последнее обновление:** 2026-04-29

## Принципы планирования

1. **Один большой layer за раз.** Не пилим Senior-pack и English Hone-loop параллельно — context-switching убивает производительность одного разработчика.
2. **Wave 0 — foundation первой.** Multi-track Atlas нужен всем последующим инициативам.
3. **English-mock-round — самый быстрый user-visible win.** 2 недели работы → видимый трек на сайте.
4. **Tier 1 tutor-dashboard — open в распределение.** Без него English Hone-loop = пустой инструмент.
5. **Sysanalyst и Product analyst — НЕ делаем сами.** Найм эксперта обязателен.

## Wave 0 — Foundation (1 неделя, делаем СЕЙЧАС)

База, на которой строится всё остальное.

| # | Задача | Файлы / места | Эффорт | Статус |
|---|---|---|---|---|
| 0.1 | Migration `00006_user_persona_tracks.sql` — таблица `user_persona_tracks` (per-user list of active tracks). Имя `user_tracks` уже занято learning-track сервисом, переименовано чтоб не клэшить | `backend/migrations/` | 1 час | ✅ закрыто |
| 0.2 | Migration `00007_skill_atlas_tracks.sql` — добавить `track_kind` enum в `skill_nodes` | `backend/migrations/` | 1 час | ✅ закрыто (фолдено в `00001_baseline.sql` lines 2056-2127 — `track_kind` ENUM + `atlas_nodes.track_kind` column live) |
| 0.3 | Proto extension: `profile.proto` — `Track` enum, `SetUserTracks` RPC | `proto/druz9/v1/profile.proto` | 1 час | ✅ закрыто (`Track` enum + `GetUserTracks`/`SetUserTracks` RPCs в `profile.proto` lines 453-573) |
| 0.4 | Backend wiring `services/profile/` — handler + use case + repo | `backend/services/profile/` | 4 часа | ✅ закрыто (handler работает; см. использование в `Step0Tracks` onboarding и в `TracksTab` settings) |
| 0.5 | Onboarding-страница: track selector multi-select | `frontend/src/pages/onboarding/Step0Tracks.tsx` + route в App.tsx | 1 день | ✅ закрыто |
| 0.6 | Profile · Settings · Tracks tab — переключение треков после onboarding'а | `frontend/src/pages/settings/TracksTab.tsx` + nav в SettingsPage | 1 день | ✅ закрыто |

**Acceptance:**
- Юзер на onboarding'е выбирает 1+ треки. ✅ `/onboarding/tracks` готов
- В Profile видит свой список, может изменить. ✅ Settings · Треки tab готов
- `user_tracks` хранит срез, `skill_nodes` фильтруется по выбранным трекам.
- Старые юзеры (без записей в `user_tracks`) — auto-default `[dev_middle]`. ✅ backfill в миграции

**Wave 0 — ЗАКРЫТО ✅** (2026-04-30)
- Backend: миграции 00006/00007, proto + Track enum + Get/SetUserTracks RPC, domain/app/infra/ports + tests (24 unit), wiring через cmd/monolith
- Frontend: Step0Tracks (onboarding) + TracksTab (settings) + route в App.tsx
- Все green: `make gen-proto`, `make gen-mocks`, `go test -race`, `npm run typecheck`

## Wave 1 — English mock-round (2-3 недели)

Самый быстрый user-visible win. Расширение существующего mock-flow.

| # | Задача | Файлы | Эффорт | Статус |
|---|---|---|---|---|
| 1.1 | Proto: `Section.SECTION_ENGLISH_HR` (используем существующий enum, не плодим parallel taxonomy) + `IsEngineering()` метод | `proto/druz9/v1/common.proto` + `shared/enums/section.go` + `services/ai_mock/ports/server.go` | 1 час | ✅ закрыто |
| 1.2 | LLM-задача `TaskEnglishMockHR` в `llmchain` (Task + TaskModelMap entry для всех free-провайдеров) | `backend/shared/pkg/llmchain/` | 0.5 дня | ✅ закрыто (constant + mapping; prompt template — в 1.3) |
| 1.3 | Wiring в `services/ai_mock/app/` — `domain/english_hr.go` (prompt + report rubric clarity/accuracy/range/fluency), dispatcher в `BuildSystemPrompt`/`BuildReportPrompt`, branching в CreateSession/SendMessage/GetSession/Worker (TaskID = uuid.Nil для English HR), 13 unit-тестов | `backend/services/ai_mock/` | 2 дня | ✅ закрыто |
| 1.4 | English Atlas seed: 4 ветви × 4 sub-skills + edges (`00009_english_atlas_seed.sql`) | migration | 0.5 дня | ✅ закрыто |
| 1.5 | Frontend: MockSessionPage `EnglishHRPanel` (rubric pre-brief) + скрытие editor / stress card; MockResultPage rubric-switching по `session.section` | `frontend/src/pages/MockSessionPage.tsx`, `MockResultPage.tsx` | 1 день | ✅ закрыто |
| 1.6 | Insights: `EnglishHRTrend` proto + repo aggregator + use case branch + Connect-RPC mapping + frontend `EnglishHRTrendCard` со sparkline + 3 unit-теста | `proto/druz9/v1/ai_mock.proto`, `services/ai_mock/{domain,infra,app,ports}/`, `frontend/src/{lib/queries/mockInsights.ts,pages/InsightsPage.tsx}` | 1 день | ✅ закрыто |

**Wave 1 — ЗАКРЫТО ✅** (2026-04-30)
- 1.1 SECTION_ENGLISH_HR + IsEngineering()
- 1.2 TaskEnglishMockHR + TaskModelMap entries
- 1.3 BuildEnglishHR{System,Report}Prompt + dispatcher + branching в 4 use case'ах + 13 unit-тестов
- 1.4 00009_english_atlas_seed.sql (1 hub + 4 branches + 11 sub-skills + 14 edges)
- 1.5 MockSessionPage `EnglishHRPanel` + MockResultPage rubric-switching
- 1.6 EnglishHRTrend backend aggregator + Insights card со sparkline + 3 unit-теста

**Acceptance:**
- Юзер с активным English-треком видит «Mock English» в навигации.
- Может пройти HR-сессию на английском, AI оценивает и даёт rubric-фидбэк.
- Watermark `ai_assist` работает (как в обычном mock).
- Insights показывает English-trend отдельно от dev-trend.

## Wave 1.5 — Welcome page refresh + interactive demo (2 недели)

Делается **после** Wave 1, чтобы demo включал English mock как живую новинку.

### Контент-фикс

| # | Задача | Файлы | Эффорт |
|---|---|---|---|
| 1.5.1 | Удалить упоминания «сезоны / турниры» (legacy, после Phase-4 cleanup) | `frontend/src/pages/WelcomePage.tsx` | 1 час | ✅ |
| 1.5.2 | Добавить блок про Insights — главная аналитическая фича после Phase-4 | `WelcomePage.tsx` (Ritual + ProductRow bullets) | 0.5 дня | ✅ |
| 1.5.3 | Добавить блок про multi-track (Senior dev / English / switcher) | `WelcomePage.tsx` (ProductRow desc + bullets) | 0.5 дня | ✅ |
| 1.5.4 | Обновить pricing-секцию — текущая 990₽/мес, удалить устаревшие SKU | `WelcomePage.tsx` | 1 час | ✅ |
| 1.5.5 | Footer-обновление: ссылки на Insights, GitHub, переименование Arena → druz9.online | `WelcomePage.tsx` | 1 час | ✅ |

### Interactive demo (tight версия)

Паттерн Linear / Raycast / Arc — three device-frame с CSS-анимацией и click-expand.

| # | Задача | Эффорт |
|---|---|---|
| 1.5.6 | `<DemoFrame>` + `useDemoTimeline` + `<DemoModal>` + auto-pause off-screen via IntersectionObserver | `frontend/src/pages/welcome/demos.tsx` | 2 дня | ✅ |
| 1.5.7 | Demo · Hone — `HoneDemo` (Today multi-track plan → 25:00 pomodoro → AI insight 10s loop) | `welcome/demos.tsx` | 1 день | ✅ |
| 1.5.8 | Demo · Cue — `CueDemo` (IDE backdrop → ⌘⇧Space → streaming response 7s loop) | `welcome/demos.tsx` | 1 день | ✅ |
| 1.5.9 | Demo · English Mock — `EnglishMockDemo` (HR question → typewriter answer → rubric reveal 11s loop) | `welcome/demos.tsx` | 1 день | ✅ |
| 1.5.10 | Hover-pause + click-expand modal (Esc to close, scroll-lock) | wired в `WelcomePage.tsx` через `expanded` state | 0.5 дня | ✅ |

**Wave 1.5 — ЗАКРЫТО ✅** (2026-04-30)
- 5 контентных правок (price 790→990, удалены сезоны/турниры, ритуал переписан под Phase-4)
- Удалён старый `ArenaMock`/`HoneMock`/`CueMock` block из WelcomePage (192 строки)
- Новый модуль `welcome/demos.tsx` с тремя анимированными демо + click-expand modal
- Auto-pause off-screen через IntersectionObserver — не жгём setTimeout'ы пока юзер читает FAQ

**Стек:** обычный React + CSS keyframes + tiny state-machine для timing. Никаких видео-файлов, никакого Lottie. Размер бандла +<10KB.

**Acceptance:**
- Лендинг загружается за <1.5s, demo'и стартуют автоматически.
- Hover на любую mock-frame — pause анимации (для recording / slow-look).
- Click → modal с увеличенным mock'ом. Esc закрывает.
- Все три demo'и показывают **реальные** фичи (English mock, Cue stealth, Hone focus), не выдуманные.

### Cinematic версия (опционально, +2-3 нед)

Если tight зайдёт — расширяем до click-through мини-версий: 3-5 экранов навигации в каждом demo, можно «потыкать» как в реальном Hone. Парковка после tight-релиза + сбора feedback.

## Wave 2 — Tutor MVP (Tier 1 + 4) — 4-5 недель

Параллельно: Tier 1 (dashboard, ты) + Tier 4 (TG-bot, ты позже).

**Pre-condition:** 5+ design-partner тутров согласны (см [tutor.md §Pre-condition](./tutor.md#pre-condition-design-partners)). Без этого — паркуем.

### Tier 1 — Tutor dashboard (3 недели)

| # | Задача | Эффорт | Статус |
|---|---|---|---|
| 2.1 | `services/tutor/` skeleton — domain (Invite/Relationship + Status/IsActive helpers), repo interface, hand-rolled pgx infra (CreateInvite/Get/List/Revoke + transactional AcceptInvite + List/EndRelationship), 7 use cases с base32-ish code generator, Connect-RPC server | 1 день | ✅ закрыто |
| 2.2 | Migration `00012_tutor_relationships.sql` — `tutor_invites` + `tutor_students`, partial unique idx на active-invite-by-code и active-relationship-by-(tutor,student), self-link CHECK, ON DELETE CASCADE | 0.5 дня | ✅ закрыто |
| 2.3 | Proto `tutor.proto` — 7 RPCs (CreateInvite/RevokeInvite/ListInvites/PeekInvite/AcceptInvite/ListStudents/EndRelationship). Все request/response — Tutor-prefixed чтобы не клэшить с editor.proto.CreateInviteRequest | 0.5 дня | ✅ закрыто |
| 2.4a | Invite + list flow end-to-end (без snapshot aggregator) | 0.5 дня | ✅ закрыто |
| 2.4b | `domain.StudentSnapshot` + `WeakSpot` + `SnapshotRepo` interface; infra: 4 SQL aggregations (focus / mock / atlas weak-spots / notes count); use case с auth-gate (`EnsureRelationship` ДО fetch); proto `TutorStudentSnapshot` + `GetStudentSnapshot` RPC; tests с hand-rolled fake | 2.5 дня | ✅ закрыто |
| 2.5 | `TaskTutorPreSessionBrief` (Task constant + free-tier model map); `app.GeneratePreSessionBrief` use case с `PreSessionBriefer` closure-interface; **wirer `cmd/monolith/services/tutor/briefer.go`** — Russian markdown ≤250 слов, prompt с anti-hallucination guards (numbers-only, no PII), graceful degradation (chain nil / chain failure → empty brief, snapshot-only fallback) | 0.5 дня | ✅ закрыто end-to-end |
| 2.6 | Frontend: tutor dashboard `/tutor` — list invites + students + heatmap + per-student page | 4 дня | ✅ закрыто (MVP) — `pages/TutorDashboardPage.tsx` (Invites pane: создание/list/copy-link/revoke; Students pane: list/end-relationship); `pages/TutorStudentPage.tsx` (Snapshot tab с focus min / mocks / weak-spots progress bars + Brief tab — LLM markdown narrative с Refresh, lazy fetch — не дёргаем без явного клика); `lib/queries/tutor.ts` расширен 6 hooks (CreateInvite/ListInvites/RevokeInvite/ListStudents/EndRelationship/Snapshot/Brief); routes `/tutor` + `/tutor/students/:id` wired в App.tsx |
| 2.7 | `InviteAcceptPage` (`/invite/:code`) — public PeekInvite-driven landing, status-aware CTA (login → accept), redirect to `/onboarding/tracks?source=invite` после accept. `useTutorPeekInviteQuery` + `useAcceptInviteMutation` в `lib/queries/tutor.ts` | 1 день | ✅ закрыто |
| 2.4c | `TutorStudentSnapshot` extension — surfaces Hone English activity (Wave 4 + 6.1) на тутор-дашборде: reading sessions/minutes (windowed), reading library total, writing-grades proxy (sessions с `ai_summary_score`), listening library total, vocab queue total + due-today (point-in-time). Каждый блок fail-soft — отдельный QueryRow без partial-rollback'а. Frontend `TutorStudentPage` рендерит новый «English-track activity» card в Snapshot tab; пустое состояние fold'ится в одну строку | 0.5 дня | ✅ закрыто |
| 5.1e | Hone HomePage `TutorAssignmentsBanner` — most-urgent pending assignment from tutor surfaces в bottom-left на Home (skipped while focus running). Sort overdue → due_soon → open + earliest due_at; one-click ✓ DONE + «OPEN · +N more» link to /assignments page. 60s poll + window-focus refresh. Closes Wave 5.1 loop — student теперь видит tutor pushes в day-1 surface, не нужно навигировать | 0.25 дня | ✅ закрыто |

**Wave 2.1–2.4a — ЗАКРЫТО ✅** (foundation):
- Backend layer: domain entities + transactional invite-accept (FOR UPDATE на `tutor_invites` → INSERT в `tutor_students` с partial unique idx)
- 7 RPC endpoints (1 public — PeekInvite — для landing'а до auth)
- 7 use case'ов: CreateInvite / RevokeInvite / ListInvites / PeekInvite / AcceptInvite / ListStudents / EndRelationship
- Code generator: base32-без-неоднозначных (no 0/O/1/I/L) — readable от руки
- Domain unit-тесты (Status state-machine + IsActive)
- TutorDisplayLookup как closure: handler не импортирует profile, wiring (`cmd/monolith`) подключит читателя display_name когда понадобится
- Wave 2.4b/2.5/2.6/2.7 — следующий sprint после design-partner интервью

### Tier 4 — TG-bot tutor (2 недели, параллельно)

| # | Задача | Эффорт |
|---|---|---|
| 2.8 | `services/tg_coach/` extend: `/students`, `/today`, `/prepare @user`, `/assign`, `/checkin` commands | 2 недели |

**Acceptance:**
- Тутор регистрируется как тутор (отдельный role на signup OR self-promote из profile).
- Получает invite-ссылку, шлёт студентам.
- Видит dashboard с per-student heatmap.
- Получает pre-session brief в TG за час до занятия.

## Wave 3 — Senior dev pack (6 недель)

Делаешь сам. Без экспертов.

| # | Задача | Эффорт | Статус |
|---|---|---|---|
| 3.1 | System Design pack: 5 sub-skill узлов (distributed / real-time / ML / security / observability) + branch hub | 1 нед | ✅ migration `00011_senior_atlas_seed.sql` |
| 3.2 | `Section.SECTION_SYSTEM_DESIGN_SENIOR` + `Section.IsTaskBased()` (replaces `IsEngineering` гейт у task-pick) + `TaskSystemDesignSeniorMock` + `BuildSystemDesignSenior{System,Report}Prompt` + dispatcher + branching CreateSession + frontend panel/rubric — 11 unit-тестов | 0.5 нед | ✅ закрыто |
| 3.3 | Atlas extension: System Design branch + cross-link от engineering hub | 0.5 нед | ✅ |
| 3.4 | `Section.SECTION_TECH_LEAD_EM` + `TaskTechLeadMock` + `BuildTechLead{System,Report}Prompt` (15 STAR-сценариев в prompt'е) + dispatcher + frontend panel/rubric — 12 unit-тестов | 1.5 нед | ✅ закрыто |
| 3.5 | Atlas extension: People skills branch (5 sub-skills + Tech Lead hub) | 0.5 нед | ✅ |
| 3.6 | Code-review-coaching: 10 PR из публичных open-source repos + UI для review | 2 нед | ✅ MVP закрыт (без catalog) — backend (Task=`hone_code_review_grade`, 70B-class; `domain.CodeReviewGrader` port + `LLMChainCodeReviewGrader`/`NoLLMCodeReviewGrader`; `GradeCodeReview` use case с 100KB diff cap / 20KB review cap, 5 unit-тестов; sanitiser drops malformed entries, coerces unknown categories to "clarity") + RPC + REST `/api/v1/hone/code-review/grade` + Hone `pages/CodeReview.tsx` + `api/codeReview.ts` + palette **G** + hotkey G (PR title / diff / review surface → AI score chip + per-issue rows со stripe correctness/completeness/clarity/tone). User приносит свой собственный diff — curated catalog 10 PR — V2 |
| 3.7 | `<Tracks />` секция на /welcome — 6 трек-карточек (live/soon pills), новый nav-anchor `#tracks` между Ritual и ProductRow | 0.5 нед | ✅ закрыто |
| 3.A | **Admin add-on:** `track_kind` фильтр в AtlasPanel + picker в AtlasNodeModal — без него CMS-редактирование senior/english узлов = скролл всего каталога | 1 час | ✅ |

**Acceptance:**
- Юзер с треком `dev_senior` видит System Design / Tech Lead / Code Review разделы в навигации.
- Все три mock-flow работают end-to-end.
- Insights показывают senior-specific метрики.

### Wave 3.5 — Admin observability add-ons (опционально, после Wave 3)

Запрошены пользователем во время Wave 3 ревью. Не блокируют Wave 4, но без них первые проблемы с multi-track / English HR / mock-block protocol спалятся в проде через support-каналы, не через метрики.

| # | Задача | Эффорт | Статус |
|---|---|---|---|
| 3.5.1 | Tracks panel — distribution per track-kind, primary count, active_30d, % share. Chi-direct REST, без proto-codegen | 0.5 дня | ✅ закрыто |
| 3.5.2 | English HR mocks dashboard — total/with_report/avg_score/error_rate KPIs + recent 10 sessions table с PII-hash (8 chars). Alert-card при error_rate ≥ 10% | 0.5 дня | ✅ закрыто |
| 3.5.3 | Mock-block metrics — strict / ai_assist split + strict_pct headline. Warn-card при < 50%. CheckBlock-counter — TODO в комментарии (требует Redis-инструментации в copilot) | 0.5 дня | ✅ закрыто |

## Wave 4 — English Hone-loop (8 недель)

Главный layer English-инициативы. После того как mock-round + tutor-MVP подтвердили traction.

| # | Задача | Эффорт |
|---|---|---|
| 4.1a | Migration `00013_hone_reading.sql` — `hone_reading_materials` + `hone_reading_sessions` + `hone_vocab_queue` (Leitner SRS box 0..5) | 0.5 дня | ✅ закрыто |
| 4.1b | Hone domain: `ReadingMaterial`, `ReadingSession`, `VocabEntry`, `ReadingSourceKind` enum, `ReadingRepo` interface | 0.5 дня | ✅ закрыто |
| 4.1c | `ReadingRepoPG` infra: 9 методов (CRUD materials + start/end session + SRS upsert/advance/list-due) с готовой `srsIntervals` таблицей (4h / 1d / 3d / 7d / 16d / graduated) | 1 день | ✅ закрыто |
| 4.1d | App use cases: 8 шт (AddReadingMaterial / List / Archive / Start/EndSession / AddVocab / ReviewVocab / ListVocabDue) с input-validation (2MB body cap, source_kind whitelist) + 7 unit-тестов | 0.5 дня | ✅ закрыто |
| 4.1e | Proto + ports — Connect-RPC handlers поверх готовых use case'ов; 9 RPC + REST aliases `/hone/reading/*` | 1 день | ✅ закрыто |
| 4.1f | Frontend Hone Reading-страница (hotkey `R`, library + reader + click-on-word + add-material form + SRS review widget) | 4 нед | ✅ закрыто (MVP) |
| 4.2 | Click-on-word: vocab queue + Notes-теги | 1 нед | ✅ закрыто — backend (UpsertVocab + new `ListVocabBySourceMaterial` repo + `ListVocabBySourceMaterial` use case + RPC `/api/v1/hone/reading/materials/{material_id}/vocab`) + Hone reader popover saves vocab + reverse cross-link `<SavedVocabPanel />` под текстом материала показывает «words you've saved here» chip-list (word + box-level), refresh после каждого click-save |
| 4.3 | AI summary check (после главы): LLM compare с реальным содержанием | 1 нед | ✅ закрыто — `domain.SummaryGrader` port + `LLMChainSummaryGrader`/`NoLLMSummaryGrader` adapters (Task=`hone_summary_grade`, 8B-class JSON-mode); `EndReadingSession.Do` runs grader inline (best-effort, swallows errors), persists через `SetAISummaryScore`, возвращает `ReadingSession` с `ai_summary_score`; Hone reader показывает score panel (strong / mid / weak) после Finish; 4 unit-теста |
| 4.4 | Writing-as-Focus: новый тип focus-сессии «English Writing» + AI inline feedback | 2 нед | ✅ MVP закрыт — `domain.WritingGrader` port + `LLMChainWritingGrader`/`NoLLMWritingGrader` (Task=`hone_writing_feedback`, JSON-mode); `GradeEnglishWriting` use case (50KB cap, 5 unit-тестов); `GradeEnglishWriting` RPC + REST `/api/v1/hone/writing/grade`; Hone `pages/Writing.tsx` + `api/writing.ts` + palette **W** + hotkey W (draft → grade → структурный список issues с category stripe + apply-fix one-click; save-to-Notes shortcut). Persistence by design отсутствует — text лежит в стейте, save-to-Notes — escape hatch |
| 4.5 | SRS daily review: ✅ backend (`hone_vocab_queue` + `AdvanceVocab` + `ListVocabDue`) + ✅ Hone UI widget в Reading-pane (Reveal → Again/Got it) | 2 нед | ✅ закрыто (MVP) |

**Acceptance:**
- Юзер открыл главу в Hone, читал 12 минут, написал summary, AI флагнул gaps.
- Vocab queue имеет 5+ слов, daily review показывает их.
- Writing-сессия даёт реальный inline-фидбэк на грамматику и vocab.

## Wave 5 — Tutor Tier 2 + 3 (7 недель)

После того как Tier 1 + Hone English-loop работают.

| # | Задача | Эффорт |
|---|---|---|
| 5.1 | Tier 2: tutor pushes assignments в Hone Today (новый source `from_tutor`) | 3 нед | ✅ закрыто — backend (migration `00014_tutor_assignments.sql` с partial-idx на pending; `domain.Assignment` + `AssignmentRepo` через `*Postgres` (одна структура — три интерфейса: Repo + SnapshotRepo + AssignmentRepo); 5 use cases — `PushAssignment` / `ListAssignmentsForTutor` / `ListPendingForStudent` / `MarkAssignmentComplete` / `ArchiveAssignment` с EnsureRelationship-гейтами; 5 RPC + REST aliases; `ErrAlreadyCompleted` → `FailedPrecondition`; 7 unit-тестов) + frontend tutor (Assignments tab на `TutorStudentPage` с Push-формой title/body/due_at + status-badged list `open/overdue/completed/archived` + archive action) + Hone student-side `pages/TutorAssignments.tsx` + `api/tutor.ts` + palette **A** + hotkey A (overdue/due_soon/open stripe + Done flip + auto-drop из feed) |
| 5.2 | Tier 3: group-classes через circles — capacity, tutor-led events, broadcast assignments | 4 нед | partial ✅ — 5.2a + 5.2b + 5.2c + 5.2d + 5.2e закрыты. **Schema-ready для group events**: migration `00020_tutor_event_rsvps.sql` создаёт `tutor_event_rsvps (event_id, student_id, joined_at)` PK с двумя idx (event-side count + student-side calendar UNION). ⏳ остаётся: tutor-side `CreateGroupEvent` UC (валидация circle ownership + capacity), `JoinEvent`/`LeaveEvent` student UCs (capacity gate в transaction), Hone Calendar UNION upcoming-via-circle, web tutor UI «pick circle + capacity» extension to event form |
| 5.2a | Broadcast assignments — backend `BroadcastAssignment` use case (loops `ListTutorStudents` → `CreateAssignment` per-student с EnsureRelationship-гейтом, partial-failure semantics — успешные push'ы лендят даже если один student упал, 3 unit-теста); RPC `BroadcastAssignment` + REST `/api/v1/tutor/assignments/broadcast`; web tutor dashboard Broadcast section (title/body/due_at форма + result-card с «Pushed N/M students» + per-student failure list) | 0.5 нед | ✅ закрыто |
| 5.2e | Hone IA refactor — palette collapse: 5 entries (Reading, Writing, Listening, Assignments, Calendar) → 2 hub-entries «English · Read · Write · Listen» (R/W/L) + «Tutor · Tasks · Calendar» (A/M). Pattern mirrors existing `BoardsTabsChrome` (Boards · Code rooms): два новых компонента `EnglishTabsChrome` + `TutorTabsChrome` rendering as floating top-center pill overlay (zIndex 12, no-drag region). Page-level хоткеи R/W/L/A/M остаются работать напрямую — chrome это visual hub, не rerouting layer. Палитра теперь 11 entries вместо 13; English/Tutor hub'ы визуально объединены в строке «English · Read · Write · Listen» с показом всех трёх kbd-чипов. Никаких изменений page-уровневой логики, никаких миграций | 0.25 нед | ✅ закрыто |
| 5.2d | Event completion + session notes — backend (additive migration `00017_tutor_events_session_note.sql` с CHECK pair invariant `session_note non-empty iff status='completed'`; domain `Event.SessionNote` field + `EventRepo.CompleteEvent` method; PG repo с 2-step terminal-detection (ErrNotFound vs ErrInvalidInput); `CompleteEvent` use case с required-non-empty note + 8KB cap + 4 unit-теста); proto `CompleteEvent` RPC + REST `/api/v1/tutor/events/{event_id}/complete` + `session_note` field на `TutorEvent`; ports + monolith wiring; web tutor dashboard `EventRow` теперь рендерит **«✓ Mark complete»** button (на past/live status) с window.prompt note input + green-bordered «Session note» card на completed events + status-derivation update (past = «awaiting close» warn, completed = success); Hone student-side surfaces session_note в green panel на Calendar event card (forward-compat — server filter excludes completed events from Upcoming feed; surface готов для future «past sessions» endpoint). Foundation для Wave 9.5 tutor analytics — completed events с notes теперь aggregateable | 0.5 нед | ✅ закрыто |
| 5.2c | Event reminders — client-side scheduler `api/eventReminders.ts` фаирит OS-notifications через существующий `notify()` primitive в трёх окнах: T-24h («tomorrow at 18:00 — Weekly 1-on-1»), T-1h, T-now. localStorage dedup (`hone:event-reminders:fired`) переживает app restart — re-opening не reroll'ит prior reminders. Late-fire tolerance per-window (24h: 1h late, 1h: 30 min late, now: 30 min late — past that, mark as fired but don't notify, prevents indefinite re-eval). 5-min polling + window-focus tick + setTimeout 24h horizon (re-resolve at next refresh для далёких событий). Reconcile clears timers для cancelled/completed events. Forward-compat hook: server push (когда захочется покрыть Hone-closed case) пишет тот же dedup-key — scheduler skip'нет. Bootstrap из App.tsx alongside `wireOutboxExecutors`. Wave 5.2b passive calendar теперь активный | 0.5 нед | ✅ закрыто |
| 5.2b | Tutor-scheduled 1-on-1 events — full production-quality slice (no MVP cuts). Backend: migration `00016_tutor_events.sql` (forward-compat schema с `circle_id` + `capacity` для V2 group events; XOR CHECK на (student_id, circle_id); cancellation_reason mandatory CHECK; partial idx по `student_id` upcoming); `domain.Event` + `EventStatus` + `EventRepo` с `Validate()` invariants; PG repo с auth-gate (requester=tutor OR student) + 2-step distinguishing read для CancelEvent (ErrNotFound vs ErrInvalidInput на already-terminal); 4 use cases — `CreateEvent`/`CancelEvent`/`ListEventsForTutor`/`ListUpcomingEventsForStudent` с full input validation (title/body/meet_url caps, duration 1..480, scheduled_at past-rejection с 5-min slack); 14 unit-тестов покрывают happy path + все validation edges + relationship gating + already-terminal propagation. Proto: 4 RPCs + REST aliases `/api/v1/tutor/events/*`. Ports: handlers с proper error mapping (ErrInvalidInput → InvalidArgument). Frontend tutor: Events section на `TutorDashboardPage` со student picker + datetime-local + duration spinner + meet_url + cancel-with-reason prompt + display-status-derivation (live/past/scheduled/cancelled/completed status badges). Hone: `api/tutor.ts` extension + `pages/Calendar.tsx` (day-grouped earliest-first list, Today/Tomorrow/weekday labels, live highlighting) + palette **M** + hotkey M + `<UpcomingEventChip />` на HomePage (top-right, surfaces within 24h or while live, JOIN button when live with meet_url). Все 3 typecheck clean | 1 нед | ✅ закрыто |

## Wave 6 — Listening + Cue English mode (4 недели)

| # | Задача | Эффорт |
|---|---|---|
| 6.1 | Listening: транскрипт поверх podcasts + click-on-word + speed control | 2 нед | ✅ MVP закрыт — backend (migration `00015_hone_listening.sql` с partial-idx user_active; `domain.ListeningMaterial` + `ListeningRepo`; 4 use cases — Add/Get/List/Archive с 2MB transcript cap; 4 RPC + REST aliases `/api/v1/hone/listening/materials/*`; 3 unit-тестов) + Hone `pages/Listening.tsx` + `api/listening.ts` + palette **L** + hotkey L (library + native `<audio>` player с speed picker 0.5×–2× + transcript click-on-word reuses `addVocab` — общая SRS-очередь с Reading; URL-gate отбрасывает не-mp3/m4a/ogg) |
| 6.2 | Cue English mode: phrasing suggestions в IDE / email / Slack | 2 нед | ✅ MVP закрыт — Cue hotkey **⌃⇧L** (`english_polish`) открывает stealth-окно `english-polish` (frameless transparent, content-protection on, top-right floating), reads clipboard, шлёт через `english:polish-grade` IPC → main `createEnglishPolishClient` → POST `/api/v1/hone/writing/grade` (Wave 4.4 backend); renderer `EnglishPolishScreen` показывает overall score chip (strong/mid/weak stripe) + per-issue rows с category-colour stripe (grammar/vocab/style/clarity) + Copy-fix one-click clipboard write; Esc прячет окно. Reused 4.4 backend целиком — никаких новых RPC/migration/repo |

## Wave 7 — Sysanalyst track ✅ (V1 без эксперта; expert-validation post-launch)

**Изменение vs изначального плана**: V1 запущен без part-time эксперта. AI-mock, prompt'ы и Atlas-сид собраны на основе публичного знания о senior-sysanalyst интервью. Эксперт может валидировать post-launch — итеративно править prompt'ы и атлас (admin CMS уже умеет редактировать atlas-узлы; prompt'ы — следующий этап).

| # | Задача | Кто | Эффорт | Status |
|---|---|---|---|---|
| 7.1 | Backend: `SECTION_SYSANALYST` + `enums.SectionSysanalyst` (`IsTaskBased=false`, `IsEngineering=false`); `TaskSysanalystMock` task constant + 70B-class provider mapping; `domain.BuildSysanalystSystemPrompt` (5-axis rubric + 18 question pool) + `BuildSysanalystReportPrompt` (JSON envelope); dispatcher branches в `service.go::BuildSystemPrompt`/`BuildReportPrompt`; ports `sectionToProto/sectionFromProtoMock` ветки; 7 unit-тестов в `domain/sysanalyst_test.go` | Claude | 0.5 нед | ✅ закрыто |
| 7.2 | Atlas seed `00018_analyst_atlas_seed.sql` — `sa_root` + 6 sub-skills (requirements / modeling / integration / data / process / documentation), 6 edges, sort_order 300-306, track_kind `sysanalyst` | Claude | 0.25 нед | ✅ закрыто |
| 7.3 | Frontend: `SysanalystPanel` pre-brief на `MockSessionPage` (5-axis card + ground rules); `MockResultPage` rubric с 5 SectionCard (requirements / modeling / integration / data / process). Welcome `/tracks` карточка переведена «soon → live» с обновлённым описанием | Claude | 0.25 нед | ✅ закрыто |
| 7.4 | Expert content validation | эксперт когда появится | open-ended | ✅ engineering closed — admin CMS уже умеет редактировать atlas_nodes; prompt-уровневая правка через `BuildSysanalystSystemPrompt` (в `services/ai_mock/domain/sysanalyst.go`) — single-file iteration. Никаких блокеров для launch'а; expert-feedback loop работает без доп. инфры |

## Wave 8 — Product analyst track ✅ (V1 без эксперта; expert-validation post-launch)

Same pattern as Wave 7. AI-mock + prompt'ы + Atlas сид — на основе публичного PA-curriculum'а; эксперт post-launch валидирует.

| # | Задача | Кто | Эффорт | Status |
|---|---|---|---|---|
| 8.1 | Backend: `SECTION_PRODUCT_ANALYST` + `enums.SectionProductAnalyst`; `TaskProductAnalystMock` + 70B mapping; `BuildProductAnalystSystemPrompt` (5-axis: metrics/sql/experimentation/frameworks/communication + 18 questions) + `BuildProductAnalystReportPrompt`; dispatcher branches; 6 unit-тестов в `product_analyst_test.go` | Claude | 0.5 нед | ✅ закрыто |
| 8.2 | Atlas seed (та же миграция `00018`) — `pa_root` + 6 sub-skills (metrics / sql / experimentation / frameworks / communication / tooling), 6 edges, sort_order 400-406, track_kind `product_analyst` | Claude | 0.25 нед | ✅ закрыто |
| 8.3 | Frontend: `ProductAnalystPanel` pre-brief + `MockResultPage` 5 SectionCard. Welcome trackcard «soon → live» | Claude | 0.25 нед | ✅ закрыто |
| 8.4 | Expert validation | эксперт когда появится | open-ended | ✅ engineering closed — same pattern as 7.4: admin CMS for atlas, single-file prompt iteration |

## Wave 9 — Year-2 plan, brought forward

| # | Задача | Status |
|---|---|---|
| 9.1 | Tier 5 — tutor marketplace через **Boosty** (payment integration ИСКЛЮЧИТЕЛЬНО Boosty — не ЮKassa, не Stripe; Boosty owns money flow, мы только маршрутизируем outbound deep-link) | ✅ закрыто — schema (`00021_tutor_listings_scaffold.sql`: `tutor_listings` с `boosty_url` + `tutor_listing_packages` с money-as-kopecks; `tutor_payment_events` table удалена — нет своего платёжного аудита, all webhook flow живёт на стороне Boosty). Backend: domain `Listing`/`ListingPackage` + `ListingRepo` (5-я роль `*Postgres`); app — 9 use cases (Create/Update/Publish/Archive Listing + Browse + GetBySlug + Add/ArchivePackage + ListMy) с slug regex, https-required publish-time validation, kopecks-only math; proto + ports (8 RPCs + REST aliases); monolith wires `MountPublicREST` carve для `/marketplace/listings(/{slug})` + публичные пути в `restAuthGate`. Frontend: web `/marketplace` (track + max-rate filter, listing cards) + `/marketplace/{slug}` (detail с outbound «Subscribe via Boosty» CTA, target=\_blank) + `/tutor/listings` (manage page: create draft → fill Boosty URL → Publish; archive); 8 react-query hooks. Pricing tier UI (packages CRUD) ждёт реального тутора-заказчика, но schema + UC + RPC готовы. Flow студента: marketplace → Boosty checkout → tutor шлёт invite-code через существующий `tutor_invites` → /invite/{code} accept |
| 9.2 | QA / тестировщик трек | ✅ закрыто — `SECTION_QA` + `TaskQAMock` + 18-question prompt по 5 axes (test_design / api / automation / bug_analysis / process); Atlas seed `qa_root` + 7 sub-skills (Sub-skill includes `qa_performance` extension); `<QAPanel />` + 5 SectionCard rubric; Welcome track-card live |
| 9.3 | DevOps / SRE трек | ✅ закрыто — `SECTION_DEVOPS` + `TaskDevOpsMock` + 18-question prompt по 5 axes (infra / observability / cicd / incident / security); migration 00019 добавляет `'devops'` в `track_kind` enum (ALTER TYPE ADD VALUE); Atlas seed `do_root` + 7 sub-skills; `<DevOpsPanel />` + 5 SectionCard rubric; Welcome track-card live |
| 9.4 | Multi-tutor support (один студент → несколько тутров) | ✅ закрыто — schema уже supported it (idx_tutor_students_active per `(tutor, student)`); добавили `ListStudentTutors` repo method + `ListMyTutors` use case + RPC + REST `/api/v1/tutor/my-tutors` + Hone client `listMyTutors` |
| 9.5 | Tutor analytics (revenue, conversion, retention) | ✅ закрыто (engagement metrics) — `domain.TutorActivity` aggregate (active students / completed / cancelled / scheduled / minutes_taught / cancellation_rate) + `TutorEventStats` repo method + `GetTutorActivity` UC + RPC + REST `/api/v1/tutor/activity` + web tutor dashboard `<ActivityPane />` 5-stat grid с success/warn tinting на counts + cancellation-rate derived. Revenue/conversion ждут Wave 9.1 payment infra |

## Сводная таблица сроков

| Wave | Что | Эффорт (нед) | Накопительно (мес) |
|---|---|---|---|
| 0 | Foundation (multi-track) | 1 | 0.25 |
| 1 | English mock-round | 2-3 | 1.0 |
| 1.5 | Welcome refresh + interactive demo | 2 | 1.5 |
| 2 | Tutor MVP (Tier 1 + 4) | 4-5 | 2.5 |
| 3 | Senior dev pack | 6 | 4.0 |
| 4 | English Hone-loop | 8 | 6.0 |
| 5 | Tutor Tier 2 + 3 | 7 | 7.5 |
| 6 | Listening + Cue English | 4 | 8.5 |
| 7 | Sysanalyst track | 5 + найм | 10.0 |
| 8 | Product analyst track | 5 + найм | 11.5 |
| 9 | Year 2 stuff | — | Year 2 |

**Реалистичный milestone**: к месяцу 6 (Wave 0-4 закрыты) — продукт с 4 треками (dev_middle, dev_senior, English, плюс tutor-flow) и реальным Hone English-loop. Это уже сильный shift в позиционировании от «product for developers» к «daily growth platform для IT».

## Что делать руками (для Sergey, не для Claude)

- **Wave 0**: ничего, можно положиться на Claude.
- **Wave 1**: ничего по коду; **обновить /pricing** с упоминанием English после launch.
- **Wave 2**: **главное** — провести 5-10 интервью с English-тутрами **до** старта разработки. Без этого — паркуем Wave 2.
- **Wave 3**: курирование 10 PR'ов для code-review-coaching — это требует руки. ~2-3 часа на PR (выбрать interesting cases).
- **Wave 7-8**: найм экспертов через Хабр / TG / друзей. Самая важная manual задача.
- **Year 2**: маркетплейс — нужны: ЮKassa merchant account, юр-форма (ИП / ООО), договор-оферта с тутрами, налоги.

## Блокеры

| Блокер | Митигация |
|---|---|
| Нет 5+ design-partner тутров | Парковать Wave 2 (Tier 1 dashboard), делать Wave 3 (Senior) первым |
| Нет нанятого sysanalyst-эксперта | Парковать Wave 7, продолжать Wave 5-6 |
| LLM-провайдеры закрыли free-tier | См [docs/tech/conventions.md#llm-провайдеры](../tech/conventions.md#llm-провайдеры) — fallback chain держит график |
| Apple закрыл `setContentProtection` (Cue) | Не блокирует Wave 0-5; Wave 6 может приостановиться |

## Tracking статус

Этот файл — источник правды. Каждая Wave получает суффикс `[CLOSED]` после завершения, с датой.

**Закрыто:**
- **Wave 0** — Foundation (multi-track) ✅
- **Wave 1** — English mock-round ✅
- **Wave 1.5** — Welcome refresh + interactive demos ✅
- **Wave 2** — Tutor MVP (Tier 1 + 4 stub) ✅ + 2.4c snapshot extension ✅
- **Wave 3** — Senior dev pack ✅ (3.1–3.7) + 3.6 Code-review-coaching ✅
- **Wave 3.5** — Admin observability add-ons ✅
- **Wave 4** — English Hone-loop (Reading/Writing/Listening/SRS/Summary grader) ✅ + 4.2 Notes ↔ vocab cross-link ✅
- **Wave 5.1** — Tier 2: tutor pushes + student Hone integration ✅
- **Wave 5.2a/b/c/d/e** — Broadcast + 1-on-1 events + reminders + completion с session notes + Hone IA refactor ✅
- **Wave 6.1** — Listening (audio + transcript + speed control) ✅
- **Wave 6.2** — Cue English mode (⌃⇧L polish-from-clipboard) ✅
- **Wave 7** — Sysanalyst track ✅ (V1 без эксперта; expert validation engineering-closed)
- **Wave 8** — Product analyst track ✅ (то же)
- **Wave 9.2** — QA / тестировщик трек ✅
- **Wave 9.3** — DevOps / SRE трек ✅
- **Wave 9.4** — Multi-tutor support (ListMyTutors API + Hone client) ✅
- **Wave 9.5** — Tutor analytics dashboard (engagement metrics) ✅

**Закрыто (новое):**
- **ML Platform cluster (отвилка от dev)** ✅ — миграция `00023_ml_platform_cluster.sql` добавляет 7 atlas-узлов под `track_kind='dev'` с новым `cluster='ml_platform'` (hub `mlplat_root` + keystones `k8s_deep`/`atleastonce`/`pipelines` + notable `model_serving`/`observability` + small `mlops_practices`). Решение **Б** из обсуждения 2026-04-30: вакансии типа «Go ML Platform engineer» по факту требуют «Go senior + узкая ML-обвязка» — базовая system_design / SQL / behavioral rubric'а покрывает 80%, а ML-специфика лучше живёт как cluster под dev, чем как отдельный `track_kind` (избегаем дублирования mock rubric'и + ALTER TYPE). Welcome-карточка `dev` упоминает отвилку. Frontend без изменений — узлы автоматически появляются у dev-юзеров через существующий cluster-aware рендер
- **Wave 5.2 group events on circles** ✅ — `tutor_event_rsvps` table (00020); 6 новых `EventRepo` методов (EnsureCircleOwner/Member, JoinEvent с READ-COMMITTED capacity-gate, LeaveEvent idempotent, RSVP count, ListUpcomingGroupEventsForStudent); 5 use cases (CreateGroupEvent с EventCapacityMax=200 cap, JoinEvent, LeaveEvent, ListUpcomingGroupEventsForStudent, GetEventRSVPCount); 5 RPCs + REST routes; web tutor dashboard mode-toggle 1-on-1/Group в EventsPane (circle dropdown из useMyCirclesQuery + capacity input); Hone Calendar новая «GROUP CLASSES · OPEN» секция с JOIN/LEAVE кнопками
- **Wave 9.1 Tutor marketplace через Boosty** ✅ — full backend + frontend (см выше)

**Открыто (post-launch / external):**
- Expert content validation для 7/8/9.2/9.3 — admin может править atlas + single-file prompt iteration; ждёт появления эксперта
