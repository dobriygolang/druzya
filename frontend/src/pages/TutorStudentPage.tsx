// TutorStudentPage — Wave 2.6.
//
// Route: /tutor/students/:id
//
// Two-tab layout:
//   - Snapshot tab (default): aggregated 7-day view (focus min, mock count
//     + avg score, weak spots, notes count, last_active_at).
//   - Brief tab: same snapshot + LLM markdown narrative (~250 words RU).
//
// The brief is expensive (LLM round-trip) so we don't auto-fetch — only
// when the tutor opens the Brief tab. Stale-time 60s + window-focus refetch
// off so opening the page repeatedly doesn't burn provider quota.
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Check, Loader2 } from 'lucide-react'

import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ApiError } from '../lib/apiClient'
import {
  useArchiveAssignmentMutation,
  usePushAssignmentMutation,
  useSaveSessionNotesMutation,
  useSessionNotesQuery,
  useStudentBriefQuery,
  useStudentSnapshotQuery,
  useTutorAssignmentsQuery,
  type TutorAssignment,
  type TutorStudentSnapshot,
  type TutorWeakSpot,
} from '../lib/queries/tutor'

type Tab = 'snapshot' | 'brief' | 'assignments' | 'english' | 'notes'

export default function TutorStudentPage() {
  const { id: studentId } = useParams<{ id: string }>()
  const [tab, setTab] = useState<Tab>('snapshot')

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10 sm:px-8 sm:py-14">
        <header className="flex flex-col gap-2">
          <Link
            to="/tutor"
            className="font-mono text-[12px] tracking-[0.2em] text-text-muted hover:text-text-primary"
          >
            ← Tutor dashboard
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-text-muted">
            Student · {studentId ? studentId.slice(0, 8) : '—'}
          </span>
          <h1 className="font-display text-3xl font-bold leading-tight">
            Pre-session brief
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">
            Снимок активности студента за последние 7 дней. AI-бриф —
            сжатый Russian narrative для подготовки к 1:1.
          </p>
        </header>

        <div className="flex gap-2 border-b border-border">
          <TabButton active={tab === 'snapshot'} onClick={() => setTab('snapshot')}>
            Snapshot
          </TabButton>
          <TabButton active={tab === 'brief'} onClick={() => setTab('brief')}>
            AI brief
          </TabButton>
          <TabButton active={tab === 'assignments'} onClick={() => setTab('assignments')}>
            Assignments
          </TabButton>
          <TabButton active={tab === 'english'} onClick={() => setTab('english')}>
            English
          </TabButton>
          <TabButton active={tab === 'notes'} onClick={() => setTab('notes')}>
            Notes
          </TabButton>
        </div>

        {tab === 'snapshot' && <SnapshotPane studentId={studentId} />}
        {tab === 'brief' && <BriefPane studentId={studentId} />}
        {tab === 'assignments' && <AssignmentsPane studentId={studentId} />}
        {tab === 'english' && <EnglishPane studentId={studentId} />}
        {tab === 'notes' && <NotesPane studentId={studentId} />}
      </div>
    </div>
  )
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
        active
          ? 'border-text-primary text-text-primary'
          : 'border-transparent text-text-muted hover:text-text-secondary'
      }`}
    >
      {children}
    </button>
  )
}

// ── Snapshot pane ──────────────────────────────────────────────────────

function SnapshotPane({ studentId }: { studentId: string | undefined }) {
  const q = useStudentSnapshotQuery(studentId)

  if (!studentId) return <ErrorCard message="Student id не указан в URL." />
  if (q.isPending) return <PendingCard label="Загружаем snapshot…" />
  if (q.isError) {
    const status = q.error instanceof ApiError ? q.error.status : 0
    return (
      <ErrorCard
        message={
          status === 403 || status === 404
            ? 'Этот студент не привязан к тебе. Проверь, что он принял инвайт.'
            : 'Не удалось загрузить snapshot.'
        }
      />
    )
  }
  if (!q.data) return null

  return <SnapshotBody snapshot={q.data} />
}

function SnapshotBody({ snapshot }: { snapshot: TutorStudentSnapshot }) {
  const lastActive = snapshot.last_active_at
    ? formatRelative(snapshot.last_active_at)
    : '—'
  const avgScore =
    snapshot.english_mocks_count > 0 ? snapshot.english_mocks_avg_score : null
  const lastScore =
    snapshot.english_mocks_count > 0 ? snapshot.english_mocks_last_score : null

  return (
    <section className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Last active" value={lastActive} />
        <Stat label="Focus min" value={String(snapshot.focus_minutes_window)} />
        <Stat
          label="Sessions"
          value={String(snapshot.focus_sessions_count)}
          sub={snapshot.window_days ? `за ${snapshot.window_days}d` : ''}
        />
        <Stat label="Notes" value={String(snapshot.notes_count)} />
      </div>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          English mocks
        </div>
        {snapshot.english_mocks_count === 0 ? (
          <p className="text-sm text-text-secondary">
            За окно нет ни одного HR-мока. Предложи на сессии запустить первый.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Count" value={String(snapshot.english_mocks_count)} />
            <Stat
              label="Avg"
              value={avgScore !== null ? `${avgScore}/100` : '—'}
              tier={avgScore !== null ? scoreTier(avgScore) : undefined}
            />
            <Stat
              label="Last"
              value={lastScore !== null ? `${lastScore}/100` : '—'}
              tier={lastScore !== null ? scoreTier(lastScore) : undefined}
            />
          </div>
        )}
      </Card>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          English-track activity (Hone)
        </div>
        {hasNoEnglishActivity(snapshot) ? (
          <p className="text-sm text-text-secondary">
            Студент пока не пользовался Hone-английским (Reading / Listening / vocab).
            На сессии можно показать как загружать материалы — hotkey R / L.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Reading min"
                value={String(snapshot.reading_minutes_window)}
                sub={snapshot.window_days ? `за ${snapshot.window_days}d` : ''}
              />
              <Stat
                label="Reading sess"
                value={String(snapshot.reading_sessions_count)}
                sub={snapshot.window_days ? `за ${snapshot.window_days}d` : ''}
              />
              <Stat
                label="Library"
                value={String(snapshot.reading_materials_total)}
                sub="всего"
              />
              <Stat
                label="Listening"
                value={String(snapshot.listening_materials_total)}
                sub="всего"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat
                label="Vocab queue"
                value={String(snapshot.vocab_queue_total)}
                sub="active"
              />
              <Stat
                label="Due today"
                value={String(snapshot.vocab_due_today)}
                tier={snapshot.vocab_due_today > 0 ? 'mid' : undefined}
              />
              <Stat
                label="Graded summaries"
                value={String(snapshot.writing_grades_count)}
                sub={snapshot.window_days ? `за ${snapshot.window_days}d` : ''}
              />
            </div>
          </>
        )}
      </Card>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          Weak spots {snapshot.weak_spots.length > 0 ? `· ${snapshot.weak_spots.length}` : ''}
        </div>
        {snapshot.weak_spots.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Atlas-узлов с низким прогрессом нет. Хороший знак — либо студент
            держит средний-выше-50, либо недостаточно данных.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshot.weak_spots.map((w) => (
              <WeakSpotRow key={w.node_key} spot={w} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  )
}

// True iff every English-track activity counter is zero. Lets us replace
// the «5 zeros across 7 stats» grid with a one-line «not yet engaged»
// message — saves the tutor's eyes when a brand-new student loads.
function hasNoEnglishActivity(s: TutorStudentSnapshot): boolean {
  return (
    s.reading_sessions_count === 0 &&
    s.reading_minutes_window === 0 &&
    s.reading_materials_total === 0 &&
    s.writing_grades_count === 0 &&
    s.listening_materials_total === 0 &&
    s.vocab_queue_total === 0 &&
    s.vocab_due_today === 0
  )
}

function WeakSpotRow({ spot }: { spot: TutorWeakSpot }) {
  return (
    <li className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-text-primary truncate">{spot.title || spot.node_key}</div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          {spot.node_key}
        </div>
      </div>
      <ProgressBar progress={spot.progress} />
    </li>
  )
}

function ProgressBar({ progress }: { progress: number }) {
  const tier = scoreTier(progress)
  const color =
    tier === 'strong' ? 'bg-success' : tier === 'mid' ? 'bg-warn' : 'bg-danger'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full ${color}`}
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-text-muted w-8 text-right">
        {progress}
      </span>
    </div>
  )
}

// ── Brief pane ─────────────────────────────────────────────────────────

function BriefPane({ studentId }: { studentId: string | undefined }) {
  const q = useStudentBriefQuery(studentId)

  if (!studentId) return <ErrorCard message="Student id не указан в URL." />
  if (q.isPending) return <PendingCard label="Готовим бриф (это может занять до 30 сек)…" />
  if (q.isError) {
    const status = q.error instanceof ApiError ? q.error.status : 0
    return (
      <ErrorCard
        message={
          status === 403 || status === 404
            ? 'Этот студент не привязан к тебе.'
            : 'Не удалось сгенерировать бриф.'
        }
      />
    )
  }
  if (!q.data) return null

  const { snapshot, brief } = q.data

  return (
    <section className="flex flex-col gap-5">
      <SnapshotBody snapshot={snapshot} />
      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
            AI narrative
          </div>
          <button
            type="button"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            className="rounded-md border border-border bg-surface-2 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-text-primary hover:text-text-primary disabled:opacity-50"
          >
            {q.isFetching ? 'Обновляем…' : 'Обновить'}
          </button>
        </div>
        {brief.trim() === '' ? (
          <p className="text-sm text-text-secondary">
            LLM-чейн временно недоступен (или отключён в этом окружении). Snapshot
            выше — основа для подготовки.
          </p>
        ) : (
          // Brief is markdown; we render whitespace-preserving plain-text
          // for MVP. A full markdown renderer (react-markdown) brings ~30KB
          // for a feature only tutors see — добавим если станет важно.
          <pre className="whitespace-pre-wrap font-sans text-[14px] leading-relaxed text-text-primary">
            {brief}
          </pre>
        )}
      </Card>
    </section>
  )
}

// ── Atoms ──────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  sub,
  tier,
}: {
  label: string
  value: string
  sub?: string
  tier?: 'strong' | 'mid' | 'weak'
}) {
  const valueColor =
    tier === 'strong'
      ? 'text-success'
      : tier === 'mid'
        ? 'text-warn'
        : tier === 'weak'
          ? 'text-danger'
          : 'text-text-primary'
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`mt-0.5 text-base tabular-nums ${valueColor}`}>{value}</div>
      {sub && <div className="font-mono text-[9px] text-text-muted">{sub}</div>}
    </div>
  )
}

function PendingCard({ label }: { label: string }) {
  return (
    <Card className="flex-row items-center gap-2 p-4 text-text-secondary" interactive={false}>
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">{label}</span>
    </Card>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Card className="flex-col gap-1 border-danger/40 bg-danger/5 p-4" interactive={false}>
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-danger">Ошибка</div>
      <p className="text-[13px] leading-relaxed text-text-secondary">{message}</p>
    </Card>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────

function scoreTier(score: number): 'strong' | 'mid' | 'weak' {
  if (score >= 70) return 'strong'
  if (score >= 40) return 'mid'
  return 'weak'
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const ms = Date.now() - d.getTime()
  if (ms < 60_000) return 'только что'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m} мин назад`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч назад`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days} d назад`
  return d.toLocaleDateString()
}

// ── Assignments pane (Wave 5.1) ────────────────────────────────────────

function AssignmentsPane({ studentId }: { studentId: string | undefined }) {
  if (!studentId) return <ErrorCard message="Student id не указан в URL." />
  return (
    <section className="flex flex-col gap-4">
      <PushAssignmentForm studentId={studentId} />
      <AssignmentsList studentId={studentId} />
    </section>
  )
}

function PushAssignmentForm({ studentId }: { studentId: string }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [due, setDue] = useState('')
  const push = usePushAssignmentMutation(studentId)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const titleTrim = title.trim()
    if (!titleTrim) return
    // <input type="datetime-local"> emits a TZ-naive string; coerce to ISO
    // assuming the local timezone — the backend stores TZ-aware UTC.
    const dueISO = due ? new Date(due).toISOString() : undefined
    push.mutate(
      { title: titleTrim, body_md: body.trim(), due_at: dueISO },
      {
        onSuccess: () => {
          setTitle('')
          setBody('')
          setDue('')
        },
      },
    )
  }

  return (
    <Card className="flex-col gap-3 p-4" interactive={false}>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
        Push assignment
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Read chapter 4 — The Black Swan"
          maxLength={240}
          className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
          required
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Optional: instructions, links, focus questions…"
          rows={4}
          maxLength={8000}
          className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
        />
        <label className="flex items-center gap-3 text-sm text-text-secondary">
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted shrink-0">
            Due (optional)
          </span>
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="rounded-md border border-border bg-surface-2 px-2 py-1 text-sm text-text-primary"
          />
        </label>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={push.isPending || title.trim() === ''}>
            {push.isPending ? 'Отправляем…' : 'Push to student'}
          </Button>
          {push.isError && (
            <span className="text-[12px] text-danger">
              {push.error instanceof ApiError ? push.error.body : 'Не получилось'}
            </span>
          )}
        </div>
      </form>
    </Card>
  )
}

function AssignmentsList({ studentId }: { studentId: string }) {
  const q = useTutorAssignmentsQuery(studentId)
  const archive = useArchiveAssignmentMutation(studentId)

  if (q.isPending) return <PendingCard label="Загружаем…" />
  if (q.isError) return <ErrorCard message="Не удалось загрузить assignments." />

  const items = q.data?.items ?? []
  if (items.length === 0) {
    return (
      <Card className="flex-col gap-1 p-4" interactive={false}>
        <p className="text-[13px] leading-relaxed text-text-secondary">
          Ни одного assignment ещё не отправлено. Заполни форму выше и нажми Push.
        </p>
      </Card>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((a) => (
        <li key={a.id}>
          <AssignmentRow
            assignment={a}
            onArchive={() => archive.mutate(a.id)}
            archiving={archive.isPending}
          />
        </li>
      ))}
    </ul>
  )
}

function AssignmentRow({
  assignment,
  onArchive,
  archiving,
}: {
  assignment: TutorAssignment
  onArchive: () => void
  archiving: boolean
}) {
  const status = assignmentStatus(assignment)
  const statusBadge =
    status === 'completed'
      ? { label: '✓ done', cls: 'border-success/40 bg-success/10 text-success' }
      : status === 'archived'
        ? { label: 'archived', cls: 'border-border bg-surface-2 text-text-muted' }
        : status === 'overdue'
          ? { label: 'overdue', cls: 'border-danger/40 bg-danger/10 text-danger' }
          : { label: 'open', cls: 'border-warn/40 bg-warn/10 text-warn' }

  return (
    <Card
      className={`flex-col gap-2 p-4 ${status === 'archived' ? 'opacity-60' : ''}`}
      interactive={false}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-text-primary">{assignment.title}</div>
          {assignment.body_md && (
            <pre className="mt-1 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-text-secondary">
              {assignment.body_md}
            </pre>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${statusBadge.cls}`}
        >
          {statusBadge.label}
        </span>
      </div>
      <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-text-muted">
        {assignment.due_at && (
          <span>due {new Date(assignment.due_at).toLocaleDateString()}</span>
        )}
        {assignment.created_at && (
          <span>· created {formatRelative(assignment.created_at)}</span>
        )}
        {status === 'open' || status === 'overdue' ? (
          <button
            type="button"
            onClick={onArchive}
            disabled={archiving}
            className="ml-auto rounded-md border border-warn/40 bg-warn/5 px-2 py-0.5 text-warn hover:bg-warn/10 disabled:opacity-50"
          >
            Архивировать
          </button>
        ) : null}
      </div>
    </Card>
  )
}

function assignmentStatus(a: TutorAssignment): 'open' | 'overdue' | 'completed' | 'archived' {
  if (a.archived_at) return 'archived'
  if (a.completed_at) return 'completed'
  if (a.due_at && new Date(a.due_at).getTime() < Date.now()) return 'overdue'
  return 'open'
}

// ── English pane (Wave pivot 2026-05-03) ──────────────────────────────
//
// Тутор-side focused dashboard для English-track студента. Reads existing
// TutorStudentSnapshot и показывает ТОЛЬКО English axes (Reading /
// Vocabulary / Writing / Listening / English mocks) — без шума focus
// minutes / weak spots / notes которые на Snapshot tab.
//
// Если студент пока не пользовался Hone-английским — показываем onboarding
// hints для тутора («покажи как загрузить материал hotkey R»).

function EnglishPane({ studentId }: { studentId: string | undefined }) {
  const q = useStudentSnapshotQuery(studentId)
  if (!studentId) return <ErrorCard message="Student id не указан в URL." />
  if (q.isPending) return <PendingCard label="Загружаем English-снапшот…" />
  if (q.isError) {
    const status = q.error instanceof ApiError ? q.error.status : 0
    return (
      <ErrorCard
        message={
          status === 403 || status === 404
            ? 'Этот студент не привязан к тебе.'
            : 'Не удалось загрузить snapshot.'
        }
      />
    )
  }
  if (!q.data) return null
  const s = q.data
  const window = s.window_days ? `за ${s.window_days}d` : ''
  const noActivity =
    s.reading_minutes_window === 0 &&
    s.reading_materials_total === 0 &&
    s.listening_materials_total === 0 &&
    s.vocab_queue_total === 0 &&
    s.writing_grades_count === 0 &&
    s.english_mocks_count === 0

  return (
    <section className="flex flex-col gap-4">
      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          English mocks (HR)
        </div>
        {s.english_mocks_count === 0 ? (
          <p className="text-sm text-text-secondary">
            Нет HR-моков за окно. На сессии — предложи запустить первый.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Count" value={String(s.english_mocks_count)} />
            <Stat
              label="Avg"
              value={`${s.english_mocks_avg_score}/100`}
              tier={scoreTier(s.english_mocks_avg_score)}
            />
            <Stat
              label="Last"
              value={`${s.english_mocks_last_score}/100`}
              tier={scoreTier(s.english_mocks_last_score)}
            />
          </div>
        )}
      </Card>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          Reading
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Минут" value={String(s.reading_minutes_window)} sub={window} />
          <Stat label="Sessions" value={String(s.reading_sessions_count)} sub={window} />
          <Stat label="Library" value={String(s.reading_materials_total)} sub="всего материалов" />
        </div>
      </Card>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          Vocabulary (SRS)
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="В очереди" value={String(s.vocab_queue_total)} />
          <Stat label="Due сегодня" value={String(s.vocab_due_today)} />
        </div>
      </Card>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          Writing & Listening
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Writing grades" value={String(s.writing_grades_count)} sub={window} />
          <Stat label="Listening lib" value={String(s.listening_materials_total)} sub="всего" />
        </div>
      </Card>

      {noActivity && (
        <div className="rounded-xl border border-warn/30 bg-warn/5 p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-warn">
            Студент пока не пользуется Hone English
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
            На сессии покажи hotkey'и: <b>R</b> (Reading), <b>L</b> (Listening). Загружай
            paste/PDF/URL — кликом на слово сохраняется vocab. Через <b>Reading library</b>
            на dashboard'е можешь шарнуть материалы сразу всем студентам.
          </p>
        </div>
      )}
    </section>
  )
}

// ── Notes pane (Phase 3.3) ─────────────────────────────────────────────
//
// Tutor's private notepad для каждого студента: «работали над present
// perfect, дома — IELTS task 1». Студент свои notes не видит. Auto-save
// по дебаунсу 1.5s от последнего keystroke. Empty body разрешён.
function NotesPane({ studentId }: { studentId: string | undefined }) {
  const q = useSessionNotesQuery(studentId)
  const m = useSaveSessionNotesMutation(studentId)
  const [draft, setDraft] = useState<string>('')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  // Initialise draft из server state — только один раз когда query
  // зарезолвилась. Дальнейшие сетевые ответы не перетирают локальное
  // состояние (избегаем «прыжка» каретки во время typing'а).
  const initRef = useRef(false)
  useEffect(() => {
    if (initRef.current) return
    if (q.data) {
      setDraft(q.data.body_md ?? '')
      setSavedAt(q.data.updated_at ?? null)
      initRef.current = true
    }
  }, [q.data])

  // Debounced auto-save. mountedRef защищает setSavedAt от вызова на
  // unmounted-компоненте (если юзер перешёл на другую вкладку/студента
  // в момент in-flight PUT) — иначе React выдаст warning.
  const lastSavedBody = useRef<string>('')
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  useEffect(() => {
    if (!initRef.current) return
    if (draft === lastSavedBody.current) return
    const t = setTimeout(() => {
      lastSavedBody.current = draft
      m.mutate(draft, {
        onSuccess: (res) => {
          if (!mountedRef.current) return
          setSavedAt(res.updated_at ?? new Date().toISOString())
        },
      })
    }, 1500)
    return () => clearTimeout(t)
    // m намеренно не в deps — он стабилен per-render (react-query),
    // включение спровоцирует бесконечную re-debounce-петлю.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  if (!studentId) return <ErrorCard message="Student id не указан в URL." />
  if (q.isPending) return <PendingCard label="Загружаем notes…" />
  if (q.isError) {
    const status = q.error instanceof ApiError ? q.error.status : 0
    return (
      <ErrorCard
        message={
          status === 403
            ? 'Этот студент не привязан к тебе.'
            : 'Не удалось загрузить notes.'
        }
      />
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
            Личные заметки тутора
          </div>
          <SaveStatus pending={m.isPending} savedAt={savedAt} />
        </div>
        <p className="text-[12px] leading-relaxed text-text-secondary">
          Только для тебя. Студент эти заметки не видит. Markdown поддерживается
          (заголовки, списки, **bold**). Auto-save раз в 1.5 секунды.
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={16}
          placeholder={
            '## 2026-05-04 1:1\n- Прошли present perfect (текущая боль — for/since)\n- Домашка: IELTS task 1, 2 примера\n- Запросил TED talk на B2 уровне\n'
          }
          className="w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[13px] leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </Card>
    </section>
  )
}

function SaveStatus({
  pending,
  savedAt,
}: {
  pending: boolean
  savedAt: string | null
}) {
  if (pending) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
        <Loader2 className="h-3 w-3 animate-spin" /> save…
      </span>
    )
  }
  if (!savedAt) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
        не сохранено
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
      <Check className="h-3 w-3 text-accent" /> {formatRelative(savedAt)}
    </span>
  )
}
