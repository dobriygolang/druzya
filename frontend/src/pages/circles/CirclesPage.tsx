// /circles — community surface (book clubs, study groups, hackathon pods).
// MVP scope:
//   - My circles tab: lists circles the user is in.
//   - Discover tab: lists circles the user can join (browse/search).
//   - Create circle inline.
// Inside a circle (CircleDetailPage): events only — no chat. Hone reads
// these events and shows them on a calendar / pings members.

import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Users } from 'lucide-react'

import { AppShellV2 } from '../../components/AppShell'
import {
  createCircle,
  joinCircle,
  useDiscoverCirclesQuery,
  useMyCirclesQuery,
  type Circle,
  type DiscoverCircle,
} from '../../lib/queries/circles'

type Tab = 'my' | 'discover'

export default function CirclesPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('my')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [creating, setCreating] = useState(false)
  const [actionErr, setActionErr] = useState<string | null>(null)

  const my = useMyCirclesQuery()
  const discover = useDiscoverCirclesQuery()

  const filteredMy = useMemo(
    () => filterByName(my.data ?? [], search),
    [my.data, search],
  )
  const filteredDiscover = useMemo(
    () => filterByName(discover.data ?? [], search),
    [discover.data, search],
  )

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setCreating(true)
    setActionErr(null)
    try {
      const c = await createCircle({
        name: form.name.trim(),
        description: form.description.trim(),
      })
      navigate(`/circles/${c.id}`)
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const onJoin = async (id: string) => {
    setActionErr(null)
    try {
      await joinCircle(id)
      void my.refetch()
      void discover.refetch()
      navigate(`/circles/${id}`)
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <AppShellV2>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8 lg:py-14">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-extrabold text-text-primary sm:text-4xl">
            Circles
          </h1>
          <p className="mt-2 text-[14px] text-text-muted">
            Communities by interest. Inside a circle members create events —
            Hone shows them on the calendar and pings participants.
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-5 flex items-center gap-1 border-b border-border">
          <TabBtn label="My circles" active={tab === 'my'} onClick={() => setTab('my')} />
          <TabBtn label="Discover" active={tab === 'discover'} onClick={() => setTab('discover')} />
          <div className="ml-auto pb-2">
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[12px] font-semibold text-text-primary transition-colors hover:bg-surface-2"
            >
              <Plus className="h-3.5 w-3.5" />
              {showCreate ? 'Close' : 'New circle'}
            </button>
          </div>
        </div>

        {showCreate && (
          <form
            onSubmit={onCreate}
            className="mb-6 rounded-xl border border-border bg-surface-1 p-5"
          >
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">
              New circle
            </div>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="DDIA Reading Club"
              className="w-full bg-transparent text-[16px] font-medium text-text-primary outline-none placeholder:text-text-muted"
            />
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What we discuss (optional)"
              rows={2}
              className="mt-2 w-full resize-none bg-transparent text-[13px] text-text-secondary outline-none placeholder:text-text-muted"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="submit"
                disabled={creating || !form.name.trim()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-text-primary px-4 text-[13px] font-semibold text-bg disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        )}

        {/* Search */}
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2">
          <Search className="h-4 w-4 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name"
            className="flex-1 bg-transparent text-[14px] text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>

        {actionErr && (
          <div className="mb-4 rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-[13px] text-text-secondary">
            {actionErr}
          </div>
        )}

        {tab === 'my' ? (
          <MyCirclesList
            isLoading={my.isLoading}
            isError={my.isError}
            error={my.error}
            circles={filteredMy}
          />
        ) : (
          <DiscoverList
            isLoading={discover.isLoading}
            isError={discover.isError}
            error={discover.error}
            circles={filteredDiscover}
            onJoin={(id) => void onJoin(id)}
          />
        )}
      </div>
    </AppShellV2>
  )
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'relative px-4 pb-2 pt-1 font-sans text-[13px] transition-colors',
        active
          ? 'font-semibold text-text-primary after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-text-primary'
          : 'text-text-secondary hover:text-text-primary',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function MyCirclesList({
  isLoading,
  isError,
  error,
  circles,
}: {
  isLoading: boolean
  isError: boolean
  error: unknown
  circles: Circle[]
}) {
  if (isLoading) return <p className="text-[13px] text-text-muted">Loading…</p>
  if (isError) {
    return (
      <p className="text-[13px] text-text-muted">
        {error instanceof Error ? error.message : 'Failed to load.'}
      </p>
    )
  }
  if (circles.length === 0) {
    return (
      <p className="text-[13px] text-text-muted">
        No circles yet — create one above or browse Discover.
      </p>
    )
  }
  return (
    <ul className="grid gap-3">
      {circles.map((c) => (
        <li
          key={c.id}
          className="rounded-lg border border-border bg-surface-1 transition-colors hover:border-border-strong"
        >
          <Link to={`/circles/${c.id}`} className="block p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-text-primary">
                  {c.name}
                </div>
                {c.description && (
                  <div className="mt-1 line-clamp-2 text-[13px] text-text-secondary">
                    {c.description}
                  </div>
                )}
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-text-muted">
                <Users className="h-3 w-3" />
                {c.member_count || 1}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function DiscoverList({
  isLoading,
  isError,
  error,
  circles,
  onJoin,
}: {
  isLoading: boolean
  isError: boolean
  error: unknown
  circles: DiscoverCircle[]
  onJoin: (id: string) => void
}) {
  if (isLoading) return <p className="text-[13px] text-text-muted">Loading…</p>
  if (isError) {
    return (
      <p className="text-[13px] text-text-muted">
        {error instanceof Error ? error.message : 'Failed to load.'}
      </p>
    )
  }
  if (circles.length === 0) {
    return (
      <p className="text-[13px] text-text-muted">
        Nothing to discover — be the first to start a circle.
      </p>
    )
  }
  return (
    <ul className="grid gap-3">
      {circles.map((c) => (
        <li
          key={c.id}
          className="rounded-lg border border-border bg-surface-1 p-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-text-primary">
                {c.name}
              </div>
              {c.description && (
                <div className="mt-1 line-clamp-2 text-[13px] text-text-secondary">
                  {c.description}
                </div>
              )}
              <div className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-text-muted">
                <Users className="h-3 w-3" />
                {c.member_count} member{c.member_count === 1 ? '' : 's'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onJoin(c.id)}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-text-primary px-3 text-[12px] font-semibold text-bg hover:bg-text-primary/90"
            >
              Join
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function filterByName<T extends { name: string }>(items: T[], q: string): T[] {
  const s = q.trim().toLowerCase()
  if (!s) return items
  return items.filter((i) => i.name.toLowerCase().includes(s))
}
