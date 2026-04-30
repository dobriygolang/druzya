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
| 0.2 | Migration `00007_skill_atlas_tracks.sql` — добавить `track_kind` enum в `skill_nodes` | `backend/migrations/` | 1 час | ⏳ |
| 0.3 | Proto extension: `profile.proto` — `Track` enum, `SetUserTracks` RPC | `proto/druz9/v1/profile.proto` | 1 час | ⏳ |
| 0.4 | Backend wiring `services/profile/` — handler + use case + repo | `backend/services/profile/` | 4 часа | ⏳ |
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
| 4.2 | Click-on-word: vocab queue + Notes-теги | 1 нед | ✅ backend (UpsertVocab) + ✅ Hone reader-flow (popover saves to vocab queue); ⏳ Notes-теги cross-link |
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
| 5.2 | Tier 3: group-classes через circles — capacity, tutor-led events, broadcast assignments | 4 нед | partial ✅ — 5.2a (broadcast assignments) закрыт: backend `BroadcastAssignment` use case (loops `ListTutorStudents` → `CreateAssignment` per-student с EnsureRelationship-гейтом, partial-failure semantics — успешные push'ы лендят даже если один student упал, 3 unit-теста); RPC `BroadcastAssignment` + REST `/api/v1/tutor/assignments/broadcast`; web tutor dashboard Broadcast section (title/body/due_at форма + result-card с «Pushed N/M students» + per-student failure list). ⏳ остаётся group-classes через circles (capacity, tutor-led events) |

## Wave 6 — Listening + Cue English mode (4 недели)

| # | Задача | Эффорт |
|---|---|---|
| 6.1 | Listening: транскрипт поверх podcasts + click-on-word + speed control | 2 нед | ✅ MVP закрыт — backend (migration `00015_hone_listening.sql` с partial-idx user_active; `domain.ListeningMaterial` + `ListeningRepo`; 4 use cases — Add/Get/List/Archive с 2MB transcript cap; 4 RPC + REST aliases `/api/v1/hone/listening/materials/*`; 3 unit-тестов) + Hone `pages/Listening.tsx` + `api/listening.ts` + palette **L** + hotkey L (library + native `<audio>` player с speed picker 0.5×–2× + transcript click-on-word reuses `addVocab` — общая SRS-очередь с Reading; URL-gate отбрасывает не-mp3/m4a/ogg) |
| 6.2 | Cue English mode: phrasing suggestions в IDE / email / Slack | 2 нед | ✅ MVP закрыт — Cue hotkey **⌃⇧L** (`english_polish`) открывает stealth-окно `english-polish` (frameless transparent, content-protection on, top-right floating), reads clipboard, шлёт через `english:polish-grade` IPC → main `createEnglishPolishClient` → POST `/api/v1/hone/writing/grade` (Wave 4.4 backend); renderer `EnglishPolishScreen` показывает overall score chip (strong/mid/weak stripe) + per-issue rows с category-colour stripe (grammar/vocab/style/clarity) + Copy-fix one-click clipboard write; Esc прячет окно. Reused 4.4 backend целиком — никаких новых RPC/migration/repo |

## Wave 7 — Sysanalyst track (5 недель + найм)

**НЕ начинаем без эксперта.** Найм — first.

| # | Задача | Кто | Эффорт |
|---|---|---|---|
| 7.0 | Найм part-time эксперта (~50к₽/мес, 5-10 ч/нед) через Хабр / TG | Sergey | 1-2 нед |
| 7.1 | Phase 1: LLM-генерация черновика (30 кейсов + Atlas + rubrics) | Claude + Sergey | 1 нед |
| 7.2 | Phase 2: эксперт валидирует контент | эксперт | 1 нед |
| 7.3 | Backend wiring: новый `MockTopic` value `SYSANALYST`, persona, Atlas branch | Sergey | 1.5 нед |
| 7.4 | Insights extension: sysanalyst-specific метрики | Sergey | 0.5 нед |

## Wave 8 — Product analyst track (5 недель + найм)

Аналогично Wave 7.

## Wave 9 — Year 2

| # | Что | Когда |
|---|---|---|
| 9.1 | Tier 5 — tutor marketplace + биллинг через ЮKassa | Year 2 H1 |
| 9.2 | QA / тестировщик трек | Year 2 H1 |
| 9.3 | DevOps / SRE трек | Year 2 H2 |
| 9.4 | Multi-tutor support (один студент → несколько тутров) | Year 2 |
| 9.5 | Tutor analytics (revenue, conversion, retention) | Year 2 |

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

Этот файл — источник правды. Каждая Wave получает суффикс `[CLOSED]` после завершения, с датой:

- **Wave 0** — `🔄 в работе с 2026-04-29`
- **Wave 1+** — `⏳ pending`

После закрытия Wave обновляем эту секцию и запускаем следующую.
