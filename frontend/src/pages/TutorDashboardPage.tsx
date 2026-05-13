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
import { useTranslation } from 'react-i18next'

import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { CompleteEventModal } from '../components/CompleteEventModal'
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
  useSetSessionNoteVisibilityMutation,
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

// STATUS_LABEL keys are looked up dynamically via the i18n `t` function
// (see makeStatusLabel below); we expose the i18n key path here so the
// runtime mapping stays a thin function over the dictionary.
const STATUS_LABEL_KEY: Record<TutorInviteStatus, string> = {
  INVITE_STATUS_UNSPECIFIED: '',
  INVITE_STATUS_ACTIVE: 'dashboard.status_active',
  INVITE_STATUS_ACCEPTED: 'dashboard.status_accepted',
  INVITE_STATUS_REVOKED: 'dashboard.status_revoked',
  INVITE_STATUS_EXPIRED: 'dashboard.status_expired',
}

type DashTab =
  | 'overview'
  | 'students'
  | 'library'
  | 'paths'
  | 'calendar'
  | 'directory'

const TAB_DEFS: { id: DashTab; labelKey: string; hintKey: string }[] = [
  { id: 'overview', labelKey: 'dashboard.tab_overview', hintKey: 'dashboard.tab_overview_hint' },
  { id: 'students', labelKey: 'dashboard.tab_students', hintKey: 'dashboard.tab_students_hint' },
  { id: 'library', labelKey: 'dashboard.tab_library', hintKey: 'dashboard.tab_library_hint' },
  { id: 'paths', labelKey: 'dashboard.tab_paths', hintKey: 'dashboard.tab_paths_hint' },
  { id: 'calendar', labelKey: 'dashboard.tab_calendar', hintKey: 'dashboard.tab_calendar_hint' },
  { id: 'directory', labelKey: 'dashboard.tab_directory', hintKey: 'dashboard.tab_directory_hint' },
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
  const { t } = useTranslation('tutor')

  const switchTab = (next: DashTab) => {
    navigate(`/tutor/${next}`)
  }

  const currentHintKey = TAB_DEFS.find((td) => td.id === tab)?.hintKey

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      {onboarding && <TutorOnboardingModal onClose={() => setOnboarding(false)} />}
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10 sm:px-8 sm:py-14">
        <header className="flex flex-col gap-2">
          <Link
            to="/welcome"
            className="font-mono text-[12px] tracking-[0.08em] text-text-muted transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:text-text-primary"
          >
            {`← ${t('dashboard.back_link')}`}
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            {t('dashboard.eyebrow')}
          </span>
          <h1 className="font-display text-3xl font-bold leading-tight">
            {t('dashboard.title')}
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">
            {currentHintKey ? t(currentHintKey) : ''}
          </p>
        </header>

        {/* Tab switcher */}
        <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Dashboard sections">
          {TAB_DEFS.map((td) => {
            const isActive = td.id === tab
            return (
              <button
                key={td.id}
                type="button"
                onClick={() => switchTab(td.id)}
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
                {t(td.labelKey)}
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


function ActivityPane() {
  const q = useTutorActivityQuery(30)
  const a = q.data
  const { t } = useTranslation('tutor')
  // Phase 8 — daily series, fall back to empty array if backend pre-rollup.
  const daily = (a as { daily_completed?: number[]; daily_minutes?: number[] } | undefined)
  const dailyCompleted = daily?.daily_completed ?? []
  const dailyMinutes = daily?.daily_minutes ?? []
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">{t('dashboard.activity_title')}</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {q.isPending ? t('dashboard.activity_loading') : t('dashboard.activity_eyebrow')}
        </span>
      </header>
      <Card className="flex-col gap-3 p-4" interactive={false}>
        {a ? (
          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 sm:grid-cols-5">
            <Stat label={t('dashboard.stat_active_students')} value={String(a.active_student_count)} />
            <Stat label={t('dashboard.stat_completed')} value={String(a.events_completed)} accent="success" sparkline={dailyCompleted} />
            <Stat label={t('dashboard.stat_scheduled')} value={String(a.events_scheduled)} />
            <Stat
              label={t('dashboard.stat_cancelled')}
              value={String(a.events_cancelled)}
              accent={a.events_cancelled > 0 ? 'warn' : undefined}
            />
            <Stat label={t('dashboard.stat_min_taught')} value={String(a.minutes_taught)} sparkline={dailyMinutes} />
          </div>
        ) : (
          <p className="text-[13px] text-text-secondary">
            {t('dashboard.activity_no_data')}
          </p>
        )}
        {a && (a.events_completed ?? 0) + (a.events_cancelled ?? 0) > 0 && (
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {t('dashboard.cancellation_rate', { pct: ((a.cancellation_rate ?? 0) * 100).toFixed(0) })}
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


function EventsPane() {
  const studentsQ = useTutorStudentsQuery()
  const circlesQ = useMyCirclesQuery()
  const eventsQ = useTutorEventsQuery()
  const create = useCreateEventMutation()
  const createGroup = useCreateGroupEventMutation()
  const cancel = useCancelEventMutation()
  const complete = useCompleteEventMutation()
  const { t } = useTranslation('tutor')

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
          <h2 className="font-display text-xl font-semibold">{t('dashboard.events_title')}</h2>
          <p className="text-[13px] text-text-secondary">
            {t('dashboard.events_subtitle')}
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
            {t('dashboard.mode_1on1')}
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
            {t('dashboard.mode_group')}
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          {mode === '1on1' ? (
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                {t('dashboard.field_student')}
              </span>
              <select
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                required
                className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] focus:border-[rgb(var(--ink))]"
              >
                <option value="">{t('dashboard.field_student_placeholder')}</option>
                {students.map((rel) => (
                  <option key={rel.id} value={rel.student_id}>
                    student-{rel.student_id.slice(0, 8)}
                    {rel.note ? ` · ${rel.note}` : ''}
                  </option>
                ))}
              </select>
              {students.length === 0 && (
                <span className="text-[11px] text-text-muted">
                  {t('dashboard.no_active_students')}
                </span>
              )}
            </label>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  {t('dashboard.field_circle')}
                </span>
                <select
                  value={circleId}
                  onChange={(e) => setCircleId(e.target.value)}
                  required
                  className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] focus:border-[rgb(var(--ink))]"
                >
                  <option value="">{t('dashboard.field_circle_placeholder')}</option>
                  {ownedCircles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.member_count} {c.member_count === 1 ? t('dashboard.circle_member') : t('dashboard.circle_members')}
                    </option>
                  ))}
                </select>
                {ownedCircles.length === 0 && (
                  <span className="text-[11px] text-text-muted">
                    {t('dashboard.no_owned_circles')}
                  </span>
                )}
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                  {t('dashboard.field_capacity')}
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
            placeholder={t('dashboard.field_event_title_placeholder')}
            maxLength={240}
            className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] placeholder:text-text-muted focus:border-[rgb(var(--ink))]"
            required
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('dashboard.field_event_body_placeholder')}
            rows={3}
            maxLength={4000}
            className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] placeholder:text-text-muted focus:border-[rgb(var(--ink))]"
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                {t('dashboard.field_scheduled_at')}
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
                {t('dashboard.field_duration_min')}
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
            placeholder={t('dashboard.field_meet_url_placeholder')}
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
              {submitting ? t('dashboard.btn_creating') : mode === 'group' ? t('dashboard.btn_schedule_group') : t('dashboard.btn_schedule_event')}
            </Button>
            {submitIsErr && (
              <span className="text-[12px] text-danger">
                {submitErr instanceof ApiError ? submitErr.body : t('common.not_received')}
              </span>
            )}
          </div>
        </form>
      </Card>

      <div className="flex flex-col gap-2">
        {eventsQ.isPending ? (
          <Card className="flex-row items-center gap-2 p-4 text-text-secondary" interactive={false}>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">{t('dashboard.events_loading')}</span>
          </Card>
        ) : events.length === 0 ? (
          <Card className="flex-col gap-1 p-4" interactive={false}>
            <p className="text-[13px] leading-relaxed text-text-secondary">
              {t('dashboard.events_empty')}
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
  cancelling,
  completing,
}: {
  event: TutorEvent
  onCancel: (reason: string) => void
  cancelling: boolean
  completing: boolean
}) {
  const [completeModalOpen, setCompleteModalOpen] = useState(false)
  const setVisibility = useSetSessionNoteVisibilityMutation()
  const { t } = useTranslation('tutor')

  const status = eventDisplayStatus(event)
  const badge =
    status === 'cancelled'
      ? { label: t('dashboard.event_badge_cancelled'), cls: 'border-danger/40 bg-danger/10 text-danger' }
      : status === 'completed'
        ? { label: t('dashboard.event_badge_completed'), cls: 'border-success/40 bg-success/10 text-success' }
        : status === 'past'
          ? { label: t('dashboard.event_badge_past'), cls: 'border-warn/40 bg-warn/5 text-warn' }
          : status === 'live'
            ? { label: t('dashboard.event_badge_live'), cls: 'border-success/40 bg-success/10 text-success' }
            : { label: t('dashboard.event_badge_scheduled'), cls: 'border-warn/40 bg-warn/10 text-warn' }

  const sched = event.scheduled_at ? new Date(event.scheduled_at) : null
  // Completable in any state where the session has happened or is happening,
  // and not already terminal. «past» (slot ended without close) is the
  // primary case; «live» also OK so a tutor can close mid-session if needed.
  const isCompletable = status === 'past' || status === 'live'
  // Cancellable only before the slot is over.
  const isCancellable = status === 'scheduled' || status === 'live'
  const isShared = event.visibility === 'shared'

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
              {t('dashboard.event_cancelled_prefix', { reason: event.cancellation_reason })}
            </div>
          )}
          {event.session_note && (
            <div className="mt-2 rounded-md border border-success/30 bg-success/5 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-success/80">
                  {isShared ? t('dashboard.session_note_shared') : t('dashboard.session_note_private')}
                </div>
                {/* Phase K T4 — quick re-toggle from row view (no modal) */}
                {status === 'completed' && (
                  <button
                    type="button"
                    disabled={setVisibility.isPending}
                    onClick={() =>
                      setVisibility.mutate({
                        event_id: event.id,
                        visibility: isShared ? 'private' : 'shared',
                        shared_content_md: event.shared_content_md ?? '',
                      })
                    }
                    className="rounded-md border border-hairline px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-text-secondary hover:text-text-primary disabled:opacity-50"
                  >
                    {isShared ? t('dashboard.btn_hide_from_student') : t('dashboard.btn_share_with_student')}
                  </button>
                )}
              </div>
              <pre className="mt-0.5 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-text-secondary">
                {event.session_note}
              </pre>
              {isShared && event.shared_content_md && (
                <div className="mt-2 border-t border-hairline pt-2">
                  <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">
                    {t('dashboard.shared_copy_label')}
                  </div>
                  <pre className="mt-0.5 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-text-secondary">
                    {event.shared_content_md}
                  </pre>
                </div>
              )}
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
        <span>{t('dashboard.event_minutes', { n: event.duration_min })}</span>
        <span>{t('dashboard.event_student', { id: event.student_id.slice(0, 8) })}</span>
        {event.meet_url && (
          <a
            href={event.meet_url}
            target="_blank"
            rel="noreferrer"
            className="text-text-secondary hover:text-text-primary"
          >
            {t('dashboard.event_join')}
          </a>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isCompletable && (
            <button
              type="button"
              onClick={() => setCompleteModalOpen(true)}
              disabled={completing}
              className="rounded-md border border-success/40 bg-success/5 px-2 py-0.5 text-success transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:bg-success/10 disabled:opacity-50"
            >
              {t('dashboard.btn_mark_complete')}
            </button>
          )}
          {isCancellable && (
            <button
              type="button"
              onClick={() => {
                const reason = window.prompt(t('dashboard.cancel_prompt'))
                if (reason && reason.trim()) {
                  onCancel(reason.trim())
                }
              }}
              disabled={cancelling}
              className="rounded-md border border-warn/40 bg-warn/5 px-2 py-0.5 text-warn transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:bg-warn/10 disabled:opacity-50"
            >
              {t('dashboard.btn_cancel')}
            </button>
          )}
        </div>
      </div>
      <CompleteEventModal
        open={completeModalOpen}
        eventId={event.id}
        eventTitle={event.title}
        onClose={() => setCompleteModalOpen(false)}
      />
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


function BroadcastPane() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [due, setDue] = useState('')
  const [result, setResult] = useState<TutorBroadcastResult | null>(null)
  const broadcast = useBroadcastAssignmentMutation()
  const { t } = useTranslation('tutor')

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
          <h2 className="font-display text-xl font-semibold">{t('dashboard.broadcast_title')}</h2>
          <p className="text-[13px] text-text-secondary">
            {t('dashboard.broadcast_subtitle')}
          </p>
        </div>
      </header>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('dashboard.broadcast_title_placeholder')}
            maxLength={240}
            className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] placeholder:text-text-muted focus:border-[rgb(var(--ink))]"
            required
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('dashboard.broadcast_body_placeholder')}
            rows={4}
            maxLength={8000}
            className="border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] placeholder:text-text-muted focus:border-[rgb(var(--ink))]"
          />
          <label className="flex items-center gap-3 text-sm text-text-secondary">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted shrink-0">
              {t('dashboard.broadcast_due_label')}
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
              {broadcast.isPending ? t('dashboard.btn_sending') : t('dashboard.btn_push_all')}
            </Button>
            {broadcast.isError && (
              <span className="text-[12px] text-danger">
                {broadcast.error instanceof ApiError ? broadcast.error.body : t('common.not_received')}
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
  const { t } = useTranslation('tutor')
  const total = result.pushed.length + result.failed.length
  // The use case returns empty arrays if no students — tutor sees a
  // distinct empty-state instead of «pushed to 0 / 0».
  if (total === 0) {
    return (
      <Card className="flex-col gap-1 p-4" interactive={false}>
        <p className="text-[13px] leading-relaxed text-text-secondary">
          {t('dashboard.broadcast_no_students')}
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
        {t('dashboard.broadcast_result_label')}
      </div>
      <p className="text-sm">
        {t('dashboard.broadcast_pushed', { ok: result.pushed.length, total })}
      </p>
      {result.failed.length > 0 && (
        <ul className="flex flex-col gap-1 mt-1">
          {result.failed.map((f) => (
            <li key={f.student_id} className="text-[12px] text-warn">
              {t('dashboard.broadcast_failed_row', { id: f.student_id.slice(0, 8), error: f.error })}
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
  const { t } = useTranslation('tutor')

  const [note, setNote] = useState('')
  const [username, setUsername] = useState('')
  const [inviteByUsernameMsg, setInviteByUsernameMsg] = useState<string | null>(null)

  const items = invitesQ.data?.items ?? []

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">{t('dashboard.invites_title')}</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {items.length}
        </span>
      </div>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {t('dashboard.invite_by_username_label')}
          </span>
          <p className="text-[11px] text-text-muted">
            {t('dashboard.invite_by_username_hint')}
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/^@/, '').trim())}
              placeholder={t('dashboard.invite_username_placeholder')}
              className="flex-1 border-b border-[var(--hair-2)] bg-transparent px-1 py-2 text-sm text-[rgb(var(--ink))] outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-decelerate)] placeholder:text-text-muted focus:border-[rgb(var(--ink))]"
            />
            <Button
              onClick={() => {
                setInviteByUsernameMsg(null)
                inviteByUsername.mutate(
                  { username, note: note.trim() || undefined },
                  {
                    onSuccess: () => {
                      setInviteByUsernameMsg(t('dashboard.invite_by_username_success', { username }))
                      setUsername('')
                      setNote('')
                    },
                  },
                )
              }}
              disabled={!username || inviteByUsername.isPending}
            >
              {inviteByUsername.isPending ? t('dashboard.btn_invite_sending') : t('dashboard.btn_invite')}
            </Button>
          </div>
          {inviteByUsernameMsg && (
            <span className="text-[12px] text-success">{inviteByUsernameMsg}</span>
          )}
          {inviteByUsername.isError && (
            <span className="text-[12px] text-danger">
              {inviteByUsername.error instanceof ApiError
                ? inviteByUsername.error.body
                : t('dashboard.invite_by_username_error')}
            </span>
          )}
        </label>
        <hr className="border-border" />
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {t('dashboard.invite_open_code_label')}
          </span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('dashboard.invite_note_placeholder')}
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
          {create.isPending ? t('dashboard.btn_create_invite_creating') : t('dashboard.btn_create_invite')}
        </Button>
        {create.isError && (
          <span className="text-[12px] text-danger">
            {create.error instanceof ApiError ? create.error.body : t('dashboard.invite_create_failed')}
          </span>
        )}
      </Card>

      {invitesQ.isPending ? (
        <PendingRow label={t('dashboard.invites_loading')} />
      ) : invitesQ.isError ? (
        <ErrorRow message={t('dashboard.invites_load_failed')} />
      ) : items.length === 0 ? (
        <EmptyRow message={t('dashboard.invites_empty')} />
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
  const { t } = useTranslation('tutor')
  const isActive = invite.status === 'INVITE_STATUS_ACTIVE'
  const url = `${window.location.origin}/invite/${invite.code}`
  const statusKey = STATUS_LABEL_KEY[invite.status]
  const statusLabel = statusKey ? t(statusKey) : '—'

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
          {statusLabel}
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
          {t('dashboard.btn_copy_link')}
        </button>
        {isActive && (
          <button
            type="button"
            onClick={onRevoke}
            disabled={revoking}
            className="rounded-md border border-warn/40 bg-warn/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-warn transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:bg-warn/10 disabled:opacity-50"
          >
            {t('dashboard.btn_revoke')}
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
  const { t } = useTranslation('tutor')

  const items = studentsQ.data?.items ?? []

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">{t('dashboard.students_title')}</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {items.length}
        </span>
      </div>

      {studentsQ.isPending ? (
        <PendingRow label={t('dashboard.students_loading')} />
      ) : studentsQ.isError ? (
        <ErrorRow message={t('dashboard.students_load_failed')} />
      ) : items.length === 0 ? (
        <EmptyRow message={t('dashboard.students_empty')} />
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
  const { t: tToasts } = useTranslation('toasts')
  const { t } = useTranslation('tutor')
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
            {t('common.rel_since', { date: since })}
          </div>
        </div>
        <Link
          to={`/tutor/students/${relationship.student_id}`}
          className="shrink-0 rounded-md border border-border bg-surface-2 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary hover:border-text-primary hover:text-text-primary"
        >
          {t('common.open_btn')}
        </Link>
      </div>
      <div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(tToasts('tutor.drop_confirm'))) {
              onEnd()
            }
          }}
          disabled={ending}
          className="rounded-md border border-warn/40 bg-warn/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-warn transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:bg-warn/10 disabled:opacity-50"
        >
          {t('dashboard.btn_end_relationship')}
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
