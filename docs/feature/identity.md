# druz9 — identity (2026-05-04)

**Что мы:** AI-coach с памятью + free tutor-toolkit + Hone focus-app для подготовки senior IT-разрабов и их учеников к собесу.

**1 главный трек, 2 модификатора:**
- **Главное:** dev (Go senior) — AI-coach + atlas + mock-rubric.
- **Sub-mode:** `go` — Sergey сам Go senior; отдельный режим для глубоких Go-сессий (language internals / runtime / distributed).
- **Орт-модификатор:** English — opt-in toggle в Hone settings. Когда выключен — все English surfaces (Listening / Reading-EN / Writing / Vocab / English mocks) скрыты, в Palette не появляются. ML — НЕ отдельный hardcoded трек: контент остаётся как специализация внутри `dev_senior` (см. Phase 4.1).

**Hybrid path-выбор (onboarding):**
- **Готовый путь** — preset (senior-go-backend / ml-platform-engineer / backend-junior-middle), юзер toggle'ит чекбоксы «уже знаю → пропустить».
- **Свой путь** — free-form goal («Senior Go в финтех с фокусом на realtime»). Backend (`TaskCustomPathGenerate`, llmchain 70B) генерит 8–15 узлов с group classification. Юзер дальше редактирует.

**User-driven atlas:**
TODO в свободной форме («изучить транзакции в Postgres») → backend (`TaskAtlasClassify`, 8B) либо матчит в curated-узел, либо создаёт row в `user_atlas_nodes`. На /atlas curated и user-owned узлы мерджатся в один view.

**Что мы НЕ:**
- НЕ LeetCode — нет grinding/ELO/1v1/2v2 (всё выпилено).
- НЕ Skyeng — мы amplify тутора, не учим сами.
- НЕ Coursera — preparation для тех у кого есть базис, не курсы с нуля.
- НЕ paid marketplace — Boosty marketplace выпилен.

## Ключевая модель

druz9 = **«персональный AI-coach + Hone-cockpit + бесплатные инструменты для тутора»**.

Двусторонний рынок без денежного шага:
- **Тутор приходит** → бесплатно: assignments queue, student snapshots, AI pre-session brief, общий календарь, shared reading library, **session notes-pad** (Phase 3.3 — личные заметки тутора per-student с auto-save).
- **Студент тутора** через invite-код / @username → AI-tutor 24/7 между сессиями, mock-rubric, Hone, Atlas-progress.
- **Студент без тутора** → AI-tutor + AI-mock + Atlas как самостоятельный продукт.

## Active study mode (Hone)

Hone фильтруется по active study mode. Switcher на header'е (после Phase 4.1 без ML):
- `general` — all-in-one (default)
- `dev` — Go senior, dev-track activity
- `english` — English-loop (виден только если english_active=true)
- `go` — Go-deep (Sergey-style: language internals, runtime, distributed)

Контент (Today / Tasks / Reading / AI-tutor thread / Notes / Palette) фильтруется по active mode. Switching = soft (без перезагрузки). Источник — `hone_user_settings.active_track text` (CHECK после mig 00046: `general|dev|english|go`).

**English opt-in (mig 00042):** `hone_user_settings.english_active boolean`. Если `false` — все English-surfaces скрыты в Hone (включая Palette entries, EnglishTabsChrome, listening / reading-EN / vocab / writing / english-mocks). Включается toggle'ом в Settings.

**Palette (Phase 1.2):** flat fuzzy-search без section-headers («Capture / Daily / …» удалены). Только icon + label.

## YouTube transcript ingestion (Phase 2.1)

Listening tab принимает YouTube URL → backend (`youtube_fetcher.go`, yt-dlp + JSON3 auto-captions) скачивает транскрибацию → создаётся row в `hone_listening_materials`. Юзер не ищет транскрипт вручную.

## Reading: Book source (Phase 2.3)

Reading library поддерживает источник `book` (бумажная копия) + `book_chapter` / `book_total_chapters` для tracking прогресса по главам. body_md для books может быть пустым — юзер читает оффлайн.

## AI-tutor проблема и план

**Проблема (Sergey 2026-05-01):** AI-tutor живёт как отдельная страница, пользователю непонятно что он умеет. Похож на «ещё один GPT-чат», ассоциация плохая.

**План:**
1. **Inline contextual** — на `/atlas/{node}` / MockResultPage / Hone Reading в углу pill «Спросить AI-coach'а». Открывает mini-chat с pre-loaded context.
2. **Proactive triggers** — после failed mock автогенерится assignment в TaskBoard; на новую atlas-node активацию AI шлёт welcome.
3. **Dual mode** — если есть human-tutor: AI assistive, не дублирует assignments. Если нет — AI primary.
4. **Auto-assignment в TaskBoard** — тутор задаёт дедлайн, assignment появляется в Hone TaskBoard у студента.

## External progress logging — НЕ через чат

**Sergey 2026-05-01:** «делать это ввиде чата сейчас не очень, ассоциация плохая, подумают что это обычный GPT-чат».

**Решение:** structured form в Hone Stats / Today (`external_activity` table — mig 00037).
- Кнопка «+ занятие» → modal с Source / Topic (autocomplete по atlas-узлам, теперь и по `user_atlas_nodes`) / Minutes / optional notes.
- После submit: запись в `external_activity` + bump прогресса atlas-node.
- LLM используется silently на бэке (recommended next-step, фоновая заметка в `coach_episodes`).

## Intelligence integration

intelligence-service = «мозг» проекта (daily-brief, coach memory facts):
- Читает `external_activity` в snapshot.
- Читает `ai_tutor_facts` для cross-track recall.
- Daily-brief упоминает «вчера ты делал X на Coursera».
- AI-tutor `SnapshotProvider` adapter → реальный → берёт snapshot из intelligence.

## Что точно keep
- Cue stealth-copilot — side-channel, отдельная identity.
- Podcasts — surface для reading library.
- Circles — group events / reading clubs.
- Vacancies — продолжение mock-flow.
- Quiz — standalone Q&A drill.
- Calendar — personal events для intelligence.

## Что выпилено
- **Pre-2026-05-01:** arena/lobby/algo-каталог/sanctum.
- **2026-05-01:** marketplace, tg_coach, feed, clubs, slot, rating, events, review.
- **2026-05-04 (Phase 4.1):** `track_kind='ml'` enum-value; ML-узлы атласа re-tag в `dev_senior` (контент сохранён, но «ML — отдельный трек» больше нет).

## Связь с другими доками
- `docs/feature/ai-tutor.md` — AI-tutor architecture (memory layers).
- `CLAUDE.md` — orientation.
- `docs/tech/conventions.md` — free-tier LLM правила.
- Migrations: 00037 (external_activity) · 00040 (shared_materials) · 00041 (invite by username) · 00042 (english_active) · 00043 (book source) · 00044 (user_atlas_nodes) · 00045 (tutor_session_notes) · 00046 (drop ml from track_kind).
