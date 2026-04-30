// /clubs — Phase 3 catalogue.
//
// Public catalogue of active is_public=true clubs. Card layout: cover
// stripe, name + tag, schedule_kind, curriculum preview. Clicks open
// /clubs/:slug.
//
// Curator entry: admin role видит «+ создать клуб» в hero. Modal делает
// POST /admin/clubs (server gates role=admin).

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Compass, Loader2, Plus, Sparkles, X } from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { useAdminDashboardQuery } from '../../lib/queries/admin'
import { useMyCirclesQuery } from '../../lib/queries/circles'
import {
  useClubsListQuery,
  useCreateClubMutation,
  type Club,
} from '../../lib/queries/clubs'

export default function ClubsPage() {
  const q = useClubsListQuery()
  const items = q.data ?? []

  const admin = useAdminDashboardQuery()
  const adminStatus = (admin.error as { status?: number } | null)?.status
  const isAdmin = !admin.isError && admin.isSuccess && adminStatus !== 403

  const [showCreate, setShowCreate] = useState(false)

  return (
    <AppShellV2>
      <div className="flex flex-col">
        <Hero count={items.length} isAdmin={isAdmin} onCreate={() => setShowCreate(true)} />
        <div className="px-4 py-6 sm:px-8 lg:px-20">
          {q.isLoading ? (
            <SkeletonGrid />
          ) : q.isError ? (
            <ErrorBlock onRetry={() => void q.refetch()} />
          ) : items.length === 0 ? (
            <EmptyBlock />
          ) : (
            <Grid clubs={items} />
          )}
        </div>
      </div>
      {showCreate && (
        <CreateClubModal onClose={() => setShowCreate(false)} />
      )}
    </AppShellV2>
  )
}

function Hero({
  count,
  isAdmin,
  onCreate,
}: {
  count: number
  isAdmin: boolean
  onCreate: () => void
}) {
  return (
    <div className="flex flex-col items-start gap-4 border-b border-border bg-surface-1 px-4 py-6 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-20 lg:py-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[28px]">
          Clubs
        </h1>
        <p className="max-w-xl text-sm text-text-secondary">
          Структурированные встречи внутри circles: curriculum, lecture
          schedule, recordings, takeaways. {count > 0 && `${count} активных.`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {isAdmin && (
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={onCreate}>
            создать клуб
          </Button>
        )}
        <Link to="/circles">
          <Button variant="ghost" size="sm" icon={<Compass className="h-3.5 w-3.5" />}>
            к circles
          </Button>
        </Link>
      </div>
    </div>
  )
}

function CreateClubModal({ onClose }: { onClose: () => void }) {
  const circles = useMyCirclesQuery()
  const create = useCreateClubMutation()
  const [form, setForm] = useState({
    circle_id: '',
    slug: '',
    name: '',
    topic_tag: '',
    curriculum_md: '',
    schedule_kind: 'weekly',
    default_zoom_link: '',
    is_public: false,
  })
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setErr(null)
    if (!form.circle_id || !form.slug || !form.name) {
      setErr('circle, slug, name — обязательны')
      return
    }
    try {
      await create.mutateAsync(form)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось создать')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface-1 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-text-primary">Новый клуб</h2>
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
            Circle
            <select
              value={form.circle_id}
              onChange={(e) => setForm((f) => ({ ...f, circle_id: e.target.value }))}
              className="rounded border border-border bg-surface-2 p-2 text-sm text-text-primary"
            >
              <option value="">— выбрать —</option>
              {(circles.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Slug (lowercase, latin)
            <input
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              placeholder="system-design-101"
              className="rounded border border-border bg-surface-2 p-2 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Название
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="System Design 101"
              className="rounded border border-border bg-surface-2 p-2 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Topic tag
            <input
              value={form.topic_tag}
              onChange={(e) => setForm((f) => ({ ...f, topic_tag: e.target.value }))}
              placeholder="system-design"
              className="rounded border border-border bg-surface-2 p-2 text-sm text-text-primary"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Curriculum (markdown)
            <textarea
              rows={3}
              value={form.curriculum_md}
              onChange={(e) => setForm((f) => ({ ...f, curriculum_md: e.target.value }))}
              className="rounded border border-border bg-surface-2 p-2 text-sm text-text-primary"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Schedule
              <select
                value={form.schedule_kind}
                onChange={(e) => setForm((f) => ({ ...f, schedule_kind: e.target.value }))}
                className="rounded border border-border bg-surface-2 p-2 text-sm text-text-primary"
              >
                <option value="weekly">weekly</option>
                <option value="biweekly">biweekly</option>
                <option value="ad-hoc">ad-hoc</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Default zoom
              <input
                value={form.default_zoom_link}
                onChange={(e) =>
                  setForm((f) => ({ ...f, default_zoom_link: e.target.value }))
                }
                placeholder="https://zoom.us/…"
                className="rounded border border-border bg-surface-2 p-2 text-sm text-text-primary"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={form.is_public}
              onChange={(e) => setForm((f) => ({ ...f, is_public: e.target.checked }))}
            />
            публичный (видно всем)
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

function Grid({ clubs }: { clubs: Club[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {clubs.map((c) => (
        <ClubCard key={c.id} club={c} />
      ))}
    </div>
  )
}

function ClubCard({ club }: { club: Club }) {
  return (
    <Link
      to={`/clubs/${encodeURIComponent(club.slug)}`}
      className="group flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-4 transition-colors hover:border-border-strong"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          {club.topic_tag && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
              {club.topic_tag}
            </span>
          )}
          <h3 className="font-display text-base font-bold text-text-primary line-clamp-2">
            {club.name}
          </h3>
        </div>
        {club.schedule_kind && (
          <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-muted shrink-0">
            {club.schedule_kind}
          </span>
        )}
      </div>
      {club.curriculum_md && (
        <p className="text-xs text-text-secondary line-clamp-3">
          {club.curriculum_md}
        </p>
      )}
      <div className="mt-auto flex items-center justify-end gap-1 font-mono text-[11px] text-text-muted transition-colors group-hover:text-text-primary">
        <span>open</span>
        <ArrowRight className="h-3 w-3" />
      </div>
    </Link>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-[140px] animate-pulse rounded-xl border border-border bg-surface-1"
        />
      ))}
    </div>
  )
}

function EmptyBlock() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface-1 p-8 text-center">
      <Sparkles className="h-7 w-7 text-text-muted" />
      <p className="text-sm text-text-secondary">
        Нет публичных clubs. Кураторы готовят первые встречи — загляни
        чуть позже.
      </p>
    </div>
  )
}

function ErrorBlock({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-danger/40 bg-surface-1 p-8 text-center">
      <Loader2 className="h-7 w-7 text-danger" />
      <p className="text-sm text-text-secondary">
        Не удалось загрузить clubs.
      </p>
      <Button size="sm" onClick={onRetry}>
        Повторить
      </Button>
    </div>
  )
}
