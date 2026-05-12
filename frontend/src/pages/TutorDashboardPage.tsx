// TutorDashboardPage — Wave 2.6 of docs/feature/plan.md.
//
// Routes:
//   /tutor               — this dashboard (invites + students panes)
//   /tutor/students/:id  — TutorStudentPage (snapshot + brief)
//
// Layout: two-column on desktop (Invites | Students), stacked on mobile.
// Tutor mints invites here, sees the active codes, and clicks through
// to a student page for the pre-session brief.
//
// Auth gate: this page assumes the bearer is a tutor — the backend
// enforces «only your invites / your students» at the SQL gate, so an
// unauthorised viewer just sees an empty list rather than someone
// else's data.
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { TutorOnboardingModal, isTutorOnboarded } from '../components/TutorOnboardingModal'
import { SharedReadingPane } from '../components/SharedReadingPane'
import { ReadingPathsPane } from '../components/ReadingPathsPane'
import { TutorDirectoryPane } from '../components/TutorDirectoryPane'
import { Sparkline } from '../components/Sparkline'
import { ApiError } from '../lib/apiClient'
import {
  useBroadcastAssignmentMutation,
  useCancelEventMutation,
  useCompleteEventMutation,
  useCreateEventMutation,
  useCreateGroupEventMutation,
  useCreateInviteMutation,
  useInviteByUsernameMutation,
  useEndRelationshipMutation,
  useRevokeInviteMutation,
  useTutorActivityQuery,
  useTutorEventsQuery,
  useTutorInvitesQuery,
  useTutorStudentsQuery,
  type TutorBroadcastResult,
  type TutorEvent,
  type TutorInvite,
  type TutorInviteStatus,
  type TutorRelationship,
} from '../lib/queries/tutor'
import { useMyCirclesQuery } from '../lib/queries/circles'

const STATUS_LABEL: Record<TutorInviteStatus, string> = {
  INVITE_STATUS_UNSPECIFIED: '—',
  INVITE_STATUS_ACTIVE: 'активен',
  INVITE_STATUS_ACCEPTED: 'принят',
  INVITE_STATUS_REVOKED: 'отозван',
  INVITE_STATUS_EXPIRED: 'истёк',
}

type DashTab =
  | 'overview'
  | 'students'
  | 'library'
  | 'paths'
  | 'calendar'
  | 'directory'

const TABS: { id: DashTab; label: string; hint: string }[] = [
  { id: 'overview', label: 'Обзор', hint: 'Активность за 30 дней + быстрые действия' },
  { id: 'students', label: 'Студенты', hint: 'Invites + active relationships' },
  { id: 'library', label: 'Reading library', hint: 'Shared reading material для всех студентов' },
  // Stream D (2026-05-12) — curated atlas-node sequences.
  { id: 'paths', label: 'Paths', hint: 'Curated reading paths из atlas-узлов' },
  { id: 'calendar', label: 'Календарь', hint: 'Sessions + broadcast assignments' },
  // Phase K T1 (2026-05-12) — directory profile + pending applications.
  { id: 'directory', label: 'Directory', hint: 'Публичный профиль + заявки от студентов' },
]

function isDashTab(s: string | undefined): s is DashTab {
  return (
    s === 'overview' ||
    s === 'students' ||
    s === 'library' ||
    s === 'paths' ||
    s === 'calendar' ||
    s === 'directory'
  )
}

export default function TutorDashboardPage() {
  const [onboarding, setOnboarding] = useState(() => !isTutorOnboarded())
  const params = useParams<{ tab?: string }>()
  const navigate = useNavigate()
  const tab: DashTab = isDashTab(params.tab) ? params.tab : 'overview'

  const switchTab = (next: DashTab) => {
    navigate(`/tutor/${next}`)
  }

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      {onboarding && <TutorOnboardingModal onClose={() => setOnboarding(false)} />}
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10 sm:px-8 sm:py-14">
        <header className="flex flex-col gap-2">
          <Link
            to="/welcome"
            className="font-mono text-[12px] tracking-[0.08em] text-text-muted transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:text-text-primary"
          >
            ← druz9
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            Tutor · dashboard
          </span>
          <h1 className="font-display text-3xl font-bold leading-tight">
            Дашборд тутора
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">
            {TABS.find((t) => t.id === tab)?.hint}
          </p>
        </header>

        {/* Tab switcher */}
        <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Dashboard sections">
          {TABS.map((t) => {
            const isActive = t.id === tab
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => switchTab(t.id)}
                aria-pressed={isActive}
                className={`relative -mb-px px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] ${
                  isActive
                    ? 'text-text-primary'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: 8,
                      width: 1.5,
                      height: 14,
                      background: 'var(--red)',
                    }}
                  />
                )}
                {t.label}
                {isActive && (
                  <span className="absolute inset-x-0 bottom-0 h-[2px] bg-text-primary" />
                )}
              </button>
            )
          })}
        </nav>

        {tab === 'overview' && (
          <>
            <ActivityPane />
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              <InvitesPane />
              <StudentsPane />
            </div>
          </>
        )}

        {tab === 'students' && (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <InvitesPane />
            <StudentsPane />
          </div>
        )}

        {tab === 'library' && <SharedReadingPane />}

        {tab === 'paths' && <ReadingPathsPane />}

        {tab === 'calendar' && (
          <>
            <BroadcastPane />
            <EventsPane />
          </>
        )}

        {tab === 'directory' && <TutorDirectoryPane />}
      </div>
    </div>
  )
}

// ── Activity pane (Wave 9.5) ───────────────────────────────────────────

function ActivityPane() {
  const q = useTutorActivityQuery(30)
  const a = q.data
  // Phase 8 — daily series, fall back to empty array if backend pre-rollup.
  const daily = (a as { daily_completed?: number[]; daily_minutes?: number[] } | undefined)
  const dailyCompleted = daily?.daily_completed ?? []
  const dailyMinutes = daily?.daily_minutes ?? []
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Активность · 30d</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {q.isPending ? 'loading…' : 'tutor analytics'}
        </span>
      </header>
      <Card className="flex-col gap-3 p-4" interactive={false}>
        {a ? (
          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 sm:grid-cols-5">
            <Stat label="Active students" value={String(a.active_student_count)} />
            <Stat label="Completed" value={String(a.events_completed)} accent="success" sparkline={dailyCompleted} />
            <Stat label="Scheduled" value={String(a.events_scheduled)} />
            <Stat
              label="Cancelled"
              value={String(a.events_cancelled)}
              accent={a.events_cancelled > 0 ? 'warn' : undefined}
            />
            <Stat label="Min taught" value={String(a.minutes_taught)} sparkline={dailyMinutes} />
          </div>
        ) : (
          <p className="text-[13px] text-text-secondary">
            Недостаточно данных для аналитики. Создай первое событие.
          </p>
        )}
        {a && (a.events_completed ?? 0) + (a.events_cancelled ?? 0) > 0 && (
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            Cancellation rate · {((a.cancellation_rate ?? 0) * 100).toFixed(0)}%
          </div>
        )}
      </Card>
    </section>
  )
}

function Stat({
  label,
  value,
  accent,
  sparkline,
}: {
  label: string
  value: string
  accent?: 'success' | 'warn' | 'danger'
  sparkline?: number[]
}) {
  const valueCls =
    accent === 'success'
      ? 'text-success'
      : accent === 'warn'
        ? 'text-warn'
        : accent === 'danger'
          ? 'text-danger'
          : 'text-text-primary'
  const hasSpark = sparkline && sparkline.length > 1 && sparkline.some((v) => v > 0)
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${valueCls}`}>{value}</div>
      {hasSpark && (
        <Sparkline
          values={sparkline}
          height={18}
          stroke="rgba(255,255,255,0.5)"
          fill="rgba(255,255,255,0.06)"
          style={{ marginTop: 4, display: 'block' }}
          ariaLabel={`${label} trend ${sparkline.length}d`}
        />
      )}
    </div>
  )
}

// ── Events pane (Wave 5.2b) ────────────────────────────────────────────

function EventsPane() {
  const studentsQ = useTutorStudentsQuery()
  const circlesQ = useMyCirclesQuery()
  const eventsQ = useTutorEventsQuery()
  const create = useCreateEventMutation()
  const createGroup = useCreateGroupEventMutation()
  const cancel = useCancelEventMutation()
  const complete = useCompleteEventMutation()

  const [mode, setMode] = useState<'1on1' | 'group'>('1on1')
  const [studentId, setStudentId] = useState('')
  const [circleId, setCircleId] = useState('')
  const [capacity, setCapacity] = useState(10)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [whenLocal, setWhenLocal] = useState('')
  const [duration, setDuration] = useState(60)
  const [meetURL, setMeetURL] = useState('')

  const students = studentsQ.data?.items ?? []
  const events = eventsQ.data?.items ?? []
  // Tutor can only schedule on circles they own (server also re-checks);
  // we filter client-side for a less-confusing dropdown.
  const ownedCircles = (circlesQ.data ?? []).filter((c) => c.owner_id)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const titleTrim = title.trim()
    if (!titleTrim || !whenLocal) return
    // <input type="datetime-local"> emits TZ-naive; New Date() interprets
    // as local TZ → toISOString() emits UTC, which is what the proto
    // expects (server stores UTC, frontend re-renders in viewer's TZ).
    const scheduledAt = new Date(whenLocal).toISOString()
    const reset = () => {
      setTitle('')
      setBody('')
      setWhenLocal('')
      setMeetURL('')
    }
    if (mode === 'group') {
      if (!circleId) return
      createGroup.mutate(
        {
          circle_id: circleId,
          title: titleTrim,
          body_md: body.trim(),
          scheduled_at: scheduledAt,
          duration_min: duration,
          meet_url: meetURL.trim(),
          capacity,
        },
        { onSuccess: reset },
      )
      return
    }
    if (!studentId) return
    create.mutate(
      {
        student_id: studentId,
        title: titleTrim,
        body_md: body.trim(),
        scheduled_at: scheduledAt,
        duration_min: duration,
        meet_url: meetURL.trim(),
      },
      { onSuccess: reset },
    )
  }
  const submitting = mode === 'group' ? createGroup.isPending : create.isPending
  const submitErr = mode === 'group' ? createGroup.error : create.error
  const submitIsErr = mode === 'group' ? createGroup.isError : create.isError

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-semibold">Events</h2>
          <p className="text-[13px] text-text-secondary">
            Назначай уроки 1-на-1 — студент увидит их у себя в Hone Calendar.
          </p>
        </div>
      </header>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <div className="flex items-center gap-2 text-[12px]">
          <button
            type="button"
            onClick={() => setMode('1on1')}
            className={`relative rounded-md border px-2.5 py-1 transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] ${mode === '1on1' ? 'border-text-primary text-text-primary' : 'border-border text-text-muted'}`}
          >
            {mode === '1on1' && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: -1,
                  top: 4,
                  bottom: 4,
                  width: 1.5,
                  background: 'var(--red)',
                }}
              />
            )}
            1-on-1
          </button>
          <button
            type="button"
            onClick={() => setMode('group')}
            className={`relative rounded-md border px-2.5 py-1 transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] ${mode === 'group' ? 'border-text-primary text-text-primary' : 'border-border text-text-muted'}`}
          >
            {mode === 'group' && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: -1,
                  top: 4,
                  bottom: 4,
                  width: 1.5,
                  background: 'var(--red)',
                }}
              />
            )}
            Group (circle)
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === '1on1' ? (
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                Student
              </span>
              <select
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                required
                className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] focus:border-[rgb(var(--ink))]"
              >
                <option value="">— выбери студента —</option>
                {students.map((rel) => (
                  <option key={rel.id} value={rel.student_id}>
                    student-{rel.student_id.slice(0, 8)}
                    {rel.note ? ` · ${rel.note}` : ''}
                  </option>
                ))}
              </select>
              {students.length === 0 && (
                <span className="text-[11px] text-text-muted">
                  Нет активных студентов. Сначала разошли инвайт.
                </span>
              )}
            </label>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  Circle
                </span>
                <select
                  value={circleId}
                  onChange={(e) => setCircleId(e.target.value)}
                  required
                  className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] focus:border-[rgb(var(--ink))]"
                >
                  <option value="">— выбери circle —</option>
                  {ownedCircles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.member_count} member{c.member_count === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
                {ownedCircles.length === 0 && (
                  <span className="text-[11px] text-text-muted">
                    Нет circles, которыми ты владеешь. Сначала создай circle.
                  </span>
                )}
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  Capacity
                </span>
                <input
                  type="number"
                  value={capacity}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setCapacity(Number.isFinite(n) ? n : 10)
                  }}
                  min={1}
                  max={200}
                  required
                  className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] focus:border-[rgb(var(--ink))]"
                />
              </label>
            </div>
          )}

          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Weekly 1-on-1 — review chapter 4"
            maxLength={240}
            className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] placeholder:text-text-muted focus:border-[rgb(var(--ink))]"
            required
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Optional agenda, prep notes, links to materials…"
            rows={3}
            maxLength={4000}
            className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] placeholder:text-text-muted focus:border-[rgb(var(--ink))]"
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                Scheduled at
              </span>
              <input
                type="datetime-local"
                value={whenLocal}
                onChange={(e) => setWhenLocal(e.target.value)}
                required
                className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] focus:border-[rgb(var(--ink))]"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                Duration (min)
              </span>
              <input
                type="number"
                value={duration}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  setDuration(Number.isFinite(n) ? n : 60)
                }}
                min={1}
                max={480}
                step={5}
                required
                className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] focus:border-[rgb(var(--ink))]"
              />
            </label>
          </div>

          <input
            type="url"
            value={meetURL}
            onChange={(e) => setMeetURL(e.target.value)}
            placeholder="Optional meet link (Zoom / Meet / Telegram voice)"
            maxLength={2000}
            className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] placeholder:text-text-muted focus:border-[rgb(var(--ink))]"
          />

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={
                submitting ||
                title.trim() === '' ||
                whenLocal === '' ||
                (mode === '1on1' ? studentId === '' : circleId === '')
              }
            >
              {submitting ? 'Создаём…' : mode === 'group' ? 'Schedule group event' : 'Schedule event'}
            </Button>
            {submitIsErr && (
              <span className="text-[12px] text-danger">
                {submitErr instanceof ApiError ? submitErr.body : 'Не получилось'}
              </span>
            )}
          </div>
        </form>
      </Card>

      <div className="flex flex-col gap-2">
        {eventsQ.isPending ? (
          <Card className="flex-row items-center gap-2 p-4 text-text-secondary" interactive={false}>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Загружаем…</span>
          </Card>
        ) : events.length === 0 ? (
          <Card className="flex-col gap-1 p-4" interactive={false}>
            <p className="text-[13px] leading-relaxed text-text-secondary">
              Пока ни одного события. Создай первое — оно сразу появится у студента в Hone Calendar.
            </p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map((ev) => (
              <li key={ev.id}>
                <EventRow
                  event={ev}
                  onCancel={(reason) =>
                    cancel.mutate({ event_id: ev.id, reason })
                  }
                  onComplete={(note) =>
                    complete.mutate({ event_id: ev.id, session_note: note })
                  }
                  cancelling={cancel.isPending}
                  completing={complete.isPending}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function EventRow({
  event,
  onCancel,
  onComplete,
  cancelling,
  completing,
}: {
  event: TutorEvent
  onCancel: (reason: string) => void
  onComplete: (note: string) => void
  cancelling: boolean
  completing: boolean
}) {
  const status = eventDisplayStatus(event)
  const badge =
    status === 'cancelled'
      ? { label: 'cancelled', cls: 'border-danger/40 bg-danger/10 text-danger' }
      : status === 'completed'
        ? { label: 'completed', cls: 'border-success/40 bg-success/10 text-success' }
        : status === 'past'
          ? { label: 'past · awaiting close', cls: 'border-warn/40 bg-warn/5 text-warn' }
          : status === 'live'
            ? { label: 'live now', cls: 'border-success/40 bg-success/10 text-success' }
            : { label: 'scheduled', cls: 'border-warn/40 bg-warn/10 text-warn' }

  const sched = event.scheduled_at ? new Date(event.scheduled_at) : null
  // Completable in any state where the session has happened or is happening,
  // and not already terminal. «past» (slot ended without close) is the
  // primary case; «live» also OK so a tutor can close mid-session if needed.
  const isCompletable = status === 'past' || status === 'live'
  // Cancellable only before the slot is over.
  const isCancellable = status === 'scheduled' || status === 'live'

  return (
    <Card
      className={`flex-col gap-2 p-4 ${status === 'cancelled' || status === 'completed' ? 'opacity-70' : ''}`}
      interactive={false}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-text-primary">{event.title}</div>
          {event.body_md && (
            <pre className="mt-1 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-text-secondary">
              {event.body_md}
            </pre>
          )}
          {event.cancellation_reason && (
            <div className="mt-1 text-[12px] italic text-danger">
              cancelled: {event.cancellation_reason}
            </div>
          )}
          {event.session_note && (
            <div className="mt-2 rounded-md border border-success/30 bg-success/5 px-2.5 py-1.5">
              <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-success/80">
                Session note
              </div>
              <pre className="mt-0.5 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-text-secondary">
                {event.session_note}
              </pre>
            </div>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${badge.cls}`}
        >
          {badge.label}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        {sched && (
          <span>
            {sched.toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
        )}
        <span>· {event.duration_min} min</span>
        <span>· student-{event.student_id.slice(0, 8)}</span>
        {event.meet_url && (
          <a
            href={event.meet_url}
            target="_blank"
            rel="noreferrer"
            className="text-text-secondary hover:text-text-primary"
          >
            join →
          </a>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isCompletable && (
            <button
              type="button"
              onClick={() => {
                // window.prompt is plenty for the V1 surface — short notes,
                // nothing fancy. If we want rich Markdown later (links to
                // Hone Notes etc.), swap to a modal with a <textarea>.
                const note = window.prompt(
                  'Session note (what was covered, next steps):',
                )
                if (note && note.trim()) {
                  onComplete(note.trim())
                }
              }}
              disabled={completing}
              className="rounded-md border border-success/40 bg-success/5 px-2 py-0.5 text-success transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:bg-success/10 disabled:opacity-50"
            >
              ✓ Mark complete
            </button>
          )}
          {isCancellable && (
            <button
              type="button"
              onClick={() => {
                const reason = window.prompt('Reason for cancelling:')
                if (reason && reason.trim()) {
                  onCancel(reason.trim())
                }
              }}
              disabled={cancelling}
              className="rounded-md border border-warn/40 bg-warn/5 px-2 py-0.5 text-warn transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:bg-warn/10 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}

// Display status combines the persisted `status` field with time-based
// derivations: a 'scheduled' event whose end time has passed is shown
// as «past» (the tutor can still see it in the list, but cancel is hidden).
function eventDisplayStatus(
  e: TutorEvent,
): 'scheduled' | 'live' | 'past' | 'cancelled' | 'completed' {
  if (e.status === 'cancelled') return 'cancelled'
  if (e.status === 'completed') return 'completed'
  if (!e.scheduled_at) return 'scheduled'
  const start = new Date(e.scheduled_at).getTime()
  const end = start + e.duration_min * 60_000
  const now = Date.now()
  if (now > end) return 'past'
  if (now >= start) return 'live'
  return 'scheduled'
}

// ── Broadcast pane (Wave 5.2a) ─────────────────────────────────────────

function BroadcastPane() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [due, setDue] = useState('')
  const [result, setResult] = useState<TutorBroadcastResult | null>(null)
  const broadcast = useBroadcastAssignmentMutation()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const titleTrim = title.trim()
    if (!titleTrim) return
    const dueISO = due ? new Date(due).toISOString() : undefined
    broadcast.mutate(
      { title: titleTrim, body_md: body.trim(), due_at: dueISO },
      {
        onSuccess: (r) => {
          setResult(r)
          setTitle('')
          setBody('')
          setDue('')
        },
      },
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-semibold">Broadcast</h2>
          <p className="text-[13px] text-text-secondary">
            Отправь одно задание ВСЕМ активным студентам сразу — для group-классов и общих чтений.
          </p>
        </div>
      </header>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Read chapter 4 — The Black Swan"
            maxLength={240}
            className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] placeholder:text-text-muted focus:border-[rgb(var(--ink))]"
            required
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Optional shared instructions, links, focus questions…"
            rows={4}
            maxLength={8000}
            className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] placeholder:text-text-muted focus:border-[rgb(var(--ink))]"
          />
          <label className="flex items-center gap-3 text-sm text-text-secondary">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted shrink-0">
              Due (optional)
            </span>
            <input
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="border-b border-[var(--hair-2)] bg-transparent px-1 py-1 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] focus:border-[rgb(var(--ink))]"
            />
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={broadcast.isPending || title.trim() === ''}>
              {broadcast.isPending ? 'Отправляем…' : 'Push to all students'}
            </Button>
            {broadcast.isError && (
              <span className="text-[12px] text-danger">
                {broadcast.error instanceof ApiError ? broadcast.error.body : 'Не получилось'}
              </span>
            )}
          </div>
        </form>
      </Card>

      {result && <BroadcastResultCard result={result} />}
    </section>
  )
}

function BroadcastResultCard({ result }: { result: TutorBroadcastResult }) {
  const total = result.pushed.length + result.failed.length
  // The use case returns empty arrays if no students — tutor sees a
  // distinct empty-state instead of «pushed to 0 / 0».
  if (total === 0) {
    return (
      <Card className="flex-col gap-1 p-4" interactive={false}>
        <p className="text-[13px] leading-relaxed text-text-secondary">
          У тебя пока нет активных студентов. Создай и разошли инвайт-код в секции выше.
        </p>
      </Card>
    )
  }
  const allOk = result.failed.length === 0
  return (
    <Card
      className={`flex-col gap-2 p-4 ${
        allOk ? 'border-success/40 bg-success/5' : 'border-warn/40 bg-warn/5'
      }`}
      interactive={false}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
        Результат
      </div>
      <p className="text-sm">
        Pushed to <span className={allOk ? 'text-success' : 'text-warn'}>{result.pushed.length}</span>{' '}
        / {total} students.
      </p>
      {result.failed.length > 0 && (
        <ul className="flex flex-col gap-1 mt-1">
          {result.failed.map((f) => (
            <li key={f.student_id} className="text-[12px] text-warn">
              · student-{f.student_id.slice(0, 8)} — {f.error}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ── Invites pane ───────────────────────────────────────────────────────

function InvitesPane() {
  const invitesQ = useTutorInvitesQuery()
  const create = useCreateInviteMutation()
  const inviteByUsername = useInviteByUsernameMutation()
  const revoke = useRevokeInviteMutation()

  const [note, setNote] = useState('')
  const [username, setUsername] = useState('')
  const [inviteByUsernameMsg, setInviteByUsernameMsg] = useState<string | null>(null)

  const items = invitesQ.data?.items ?? []

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Приглашения</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {items.length}
        </span>
      </div>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            Пригласить @username (рекомендуется)
          </span>
          <p className="text-[11px] text-text-muted">
            Если ученик уже зарегистрирован — он увидит приглашение прямо у себя
            на /profile, без копи-вставки кода.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/^@/, '').trim())}
              placeholder="anya123"
              className="flex-1 border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] placeholder:text-text-muted focus:border-[rgb(var(--ink))]"
            />
            <Button
              onClick={() => {
                setInviteByUsernameMsg(null)
                inviteByUsername.mutate(
                  { username, note: note.trim() || undefined },
                  {
                    onSuccess: () => {
                      setInviteByUsernameMsg(`Готово — @${username} увидит приглашение на /profile`)
                      setUsername('')
                      setNote('')
                    },
                  },
                )
              }}
              disabled={!username || inviteByUsername.isPending}
            >
              {inviteByUsername.isPending ? 'Шлю…' : 'Пригласить'}
            </Button>
          </div>
          {inviteByUsernameMsg && (
            <span className="text-[12px] text-success">{inviteByUsernameMsg}</span>
          )}
          {inviteByUsername.isError && (
            <span className="text-[12px] text-danger">
              {inviteByUsername.error instanceof ApiError
                ? inviteByUsername.error.body
                : 'Не получилось — проверь username'}
            </span>
          )}
        </label>
        <hr className="border-border" />
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            Открытый код (для отправки out-of-band)
          </span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anya · с Habr · English-track"
            className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] placeholder:text-text-muted focus:border-[rgb(var(--ink))]"
          />
        </label>
        <Button
          variant="ghost"
          onClick={() => {
            create.mutate(note.trim(), {
              onSuccess: () => setNote(''),
            })
          }}
          disabled={create.isPending}
          className="self-start"
        >
          {create.isPending ? 'Создаём…' : '+ Новый код'}
        </Button>
        {create.isError && (
          <span className="text-[12px] text-danger">
            {create.error instanceof ApiError ? create.error.body : 'Не получилось создать'}
          </span>
        )}
      </Card>

      {invitesQ.isPending ? (
        <PendingRow label="Загружаем коды…" />
      ) : invitesQ.isError ? (
        <ErrorRow message="Не удалось загрузить инвайты" />
      ) : items.length === 0 ? (
        <EmptyRow message="Пока нет ни одного инвайта. Создай первый — отправь ссылку студенту." />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((invite) => (
            <InviteRow
              key={invite.id}
              invite={invite}
              onRevoke={() => revoke.mutate(invite.id)}
              revoking={revoke.isPending}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function InviteRow({
  invite,
  onRevoke,
  revoking,
}: {
  invite: TutorInvite
  onRevoke: () => void
  revoking: boolean
}) {
  const isActive = invite.status === 'INVITE_STATUS_ACTIVE'
  const url = `${window.location.origin}/invite/${invite.code}`

  return (
    <Card className="flex-col gap-2 p-4" interactive={false}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="font-mono text-base font-semibold tabular-nums">
            {invite.code}
          </div>
          {invite.note && (
            <div className="text-[12px] text-text-secondary truncate">{invite.note}</div>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${
            isActive
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-border bg-surface-2 text-text-muted'
          }`}
        >
          {STATUS_LABEL[invite.status] ?? '—'}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            // navigator.clipboard isn't always available (insecure context, embedded
            // webview); fall back to a synthesised <textarea> selection so the
            // tutor can still grab the link.
            void copyToClipboard(url)
          }}
          className="rounded-md border border-border bg-surface-2 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:border-text-primary hover:text-text-primary"
        >
          Скопировать ссылку
        </button>
        {isActive && (
          <button
            type="button"
            onClick={onRevoke}
            disabled={revoking}
            className="rounded-md border border-warn/40 bg-warn/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-warn transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:bg-warn/10 disabled:opacity-50"
          >
            Отозвать
          </button>
        )}
      </div>
    </Card>
  )
}

// ── Students pane ──────────────────────────────────────────────────────

function StudentsPane() {
  const studentsQ = useTutorStudentsQuery()
  const endRel = useEndRelationshipMutation()

  const items = studentsQ.data?.items ?? []

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Студенты</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {items.length}
        </span>
      </div>

      {studentsQ.isPending ? (
        <PendingRow label="Загружаем студентов…" />
      ) : studentsQ.isError ? (
        <ErrorRow message="Не удалось загрузить студентов" />
      ) : items.length === 0 ? (
        <EmptyRow message="Студентов пока нет. Создай инвайт и отправь его — после Accept'а студент появится здесь." />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((rel) => (
            <StudentRow
              key={rel.id}
              relationship={rel}
              onEnd={() => endRel.mutate(rel.student_id)}
              ending={endRel.isPending}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function StudentRow({
  relationship,
  onEnd,
  ending,
}: {
  relationship: TutorRelationship
  onEnd: () => void
  ending: boolean
}) {
  const since = relationship.started_at
    ? new Date(relationship.started_at).toLocaleDateString()
    : '—'
  // student_id is the only identity surface today — a future iteration
  // can join the users table and surface display_name. For now the tutor
  // disambiguates via the «note» on the invite (visible on hover via title).
  const shortId = relationship.student_id.slice(0, 8)

  return (
    <Card className="flex-col gap-2 p-4" interactive={false}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <Link
            to={`/tutor/students/${relationship.student_id}`}
            className="font-mono text-sm font-semibold tabular-nums hover:text-text-primary"
            title={relationship.student_id}
          >
            student-{shortId}
          </Link>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            с {since}
          </div>
        </div>
        <Link
          to={`/tutor/students/${relationship.student_id}`}
          className="shrink-0 rounded-md border border-border bg-surface-2 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-text-primary hover:text-text-primary"
        >
          Открыть
        </Link>
      </div>
      <div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Завершить отношения с этим студентом? Он сохранит свои данные.')) {
              onEnd()
            }
          }}
          disabled={ending}
          className="rounded-md border border-warn/40 bg-warn/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-warn transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:bg-warn/10 disabled:opacity-50"
        >
          Завершить отношения
        </button>
      </div>
    </Card>
  )
}

// ── Shared atoms ───────────────────────────────────────────────────────

function PendingRow({ label }: { label: string }) {
  return (
    <Card className="flex-row items-center gap-2 p-4 text-text-secondary" interactive={false}>
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">{label}</span>
    </Card>
  )
}

function ErrorRow({ message }: { message: string }) {
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
          Ошибка
        </div>
        <p className="text-[13px] leading-relaxed text-text-secondary">{message}</p>
      </div>
    </Card>
  )
}

function EmptyRow({ message }: { message: string }) {
  return (
    <Card className="flex-col gap-1 p-4" interactive={false}>
      <p className="text-[13px] leading-relaxed text-text-secondary">{message}</p>
    </Card>
  )
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    /* fall through to fallback */
  }
  // Fallback: hidden textarea + execCommand. Works in older webviews and
  // when the page isn't served over HTTPS (clipboard API gate).
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
  } finally {
    document.body.removeChild(ta)
  }
}
