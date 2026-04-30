// /clubs/:slug/session/:id — Phase 3 single session view.
//
// Layout:
//   • Hero: topic_title, scheduled_at meta, presenter, status badge.
//   • Pre-read block (markdown raw → whitespace-pre-line).
//   • Action row: zoom link, TG-post link, recording (if done), RSVP.
//   • Materials list (kind/label/url).
//   • Summary + takeaways (if status=done).

import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  Check,
  ExternalLink,
  Loader2,
  PlayCircle,
  Video,
  X,
} from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import {
  relativeDay,
  statusLabel,
  useClubSessionQuery,
  useRSVPMutation,
  type AttendeeStatus,
  type ClubMaterial,
  type ClubSession,
} from '../../lib/queries/clubs'

export default function ClubSessionPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>()
  const navigate = useNavigate()
  const q = useClubSessionQuery(id)
  const rsvp = useRSVPMutation()

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
          <p className="text-sm text-text-secondary">Session не найдена.</p>
          <Button variant="ghost" onClick={() => navigate(slug ? `/clubs/${encodeURIComponent(slug)}` : '/clubs')}>
            ← Назад
          </Button>
        </div>
      </AppShellV2>
    )
  }

  const { session, materials } = q.data
  const attendee = q.data.attendee_status

  const onRSVP = (status: AttendeeStatus) => {
    if (!id) return
    void rsvp.mutate({ sessionId: id, status })
  }

  const canRSVP = session.status === 'scheduled' || session.status === 'live'
  const isDone = session.status === 'done'

  return (
    <AppShellV2>
      <div className="flex flex-col">
        <Hero session={session} clubSlug={slug ?? ''} />

        <div className="grid gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[1fr_320px] lg:px-20">
          <div className="flex flex-col gap-6">
            {session.pre_read_md && (
              <Card title="Pre-read" icon={<BookOpen className="h-4 w-4" />}>
                <p className="whitespace-pre-line text-sm text-text-secondary">{session.pre_read_md}</p>
              </Card>
            )}
            {session.topic_md && (
              <Card title="О чём встреча">
                <p className="whitespace-pre-line text-sm text-text-secondary">{session.topic_md}</p>
              </Card>
            )}
            {materials.length > 0 && (
              <Card title="Материалы">
                <ul className="flex flex-col gap-2">
                  {materials.map((m) => <MaterialRow key={m.id} material={m} />)}
                </ul>
              </Card>
            )}
            {isDone && session.summary_md && (
              <Card title="Summary">
                <p className="whitespace-pre-line text-sm text-text-secondary">{session.summary_md}</p>
              </Card>
            )}
            {isDone && session.takeaways_md && (
              <Card title="Takeaways">
                <p className="whitespace-pre-line text-sm text-text-secondary">{session.takeaways_md}</p>
              </Card>
            )}
          </div>

          <aside className="flex flex-col gap-3 lg:sticky lg:top-24 lg:self-start">
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-1 p-4">
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Действия</span>
              {session.zoom_link && (
                <a
                  href={session.zoom_link}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-text-primary px-4 font-sans text-[13px] font-medium text-bg hover:opacity-90"
                >
                  <Video className="h-3.5 w-3.5" />
                  Zoom
                </a>
              )}
              {session.recording_url && (
                <a
                  href={session.recording_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-border-strong px-4 font-sans text-[13px] text-text-primary hover:bg-surface-2"
                >
                  <PlayCircle className="h-3.5 w-3.5" />
                  Recording
                </a>
              )}
              {session.tg_post_url && (
                <a
                  href={session.tg_post_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-border-strong px-4 font-sans text-[13px] text-text-primary hover:bg-surface-2"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  TG post
                </a>
              )}
              {canRSVP && (
                <div className="mt-1 flex flex-col gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">RSVP</span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => onRSVP('rsvp_yes')}
                      disabled={rsvp.isPending}
                      className={[
                        'rounded-md border px-2 py-1 font-mono text-[11px]',
                        attendee === 'rsvp_yes' || attendee === 'attended'
                          ? 'border-success/60 bg-success/10 text-success'
                          : 'border-border bg-surface-2 text-text-secondary hover:border-success/40 hover:text-success',
                      ].join(' ')}
                    >
                      <Check className="mr-1 inline h-3 w-3" />
                      Иду
                    </button>
                    <button
                      type="button"
                      onClick={() => onRSVP('rsvp_no')}
                      disabled={rsvp.isPending}
                      className={[
                        'rounded-md border px-2 py-1 font-mono text-[11px]',
                        attendee === 'rsvp_no'
                          ? 'border-border-strong bg-surface-2 text-text-primary'
                          : 'border-border bg-surface-2 text-text-muted hover:text-text-primary',
                      ].join(' ')}
                    >
                      <X className="mr-1 inline h-3 w-3" />
                      Не иду
                    </button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </AppShellV2>
  )
}

function Hero({ session, clubSlug }: { session: ClubSession; clubSlug: string }) {
  return (
    <div className="border-b border-border bg-surface-1 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
      <div className="flex flex-col gap-3">
        <Link
          to={clubSlug ? `/clubs/${encodeURIComponent(clubSlug)}` : '/clubs'}
          className="inline-flex items-center gap-1 self-start font-mono text-[11px] text-text-muted transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-3 w-3" />
          Club
        </Link>
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
        <h1 className="font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[28px]">
          {session.topic_title}
        </h1>
      </div>
    </div>
  )
}

function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-4">
      <h2 className="flex items-center gap-2 font-display text-sm font-bold text-text-primary">
        {icon}
        {title}
      </h2>
      <div>{children}</div>
    </section>
  )
}

function MaterialRow({ material }: { material: ClubMaterial }) {
  return (
    <li>
      <a
        href={material.url}
        target="_blank"
        rel="noreferrer"
        className="group flex items-center gap-2 rounded-md border border-border bg-surface-2 p-2 hover:border-border-strong"
      >
        <span className="rounded border border-border bg-surface-1 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
          {material.kind}
        </span>
        <span className="flex-1 text-xs text-text-primary">{material.label}</span>
        <ExternalLink className="h-3 w-3 text-text-muted transition-colors group-hover:text-text-primary" />
      </a>
    </li>
  )
}
