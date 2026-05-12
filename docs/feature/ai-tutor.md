# AI-tutor — design (2026-05-01, F1 Phase 2 implemented 2026-05-12)

**Цель:** дать студенту 24/7 «coach» по конкретной теме (algo / sql / sysdesign / english) — параллельно живому тутору на Boosty, либо как полностью бесплатная альтернатива.

**Reuse-first принцип:** существующий `services/tutor` уже умеет приглашения, relationships, assignments, events, snapshots, briefs. AI-тутор — это просто `users.role='ai_tutor'` запись + персона + memory-слои.

**F1 Phase 2 (2026-05-12) update:** memory surfaces now visible end-to-end:
- `AITutorChatPage.tsx` CoachMemoryCard renders 5 slices: Goal · Readiness/Streak · Latest Cue session · Stats badge · Working summary
- `/profile/memory` page (`MemoryPage.tsx`) shows full coach_episodes list (paginated by kind) с soft-delete; AI больше не uses deleted entries
- Backend `intelligence.ListMemoryEntries` + `intelligence.DeleteMemoryEntry` UCs (migration 00094 added `coach_episodes.deleted_at`)
- F10 ingestion: Cue session.end → `coach_episodes` row (kind=cue_session) → visible в Recall и DailyBrief
- Markdown rendering for assistant messages (inline parser: bold/italic/code/links/lists, no heavy dep)

## Главная инженерная задача — память

Free-tier LLM context = 8-32k tokens. На длинной истории «всё в prompt» не работает. Нужен **многослойный memory** + compaction.

### 4 слоя памяти

| Слой | Что хранит | Хранение | Используется |
|---|---|---|---|
| **Episodic** | каждое сообщение raw (role, content, ts, model_used, tokens) | forever, audit-grade | для recall + compaction triggers |
| **Working** | текущий thread + rolling summary последних N exchanges | session-bound, перезаписывается на compaction | основной context для нового хода |
| **Semantic facts** | distilled выводы про студента («struggles with DP», «interview at Yandex 2026-05-15», «prefers Go») | persistent + decays | injected в каждый prompt |
| **Skill state** | progress по Atlas, mock-результаты, vocab queue | live derived | через `GetStudentSnapshot` (уже работает) |

### Compaction strategy

**Trigger:** каждые 10 exchanges OR > 4000 tokens в working set.

**Action:**
1. LLM вызывается с промптом «summarise last N turns into: (a) 3-5 bullet thread summary, (b) 0-3 student-specific facts с confidence 0..1»
2. New `ai_tutor_threads.summary_md` перезаписывает old working
3. New facts apsert'ятся в `ai_tutor_facts` (key/value/confidence/source_episode_id)
4. Old episodes ОСТАЮТСЯ в `ai_tutor_episodes` для аудита и ad-hoc recall

**Recall на новый ход:**
```
persona.prompt_template (~500 tk) +
top 5 facts ranked by (confidence DESC, last_used_at DESC) (~500 tk) +
thread.summary_md (~1000 tk) +
last 4 raw episodes (~2000 tk)
= ~4000 input + slot для ответа → fits Mistral 7B 8k easily
```

### Relevance ranking без embeddings

V1: простой SQL ORDER BY `(confidence * decay_factor) DESC, last_used_at DESC` — плоский ranking. Хватит на старт.

V2 (если станет узким): pgvector + локальная `bge-small-ru` для embedding. Бесплатно, на CPU. **Не делаем сразу.**

### Persona consistency

Persona — БД-row, не код:
```
ai_tutor_personas (
  id uuid pk,
  slug text unique,            -- 'algo-coach' / 'sql-mentor' / 'sysdesign-guru' / 'english-coach'
  display_name text,            -- «Алёша · алго-коуч»
  scope_track_kind text,        -- какой track курирует ('dev' / 'sql' / 'english' / ...)
  prompt_template text,         -- system prompt с {{snapshot}} / {{facts}} / {{summary}} плейсхолдерами
  pace_per_week int,            -- сколько assignments в неделю auto-генерит cron
  llm_task_kind text,           -- entry в llmchain TaskMap (TaskAITutorAlgo, TaskAITutorSQL...)
  active boolean
)
```

Админ редактирует через CMS → tune без релиза.

### Continuity на rosstart провайдера

Groq/Cerebras/Mistral — stateless. Никаких «conversation handles». Каждый ход — новый API call с восстановленным context из 4 слоёв.

**Crash или 503 от free-tier не теряет историю** — она в нашей БД. Это критично потому что на бесплатных провайдерах endpoints рутинно отваливаются.

### Honest tradeoff

LLM **забывает мелкие детали**. Compaction теряет nuance. Решение:

**Critical events** (interview date, named goal, specific weak topic) пишем как **explicit facts с confidence=1.0** — они выживают любую compaction. Они апсёртятся когда:
- Студент явно говорит факт («у меня собес в Яндекс 15 мая»)
- Студент явно делает выбор («хочу качать DP next»)
- Tutor LLM сам предложил и студент согласился

Mundane chitchat — может теряться, и это OK.

## Schema

```sql
-- 4 курируемые персоны (extendable админом)
CREATE TABLE ai_tutor_personas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text UNIQUE NOT NULL,
  display_name    text NOT NULL,
  scope_track_kind track_kind NOT NULL,
  prompt_template text NOT NULL,           -- с placeholder'ами {{snapshot}} / {{facts}} / {{summary}} / {{user_message}}
  pace_per_week   int  NOT NULL DEFAULT 3, -- сколько assignments cron генерит
  llm_task_kind   text NOT NULL,           -- entry в llmchain
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Чат-thread per (student, persona). 1:1 — каждая персона = свой thread.
CREATE TABLE ai_tutor_threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  persona_id      uuid NOT NULL REFERENCES ai_tutor_personas(id) ON DELETE RESTRICT,
  summary_md      text NOT NULL DEFAULT '',  -- rolling summary, перезаписывается compaction
  message_count   int  NOT NULL DEFAULT 0,
  last_compacted_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(student_id, persona_id)
);

-- Audit-grade episodic. Every message immutable row.
CREATE TABLE ai_tutor_episodes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       uuid NOT NULL REFERENCES ai_tutor_threads(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user','assistant','system','assignment','snapshot_inject')),
  content         text NOT NULL,
  model_used      text NOT NULL DEFAULT '',  -- 'groq:llama-3-70b' и т.п.
  tokens_in       int  NOT NULL DEFAULT 0,
  tokens_out      int  NOT NULL DEFAULT 0,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_tutor_episodes_thread_idx ON ai_tutor_episodes (thread_id, occurred_at);

-- Distilled facts с decay. Ключ — свободная строка, semantic.
CREATE TABLE ai_tutor_facts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       uuid NOT NULL REFERENCES ai_tutor_threads(id) ON DELETE CASCADE,
  fact_key        text NOT NULL,             -- 'goal', 'weak_topic', 'preferred_lang', 'interview_date'...
  fact_value      text NOT NULL,
  confidence      double precision NOT NULL DEFAULT 0.5, -- 0..1
  source_episode_id uuid REFERENCES ai_tutor_episodes(id) ON DELETE SET NULL,
  last_used_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(thread_id, fact_key)
);

CREATE INDEX ai_tutor_facts_recall_idx
  ON ai_tutor_facts (thread_id, confidence DESC, last_used_at DESC);
```

## Relationship через существующий tutor-сервис

**Adopt flow:**
1. Студент кликает «Adopt» на карточке `ai-tutor-personas/algo-coach`
2. Use case `AdoptAITutor`:
   - Если ai-tutor user в `users` ещё не создан — создать с `role='ai_tutor'`, `external_id=persona.slug`
   - Создать запись в `tutor_students` (student_id, tutor_id=ai-user.id)
   - Создать `ai_tutor_threads` (student_id, persona_id)
   - Послать первое welcome assignment через существующий `PushAssignment` UC
3. Студент видит AI-тутора в `ListMyTutors` (тот же endpoint что для human-tutors)

**Никаких новых RPC для list/snapshot/brief** — существующие работают. `tutor_id` в репо разрешается в ai-tutor-user, и это ОК.

## Новые use cases (3 штуки)

```go
// services/ai_tutor/app/

type AdoptAITutor struct {
  Users      domain.UserRepo
  Tutor      tutorDomain.Repo            // существующий
  Personas   domain.PersonaRepo
  Threads    domain.ThreadRepo
  Assignments tutorDomain.AssignmentRepo // существующий
  LLM        llmchain.Dispatcher
}

type SendMessage struct {
  Threads    domain.ThreadRepo
  Episodes   domain.EpisodeRepo
  Facts      domain.FactRepo
  Snapshot   tutorApp.GetStudentSnapshot // существующий
  LLM        llmchain.Dispatcher
}

// Cron-driven, dispatched раз в утро для всех active relationships.
type GenerateAssignment struct {
  // Reads snapshot, picks weakness, asks persona LLM to author 1 assignment,
  // pushes via existing tutor.PushAssignment.
}
```

## LLM dispatch

Через existing `llmchain` (Groq → Cerebras → Mistral → OpenRouter cascade). Новые task-kinds:
- `TaskAITutorChat` — основной chat-call, max ~1500 tk output
- `TaskAITutorCompact` — summarisation, max ~500 tk output
- `TaskAITutorAssignment` — гёнерит assignment в JSON (title + body_md + due_in_days), max ~800 tk

Все три mapped в `task_map.go` с одинаковым provider-cascade'ом — fallback chain reuse'ит существующую инфру.

## UI

### Marketplace
Рядом с human-tutor cards (Boosty) — карточки AI-тутора:
- Badge `AI · 24/7 · бесплатно`
- CTA «Adopt» вместо «Subscribe via Boosty»
- После adopt: redirect на `/tutor/ai/{slug}` (chat-page)

### `/tutor/ai/{slug}`
Чат-интерфейс. Левая панель — message log (paginated, lazy-load старых через episodes endpoint), input снизу. Sticky banner сверху: «Текущая тема: {fact_key=goal value}, weak: {fact_key=weak_topic value}» — даёт студенту чувство что AI его помнит.

### Hone surface
Без отдельного экрана. AI-тутор пушит assignments → они попадают в существующий [TaskBoard.tsx](../../hone/src/renderer/src/pages/TaskBoard.tsx) и calendar — точно как от human-тутора. Источник видим через `assignment.tutor_display_name = «Алёша (AI · алго)»`.

## Этап работы (3 дня)

**День 1 — schema + use cases:**
- Migration `ai_tutor_*` таблицы + 4 seeded personas
- Domain types + repos (Postgres)
- `AdoptAITutor` UC + welcome-assignment

**День 2 — chat flow + memory:**
- `SendMessage` UC (с recall + compaction triggers)
- LLM prompts (4 templates: chat / compact / extract-fact / generate-assignment)
- llmchain task entries
- Proto + RPC + REST aliases (`/api/v1/ai-tutor/{persona_slug}/messages` GET/POST, `/threads/{id}` GET, `/threads/{id}/compact` POST internal)

**День 3 — UI + cron:**
- `/marketplace` карточки AI-туторов
- `/tutor/ai/{slug}` chat page (frontend)
- Cron (через scheduled tasks или просто tick в bootstrap) для daily assignment generation
- Hone — показ assignment'ов от AI-тутора (без UI-изменений, source-name появится автоматически)

## Открытые design questions

- **Privacy:** студенческий контент на free-tier LLM. Provider'ы могут логировать. Решение: в onboarding AI-тутора — явная галочка «Я понимаю что content идёт через external LLM (Groq/Cerebras/Mistral)». Не отправляем emails / phone numbers (`memory.go` существующий уже PII-strips, использовать его).

- **Cost runaway:** free-tier есть лимиты. Per-student rate limit (e.g. 30 messages/day) — реализовать в `SendMessage` UC через простой counter `ai_tutor_threads.daily_msg_count` + `daily_msg_reset_date`.

- **Quality для русского:** Groq Llama 3 70B → норм, Mistral Large → норм, Cerebras Llama 3.1 → норм. На английском все. На русском Groq лучший. Cascade preference в task_map должна это учитывать.

- **Endgame** (когда AI-тутор «закрыл» тему): когда snapshot показывает что студент >80% mastery по scope_track_kind — AI-тутор сам шлёт «outgrowing» message и предлагает upgrade на human Boosty-тутора. Естественный funnel.
