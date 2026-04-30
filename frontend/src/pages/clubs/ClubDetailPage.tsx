// /clubs/:slug — Phase 3 detail page.
//
// Layout:
//   • Hero: name, topic_tag, schedule_kind, curriculum_md, optional
//     curator-meta + zoom/tg links.
//   • Upcoming sessions list (newest-first by scheduled_at): pre-read
//     pinned, RSVP CTA → /clubs/:slug/session/:id.
//   • Past sessions list — recording + takeaways links.

import { useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpen, Calendar, Loader2, Plus, Video, X } from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { useAdminDashboardQuery } from '../../lib/queries/admin'
import {
  relativeDay,
  statusLabel,
  useClubQuery,
  useCreateSessionMutation,
  type ClubSession,
} from '../../lib/queries/clubs'

export default function ClubDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const q = useClubQuery(slug)

  const admin = useAdminDashboardQuery()
  const adminStatus = (admin.error as { status?: number } | null)?.status
  const isAdmin = !admin.isError && admin.isSuccess && adminStatus !== 403

  const [showCreate, setShowCreate] = useState(false)

  if (q.isLoading) {
    return (
      <AppShellV2>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
        </div>
      </AppShellV2>
    )
  }
  if (q.isError || !q.data) {
    return (
      <AppShellV2>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
          <p className="text-sm text-text-secondary">Club не найден.</p>
          <Button variant="ghost" onClick={() => navigate('/clubs')}>
            ← Каталог
          </Button>
        </div>
      </AppShellV2>
    )
  }

  const { club, upcoming, past } = q.data

  return (
    <AppShellV2>
      <div className="flex flex-col">
        <div className="border-b border-border bg-surface-1 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
          <div className="flex flex-col gap-3">
            <Link
              to="/clubs"
              className="inline-flex items-center gap-1 self-start font-mono text-[11px] text-text-muted transition-colors hover:text-text-primary"
            >
              <ArrowLeft className="h-3 w-3" />
              Каталог
            </Link>
            {club.topic_tag && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                {club.topic_tag}
              </span>
            )}
            <h1 className="font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[28px]">
              {club.name}
            </h1>
            {club.schedule_kind && (
              <span className="font-mono text-[11px] text-text-muted">
                schedule: {club.schedule_kind}
              </span>
            )}
            {club.curriculum_md && (
              <p className="mt-2 max-w-3xl whitespace-pre-line text-sm text-text-secondary">
                {club.curriculum_md}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px]">
              {club.default_zoom_link && (
                <a
                  href={club.default_zoom_link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-text-secondary hover:border-border-strong"
                >
                  <Video className="h-3 w-3" />
                  default zoom
                </a>
              )}
              {club.tg_anchor_url && (
                <a
                  href={club.tg_anchor_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-text-secondary hover:border-border-strong"
                >
                  TG чат
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 py-6 sm:px-8 lg:px-20">
          <Section
            title="Upcoming"
            hint="ближайшие встречи + pre-read"
            cta={
              isAdmin ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setShowCreate(true)}
                >
                  сессия
                </Button>
              ) : null
            }
          >
            {upcoming.length === 0 ? (
              <EmptyRow text="Запланированных встреч пока нет." />
            ) : (
              upcoming.map((s) => <SessionCard key={s.id} session={s} clubSlug={club.slug} variant="upcoming" />)
            )}
          </Section>

          {past.length > 0 && (
            <Section title="Past" hint="recording + takeaways">
              {past.map((s) => <SessionCard key={s.id} session={s} clubSlug={club.slug} variant="past" />)}
            </Section>
          )}
        </div>
      </div>
      {showCreate && club && (
        <CreateSessionModal slug={club.slug} onClose={() => setShowCreate(false)} />
      )}
    </AppShellV2>
  )
}

function CreateSessionModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  const create = useCreateSessionMutation(slug)
  const [form, setForm] = useState({
    scheduled_at: '',
    duration_min: 60,
    topic_title: '',
    topic_md: '',
    presenter_handle: '',
    zoom_link: '',
    pre_read_md: '',
  })
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setErr(null)
    if (!form.topic_title || !form.scheduled_at) {
      setErr('topic + scheduled_at — обязательны')
      return
    }
    try {
      const iso = new Date(form.scheduled_at).toISOString()
      await create.mutateAsync({ ...form, scheduled_at: iso })
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось создать')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface-1 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-text-primary">Новая сессия</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:text-text-primary"
            aria-label="close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Когда (local time)
            <input
              type="datetime-local"
              value={form.scheduled_at}
              onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))}
              className="rounded border border-border bg-surface-2 p-2 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Тема
            <input
              value={form.topic_title}
              onChange={(e) => setForm((f) => ({ ...f, topic_title: e.target.value }))}
              placeholder="System design: load balancing"
              className="rounded border border-border bg-surface-2 p-2 text-sm text-text-primary"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Длит. (мин)
              <input
                type="number"
                min={15}
                max={300}
                value={form.duration_min}
                onChange={(e) =>
                  setForm((f) => ({ ...f, duration_min: Number(e.target.value) || 60 }))
                }
                className="rounded border border-border bg-surface-2 p-2 text-sm text-text-primary"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Презентер (@)
              <input
                value={form.presenter_handle}
                onChange={(e) => setForm((f) => ({ ...f, presenter_handle: e.target.value }))}
                placeholder="curator"
                className="rounded border border-border bg-surface-2 p-2 text-sm text-text-primary"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Zoom (override)
            <input
              value={form.zoom_link}
              onChange={(e) => setForm((f) => ({ ...f, zoom_link: e.target.value }))}
              placeholder="https://zoom.us/…"
              className="rounded border border-border bg-surface-2 p-2 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Pre-read (markdown)
            <textarea
              rows={3}
              value={form.pre_read_md}
              onChange={(e) => setForm((f) => ({ ...f, pre_read_md: e.target.value }))}
              className="rounded border border-border bg-surface-2 p-2 text-sm text-text-primary"
            />
          </label>
          {err && <p className="text-xs text-danger">{err}</p>}
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              отмена
            </Button>
            <Button size="sm" onClick={submit} disabled={create.isPending}>
              {create.isPending ? '…' : 'создать'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  hint,
  cta,
  children,
}: {
  title: string
  hint?: string
  cta?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mb-8 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-base font-bold text-text-primary">{title}</h2>
          {hint && <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{hint}</span>}
        </div>
        {cta}
      </div>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  )
}

function SessionCard({
  session,
  clubSlug,
  variant,
}: {
  session: ClubSession
  clubSlug: string
  variant: 'upcoming' | 'past'
}) {
  return (
    <li>
      <Link
        to={`/clubs/${encodeURIComponent(clubSlug)}/session/${encodeURIComponent(session.id)}`}
        className="group flex flex-col gap-2 rounded-xl border border-border bg-surface-1 p-4 transition-colors hover:border-border-strong"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">
              <Calendar className="h-3 w-3" />
              {relativeDay(session.scheduled_at)}
              <span>·</span>
              <span>{session.duration_min} мин</span>
              <span>·</span>
              <span>{statusLabel(session.status)}</span>
              {session.presenter_handle && (
                <>
                  <span>·</span>
                  <span>@{session.presenter_handle}</span>
                </>
              )}
            </div>
            <h3 className="font-display text-sm font-bold text-text-primary">
              {session.topic_title}
            </h3>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 self-center text-text-muted transition-colors group-hover:text-text-primary" />
        </div>
        {variant === 'upcoming' && session.pre_read_md && (
          <p className="flex items-start gap-1.5 text-xs text-text-secondary">
            <BookOpen className="mt-0.5 h-3 w-3 shrink-0 text-text-muted" />
            <span className="line-clamp-2">{session.pre_read_md}</span>
          </p>
        )}
        {variant === 'past' && session.takeaways_md && (
          <p className="text-xs text-text-secondary line-clamp-2">{session.takeaways_md}</p>
        )}
      </Link>
    </li>
  )
}

function EmptyRow({ text }: { text: string }) {
  return (
    <li className="rounded-xl border border-border bg-surface-1 p-6 text-center text-sm text-text-muted">
      {text}
    </li>
  )
}
