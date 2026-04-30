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
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ApiError } from '../lib/apiClient'
import {
  useBroadcastAssignmentMutation,
  useCreateInviteMutation,
  useEndRelationshipMutation,
  useRevokeInviteMutation,
  useTutorInvitesQuery,
  useTutorStudentsQuery,
  type TutorBroadcastResult,
  type TutorInvite,
  type TutorInviteStatus,
  type TutorRelationship,
} from '../lib/queries/tutor'

const STATUS_LABEL: Record<TutorInviteStatus, string> = {
  INVITE_STATUS_UNSPECIFIED: '—',
  INVITE_STATUS_ACTIVE: 'активен',
  INVITE_STATUS_ACCEPTED: 'принят',
  INVITE_STATUS_REVOKED: 'отозван',
  INVITE_STATUS_EXPIRED: 'истёк',
}

export default function TutorDashboardPage() {
  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10 sm:px-8 sm:py-14">
        <header className="flex flex-col gap-2">
          <Link
            to="/welcome"
            className="font-mono text-[12px] tracking-[0.2em] text-text-muted hover:text-text-primary"
          >
            ← druz9
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-text-muted">
            Tutor · dashboard
          </span>
          <h1 className="font-display text-3xl font-bold leading-tight">
            Студенты и приглашения
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">
            Создавай инвайт-коды, отслеживай активных студентов и открывай
            страницу студента, чтобы получить AI-бриф перед сессией.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <InvitesPane />
          <StudentsPane />
        </div>

        <BroadcastPane />
      </div>
    </div>
  )
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
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
            required
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Optional shared instructions, links, focus questions…"
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
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
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
  const revoke = useRevokeInviteMutation()

  const [note, setNote] = useState('')

  const items = invitesQ.data?.items ?? []

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Приглашения</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          {items.length}
        </span>
      </div>

      <Card className="flex-col gap-3 p-4" interactive={false}>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
            Заметка (опционально)
          </span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anya · с Habr · English-track"
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
          />
        </label>
        <Button
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
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
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
          className="rounded-md border border-border bg-surface-2 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-text-primary hover:text-text-primary"
        >
          Скопировать ссылку
        </button>
        {isActive && (
          <button
            type="button"
            onClick={onRevoke}
            disabled={revoking}
            className="rounded-md border border-warn/40 bg-warn/5 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-warn hover:bg-warn/10 disabled:opacity-50"
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
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
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
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
            с {since}
          </div>
        </div>
        <Link
          to={`/tutor/students/${relationship.student_id}`}
          className="shrink-0 rounded-md border border-border bg-surface-2 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-text-secondary hover:border-text-primary hover:text-text-primary"
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
          className="rounded-md border border-warn/40 bg-warn/5 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-warn hover:bg-warn/10 disabled:opacity-50"
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
    <Card className="flex-col gap-1 border-danger/40 bg-danger/5 p-4" interactive={false}>
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-danger">Ошибка</div>
      <p className="text-[13px] leading-relaxed text-text-secondary">{message}</p>
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
