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
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation('tutor')

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10 sm:px-8 sm:py-14">
        <header className="flex flex-col gap-2">
          <Link
            to="/tutor"
            className="font-mono text-[12px] tracking-[0.08em] text-text-muted transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:text-text-primary"
          >
            {`← ${t('student.back_link')}`}
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            {t('student.header_eyebrow', { id: studentId ? studentId.slice(0, 8) : '—' })}
          </span>
          <h1 className="font-display text-3xl font-bold leading-tight">
            {t('student.title')}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">
            {t('student.subtitle')}
          </p>
        </header>

        <div className="flex gap-2 border-b border-border">
          <TabButton active={tab === 'snapshot'} onClick={() => setTab('snapshot')}>
            {t('student.tab_snapshot')}
          </TabButton>
          <TabButton active={tab === 'brief'} onClick={() => setTab('brief')}>
            {t('student.tab_brief')}
          </TabButton>
          <TabButton active={tab === 'assignments'} onClick={() => setTab('assignments')}>
            {t('student.tab_assignments')}
          </TabButton>
          <TabButton active={tab === 'english'} onClick={() => setTab('english')}>
            {t('student.tab_english')}
          </TabButton>
          <TabButton active={tab === 'notes'} onClick={() => setTab('notes')}>
            {t('student.tab_notes')}
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
      aria-pressed={active}
      className={`relative -mb-px border-b-2 px-3 py-2 text-sm transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] ${
        active
          ? 'border-text-primary text-text-primary'
          : 'border-transparent text-text-muted hover:text-text-secondary'
      }`}
    >
      {active && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 8,
            top: 6,
            width: 1.5,
            height: 14,
            background: 'var(--red)',
          }}
        />
      )}
      {children}
    </button>
  )
}

// ── Snapshot pane ──────────────────────────────────────────────────────

function SnapshotPane({ studentId }: { studentId: string | undefined }) {
  const q = useStudentSnapshotQuery(studentId)
  const { t } = useTranslation('tutor')

  if (!studentId) return <ErrorCard message={t('common.student_id_missing')} />
  if (q.isPending) return <PendingCard label={t('student.snapshot_loading')} />
  if (q.isError) {
    const status = q.error instanceof ApiError ? q.error.status : 0
    return (
      <ErrorCard
        message={
          status === 403 || status === 404
            ? t('common.student_not_attached')
            : t('student.snapshot_load_fail')
        }
      />
    )
  }
  if (!q.data) return null

  return <SnapshotBody snapshot={q.data} />
}

function SnapshotBody({ snapshot }: { snapshot: TutorStudentSnapshot }) {
  const { t } = useTranslation('tutor')
  const lastActive = snapshot.last_active_at
    ? formatRelative(snapshot.last_active_at, t)
    : '—'
  const avgScore =
    snapshot.english_mocks_count > 0 ? snapshot.english_mocks_avg_score : null
  const lastScore =
    snapshot.english_mocks_count > 0 ? snapshot.english_mocks_last_score : null
  const windowSub = snapshot.window_days
    ? t('student.stat_window_days', { n: snapshot.window_days })
    : ''

  return (
    <section className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t('student.stat_last_active')} value={lastActive} />
        <Stat label={t('student.stat_focus_min')} value={String(snapshot.focus_minutes_window)} />
        <Stat
          label={t('student.stat_sessions')}
          value={String(snapshot.focus_sessions_count)}
          sub={windowSub}
        />
        <Stat label={t('student.stat_notes')} value={String(snapshot.notes_count)} />
      </div>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('student.english_mocks_header')}
        </div>
        {snapshot.english_mocks_count === 0 ? (
          <p className="text-sm text-text-secondary">
            {t('student.english_mocks_empty')}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <Stat label={t('student.stat_count')} value={String(snapshot.english_mocks_count)} />
            <Stat
              label={t('student.stat_avg')}
              value={avgScore !== null ? `${avgScore}/100` : '—'}
              tier={avgScore !== null ? scoreTier(avgScore) : undefined}
            />
            <Stat
              label={t('student.stat_last')}
              value={lastScore !== null ? `${lastScore}/100` : '—'}
              tier={lastScore !== null ? scoreTier(lastScore) : undefined}
            />
          </div>
        )}
      </Card>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('student.english_activity_header')}
        </div>
        {hasNoEnglishActivity(snapshot) ? (
          <p className="text-sm text-text-secondary">
            {t('student.english_activity_empty')}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label={t('student.stat_reading_min')}
                value={String(snapshot.reading_minutes_window)}
                sub={windowSub}
              />
              <Stat
                label={t('student.stat_reading_sess')}
                value={String(snapshot.reading_sessions_count)}
                sub={windowSub}
              />
              <Stat
                label={t('student.stat_library')}
                value={String(snapshot.reading_materials_total)}
                sub={t('student.stat_library_total')}
              />
              <Stat
                label={t('student.stat_listening')}
                value={String(snapshot.listening_materials_total)}
                sub={t('student.stat_library_total')}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat
                label={t('student.stat_vocab_queue')}
                value={String(snapshot.vocab_queue_total)}
                sub={t('student.stat_vocab_queue_sub')}
              />
              <Stat
                label={t('student.stat_due_today')}
                value={String(snapshot.vocab_due_today)}
                tier={snapshot.vocab_due_today > 0 ? 'mid' : undefined}
              />
              <Stat
                label={t('student.stat_graded_summaries')}
                value={String(snapshot.writing_grades_count)}
                sub={windowSub}
              />
            </div>
          </>
        )}
      </Card>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('student.weak_spots_header')} {snapshot.weak_spots.length > 0 ? `· ${snapshot.weak_spots.length}` : ''}
        </div>
        {snapshot.weak_spots.length === 0 ? (
          <p className="text-sm text-text-secondary">
            {t('student.weak_spots_empty')}
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
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
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
  const { t } = useTranslation('tutor')

  if (!studentId) return <ErrorCard message={t('common.student_id_missing')} />
  if (q.isPending) return <PendingCard label={t('student.brief_loading')} />
  if (q.isError) {
    const status = q.error instanceof ApiError ? q.error.status : 0
    return (
      <ErrorCard
        message={
          status === 403 || status === 404
            ? t('common.student_not_attached_short')
            : t('student.brief_load_fail')
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
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {t('student.ai_narrative_header')}
          </div>
          <button
            type="button"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
            className="rounded-md border border-border bg-surface-2 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:border-text-primary hover:text-text-primary disabled:opacity-50"
          >
            {q.isFetching ? t('student.ai_refreshing') : t('student.ai_refresh_btn')}
          </button>
        </div>
        {brief.trim() === '' ? (
          <p className="text-sm text-text-secondary">
            {t('student.ai_empty')}
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
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">{label}</div>
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
  const { t } = useTranslation('tutor')
  return (
    <Card className="flex-row items-start gap-3 p-4" interactive={false}>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 1.5,
          minHeight: 36,
          background: 'var(--red)',
          marginTop: 2,
          flex: '0 0 auto',
        }}
      />
      <div className="flex flex-1 flex-col gap-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--red)' }}>
          {t('common.error_title')}
        </div>
        <p className="text-[13px] leading-relaxed text-text-secondary">{message}</p>
      </div>
    </Card>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────

function scoreTier(score: number): 'strong' | 'mid' | 'weak' {
  if (score >= 70) return 'strong'
  if (score >= 40) return 'mid'
  return 'weak'
}

type TutorT = ReturnType<typeof useTranslation<'tutor'>>['t']

function formatRelative(iso: string, t: TutorT): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const ms = Date.now() - d.getTime()
  if (ms < 60_000) return t('student.rel_just_now')
  const m = Math.floor(ms / 60_000)
  if (m < 60) return t('student.rel_min_ago', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('student.rel_h_ago', { n: h })
  const days = Math.floor(h / 24)
  if (days < 7) return t('student.rel_d_ago', { n: days })
  return d.toLocaleDateString()
}


function AssignmentsPane({ studentId }: { studentId: string | undefined }) {
  const { t } = useTranslation('tutor')
  if (!studentId) return <ErrorCard message={t('common.student_id_missing')} />
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
  const { t } = useTranslation('tutor')

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
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        {t('student.assignments_push_header')}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('student.field_title_placeholder')}
          maxLength={240}
          className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] placeholder:text-text-muted focus:border-[rgb(var(--ink))]"
          required
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('student.field_body_placeholder')}
          rows={4}
          maxLength={8000}
          className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] placeholder:text-text-muted focus:border-[rgb(var(--ink))]"
        />
        <label className="flex items-center gap-3 text-sm text-text-secondary">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted shrink-0">
            {t('student.field_due_label')}
          </span>
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="border-b border-[var(--hair-2)] bg-transparent px-1 py-1 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] focus:border-[rgb(var(--ink))]"
          />
        </label>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={push.isPending || title.trim() === ''}>
            {push.isPending ? t('student.btn_submit_sending') : t('student.btn_submit_push')}
          </Button>
          {push.isError && (
            <span className="text-[12px] text-danger">
              {push.error instanceof ApiError ? push.error.body : t('common.not_received')}
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
  const { t } = useTranslation('tutor')

  if (q.isPending) return <PendingCard label={t('common.loading')} />
  if (q.isError) return <ErrorCard message={t('student.assignments_load_fail')} />

  const items = q.data?.items ?? []
  if (items.length === 0) {
    return (
      <Card className="flex-col gap-1 p-4" interactive={false}>
        <p className="text-[13px] leading-relaxed text-text-secondary">
          {t('student.assignments_empty')}
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
  const { t } = useTranslation('tutor')
  const status = assignmentStatus(assignment)
  const statusBadge =
    status === 'completed'
      ? { label: t('student.badge_done'), cls: 'border-success/40 bg-success/10 text-success' }
      : status === 'archived'
        ? { label: t('student.badge_archived'), cls: 'border-border bg-surface-2 text-text-muted' }
        : status === 'overdue'
          ? { label: t('student.badge_overdue'), cls: 'border-danger/40 bg-danger/10 text-danger' }
          : { label: t('student.badge_open'), cls: 'border-warn/40 bg-warn/10 text-warn' }

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
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${statusBadge.cls}`}
        >
          {statusBadge.label}
        </span>
      </div>
      <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        {assignment.due_at && (
          <span>{t('student.assignment_due', { date: new Date(assignment.due_at).toLocaleDateString() })}</span>
        )}
        {assignment.created_at && (
          <span>{t('student.assignment_created', { rel: formatRelative(assignment.created_at, t) })}</span>
        )}
        {status === 'open' || status === 'overdue' ? (
          <button
            type="button"
            onClick={onArchive}
            disabled={archiving}
            className="ml-auto rounded-md border border-warn/40 bg-warn/5 px-2 py-0.5 text-warn transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:bg-warn/10 disabled:opacity-50"
          >
            {t('student.btn_archive')}
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

// Тутор-side focused dashboard для English-track студента. Reads existing
// TutorStudentSnapshot и показывает ТОЛЬКО English axes (Reading /
// Vocabulary / Writing / Listening / English mocks) — без шума focus
// minutes / weak spots / notes которые на Snapshot tab.
//
// Если студент пока не пользовался Hone-английским — показываем onboarding
// hints для тутора («покажи как загрузить материал hotkey R»).

function EnglishPane({ studentId }: { studentId: string | undefined }) {
  const q = useStudentSnapshotQuery(studentId)
  const { t } = useTranslation('tutor')
  if (!studentId) return <ErrorCard message={t('common.student_id_missing')} />
  if (q.isPending) return <PendingCard label={t('student.english_pane_loading')} />
  if (q.isError) {
    const status = q.error instanceof ApiError ? q.error.status : 0
    return (
      <ErrorCard
        message={
          status === 403 || status === 404
            ? t('common.student_not_attached_short')
            : t('student.snapshot_load_fail')
        }
      />
    )
  }
  if (!q.data) return null
  const s = q.data
  const windowLabel = s.window_days ? t('student.stat_window_days', { n: s.window_days }) : ''
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
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('student.english_pane_mocks_header')}
        </div>
        {s.english_mocks_count === 0 ? (
          <p className="text-sm text-text-secondary">
            {t('student.english_pane_mocks_empty')}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <Stat label={t('student.stat_count')} value={String(s.english_mocks_count)} />
            <Stat
              label={t('student.stat_avg')}
              value={`${s.english_mocks_avg_score}/100`}
              tier={scoreTier(s.english_mocks_avg_score)}
            />
            <Stat
              label={t('student.stat_last')}
              value={`${s.english_mocks_last_score}/100`}
              tier={scoreTier(s.english_mocks_last_score)}
            />
          </div>
        )}
      </Card>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('student.english_pane_reading_header')}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label={t('student.stat_minutes')} value={String(s.reading_minutes_window)} sub={windowLabel} />
          <Stat label={t('student.stat_sessions')} value={String(s.reading_sessions_count)} sub={windowLabel} />
          <Stat label={t('student.stat_library')} value={String(s.reading_materials_total)} sub={t('student.stat_library_label_total')} />
        </div>
      </Card>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('student.vocab_header')}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label={t('student.stat_in_queue')} value={String(s.vocab_queue_total)} />
          <Stat label={t('student.stat_due_today_ru')} value={String(s.vocab_due_today)} />
        </div>
      </Card>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('student.writing_listening_header')}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label={t('student.stat_writing_grades')} value={String(s.writing_grades_count)} sub={windowLabel} />
          <Stat label={t('student.stat_listening_lib')} value={String(s.listening_materials_total)} sub={t('student.stat_library_total')} />
        </div>
      </Card>

      {noActivity && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-1 p-4">
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 1.5,
              minHeight: 36,
              background: 'var(--red)',
              marginTop: 2,
              flex: '0 0 auto',
            }}
          />
          <div className="flex flex-1 flex-col gap-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
              {t('student.no_english_eyebrow')}
            </div>
            <p className="text-[13px] leading-relaxed text-text-secondary">
              {t('student.no_english_body')}
            </p>
          </div>
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
  const { t } = useTranslation('tutor')
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

  if (!studentId) return <ErrorCard message={t('common.student_id_missing')} />
  if (q.isPending) return <PendingCard label={t('student.notes_loading')} />
  if (q.isError) {
    const status = q.error instanceof ApiError ? q.error.status : 0
    return (
      <ErrorCard
        message={
          status === 403
            ? t('student.notes_not_attached')
            : t('student.notes_load_fail')
        }
      />
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {t('student.notes_header')}
          </div>
          <SaveStatus pending={m.isPending} savedAt={savedAt} />
        </div>
        <p className="text-[12px] leading-relaxed text-text-secondary">
          {t('student.notes_body')}
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={16}
          placeholder={t('student.notes_placeholder')}
          className="w-full resize-y border-b border-[var(--hair-2)] bg-transparent px-1 py-2 font-mono text-[13px] leading-relaxed text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] placeholder:text-text-muted focus:border-[rgb(var(--ink))]"
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
  const { t } = useTranslation('tutor')
  if (pending) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        <Loader2 className="h-3 w-3 animate-spin" /> {t('student.save_state_saving')}
      </span>
    )
  }
  if (!savedAt) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        {t('student.save_state_not_saved')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
      <Check className="h-3 w-3 text-accent" /> {formatRelative(savedAt, t)}
    </span>
  )
}
