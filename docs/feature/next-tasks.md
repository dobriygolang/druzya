# Next tasks — приоритезированный план (2026-05-01 sunset)

Последние решения Sergey'я перед context-limit:
- Hone разграничение + добавить mode `go` к dev/ml/english
- External progress logging — НЕ через чат (плохая ассоциация с GPT), structured form в Hone
- AI-tutor нужно внедрить smart, не как отдельную страницу
- Auto-assignment с дедлайном в TaskBoard
- Внедрить новые штуки в intelligence (он «мозг»)

## 1. Hone active study mode + sub-mode `go` (1.5 дня)
Файлы:
- Migration `00035_hone_active_track.sql` — `hone_user_settings.active_track text`
- `services/hone/domain/settings.go` + Update use case
- Frontend Hone header dropdown: general / dev / ml / english / go
- Filter в Today / Tasks / Reading queries по active_track
- AI-tutor thread фильтруется тоже (показываем thread персоны соответствующей track'у)

Acceptance: Sergey переключается на mode=`go` → Hone показывает только dev-related контент с Go-flavoured AI-tutor (новая персона `go-coach`?)

**Открытый вопрос:** добавить новую AI-tutor персону `go-coach` или mode=`go` использует `algo-coach` с filter'ом по Go-task'ам?

## 2. AI-tutor inline contextual chat-pill (2 дня)
- `<AICoachPill personaSlug topic context={...} />` компонент
- Mounted на:
  - `/atlas/{node_slug}` — context = «студент изучает {node.title}, progress {pct}%»
  - `MockResultPage` — context = «failed Q3 — leakage. weak spots: {weak[]}»
  - `HoneReading` reading-mode — selected text → «объясни этот абзац»
- Под капотом: adopt + thread + pre-pended `system`-episode с context
- Минимизировать assoc с GPT — pill стилем «coach», не chatbot. Открывается inline drawer не full-page

## 3. External activity logging — structured form (2 дня)
- Migration `00036_external_activity.sql`:
```sql
CREATE TABLE external_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source text NOT NULL,             -- 'leetcode' / 'coursera' / 'youtube' / 'book' / 'other'
  topic_atlas_node_id text,         -- nullable; FK to atlas_nodes(id) when atlas-mapped
  topic_free_text text NOT NULL DEFAULT '', -- raw label если не из atlas
  duration_min int NOT NULL CHECK (duration_min > 0),
  notes text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_external_activity_user_date ON external_activity (user_id, occurred_at DESC);
```
- Hone surface: новая кнопка «+ занятие» на Today / Stats
- Modal с form:
  - Source: dropdown (8 вариантов hard-coded)
  - Topic: autocomplete query → atlas_nodes ORDER BY similarity (используй pg_trgm если есть, иначе LIKE на title)
  - Duration: numeric (5-480)
  - Notes: optional textarea
- Submit:
  - INSERT в `external_activity`
  - Bump `user_atlas_nodes.progress` на узле (если topic_atlas_node_id != null)
  - Создать `coach_episodes` row с kind='external_activity' для intelligence recall (background, не показывается)
- Stats page: новый табик «External activity» — log с фильтром по source/track

## 4. Intelligence integration (1 день)
- `intelligence/app/snapshot.go` — расширить snapshot:
  - `external_minutes_window int` (sum over duration_min last 7 days)
  - `external_sources []string` (distinct sources)
  - `external_top_topics []string` (top-3 atlas-node titles)
- `intelligence/app/daily_brief.go` — добавить упоминание external activity в narrative
- `services/ai_tutor` SnapshotProvider adapter (сейчас stub) → реальный, берёт snapshot из intelligence
- В AI-tutor recall теперь top-5 facts + snapshot text (включая external activity) + summary + last 4 turns

## 5. Auto-assignment due_at → Hone TaskBoard (0.5 дня)
- Проверить уже работает: `tutor.PushAssignment` → assignment с `due_at` → student-side `ListPendingAssignments` → Hone TaskBoard?
- Если loop работает — добавить визуальный countdown/deadline на assignment-card в Hone
- Если не работает — найти dropped wire и починить
- Notification: за 24h до deadline → push в `notify` service

## 6. AI-tutor proactive triggers — после mock (1 день)
- В `ai_mock` finalize-сессии event: если overall_score < 70 → `ai_tutor.OnFailedMock(weak_spots)` 
- Use case `OnFailedMock`:
  - Find student's adopted persona в scope_track_kind matching mock section
  - Append `system`-episode «Завалил mock {section}, weak: {topics}»
  - Generate assignment через `TaskAITutorAssignment` LLM call
  - Push через `tutor.PushAssignment` UC (relationship уже есть после adopt)
  - Assignment due_at = now() + 3 days
- Cross-service event через EventBus

## 7. English tutor↔student polish (2 дня)
- Tutor settings tab «Reading library» — pool of materials shareable to students
- Student-side: автоматически видит материалы тутора в Hone Reading
- Onboarding wizard для тутора при первом /tutor visit — 4-step explanation + invite-code generator + QR

## Verify rules (always)
- `make generate` после proto changes
- `make lint` всё green
- frontend tsc + hone tsc + cue tsc = 0
- monolith build + tests
