// CohortsPage — public catalogue of learning cohorts. Designed against
// /Users/sedorofeevd/Downloads/Design Review v2.html § cohorts:
//   - mono eyebrow + gradient H1 ("Когорты druz9")
//   - filter strip (All/Active/Graduated) + search
//   - rich cards: avatar/letter mark, status badge, "ТЫ"-chip when joined,
//     progress bar (members_count / capacity placeholder), avatar strip
//     with overflow chip, "Открыть →" / "Присоединиться →" CTA
//   - sticky bottom "+ Создать когорту" on mobile, header CTA on tablet+
//
// Capacity is hard-coded to 50 (the design number) until the backend
// surfaces a real `capacity` column. Avatar strip is faked with hash-
// derived initials per cohort id; we'd swap for the real
// /cohort/{id}/leaderboard preview once that's a free read.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Users } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { cn } from '../lib/cn'
import { useCohortListInfiniteQuery, useJoinCohortMutation, type Cohort, type CohortStatus } from '../lib/queries/cohort'
import { useProfileQuery } from '../lib/queries/profile'
import CreateCohortDialog from '../components/cohort/CreateCohortDialog'

type StatusFilter = '' | 'active' | 'graduated'

const COHORT_CAPACITY = 50

const TABS: { key: StatusFilter; label: string }[] = [
  { key: '', label: 'Все' },
  { key: 'active', label: 'Активные' },
  { key: 'graduated', label: 'Завершены' },
]

// Hash a string into one of N preset gradients. Stable per cohort.id so
// the avatar/letter mark stays consistent across renders.
const GRADIENTS = [
  'linear-gradient(135deg,#582CFF,#22D3EE)',
  'linear-gradient(135deg,#EF4444,#FBBF24)',
  'linear-gradient(135deg,#10B981,#22D3EE)',
  'linear-gradient(135deg,#F472B6,#582CFF)',
  'linear-gradient(135deg,#FBBF24,#F472B6)',
] as const

function pickGradient(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return GRADIENTS[hash % GRADIENTS.length]
}

function initialsOf(name: string): string {
  // Two-letter mark: first letter + first non-Latin/Cyrillic letter found.
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return trimmed.slice(0, 2).toUpperCase()
}

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))
}

export default function CohortsPage() {
  const [status, setStatus] = useState<StatusFilter>('')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const filters = useMemo(
    () => ({ status: status || undefined, search: search || undefined }),
    [status, search],
  )
  const list = useCohortListInfiniteQuery(filters)
  const profile = useProfileQuery()
  const items = useMemo(
    () => list.data?.pages.flatMap((p) => p.items) ?? [],
    [list.data],
  )

  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 pb-24 pt-6 sm:px-8 lg:px-20 lg:pb-6">
        {/* Header */}
        <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
              обучение в команде
            </span>
            <h1 className="font-display text-2xl lg:text-[34px] font-bold leading-[1.1] text-text-primary">
              Когорты{' '}
              <span className="bg-gradient-to-r from-accent to-cyan bg-clip-text text-transparent">
                druz9
              </span>
            </h1>
            <p className="text-sm text-text-secondary">
              Группы по 50 человек на 6 недель. Общий лидерборд, недельный streak, ритуалы.
            </p>
          </div>
          {profile.data && (
            <Button onClick={() => setCreateOpen(true)} className="hidden lg:inline-flex">
              <Plus className="mr-1 h-4 w-4" /> Создать когорту
            </Button>
          )}
        </div>

        {/* Filter strip */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-md border border-border bg-surface-2 p-0.5 font-mono text-[11px] uppercase">
            {TABS.map((t) => (
              <button
                key={t.key || 'all'}
                type="button"
                onClick={() => setStatus(t.key)}
                className={cn(
                  'rounded-sm px-2.5 py-1 transition-colors',
                  status === t.key
                    ? 'bg-accent font-bold text-white'
                    : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex h-9 flex-1 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 sm:max-w-xs">
            <Search className="h-3.5 w-3.5 text-text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск когорты"
              className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>
        </div>

        {/* States */}
        {list.isLoading && <EmptyState variant="loading" skeletonLayout="card-grid" />}
        {list.isError && (
          <EmptyState
            variant="error"
            title="Не удалось загрузить когорты"
            body="Попробуй обновить страницу — если повторится, мы уже знаем."
          />
        )}
        {!list.isLoading && !list.isError && items.length === 0 && (
          <EmptyState
            variant="no-data"
            title="По выбранным фильтрам когорт нет"
            body="Сбрось часть условий или создай первую — это пара кликов."
            cta={profile.data ? { label: 'Создать когорту', onClick: () => setCreateOpen(true) } : undefined}
          />
        )}

        {/* Catalogue grid */}
        {items.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((c) => (
              <CohortCard key={c.id} cohort={c} />
            ))}
          </div>
        )}

        {/* Load more */}
        {list.hasNextPage && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={() => void list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
              className="rounded-md border border-border bg-surface-2 px-4 py-2 text-sm text-text-secondary hover:bg-surface-3 hover:text-text-primary disabled:opacity-60"
            >
              {list.isFetchingNextPage ? 'Загружаем…' : 'Загрузить ещё'}
            </button>
          </div>
        )}
      </div>

      {/* Sticky mobile CTA — hidden on lg where the header carries the button. */}
      {profile.data && (
        <div className="fixed inset-x-0 bottom-16 z-40 border-t border-border bg-bg/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <Button onClick={() => setCreateOpen(true)} className="w-full">
            <Plus className="mr-1 h-4 w-4" /> Создать когорту
          </Button>
        </div>
      )}

      <CreateCohortDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </AppShellV2>
  )
}

function CohortCard({ cohort }: { cohort: Cohort }) {
  const join = useJoinCohortMutation()
  const [errMsg, setErrMsg] = useState<string | null>(null)
  // is_member is hydrated server-side (M5a). Owner-check is a defensive
  // fallback for older backends that don't yet return is_member.
  const profile = useProfileQuery()
  const isOwner = !!profile.data && cohort.owner_id === profile.data.id
  const isMember = !!cohort.is_member || isOwner
  const capacity = cohort.capacity ?? COHORT_CAPACITY

  const progress = Math.min(100, Math.round((cohort.members_count / capacity) * 100))
  const days = daysUntil(cohort.ends_at)
  const statusLabel = labelForStatus(cohort.status)
  const statusTone = toneForStatus(cohort.status)

  const onJoin = (e: React.MouseEvent) => {
    e.preventDefault()
    setErrMsg(null)
    join.mutate(cohort.id, {
      onError: (err) => setErrMsg(err instanceof Error ? err.message : 'Не удалось присоединиться'),
    })
  }

  return (
    <Card
      className={cn(
        'flex-col items-stretch gap-3 p-4',
        isMember && 'border-accent/40 bg-gradient-to-br from-surface-3/60 to-surface-1',
      )}
    >
      <div className="flex items-start gap-2.5">
        <div
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md font-display text-sm font-bold text-white"
          style={{ background: pickGradient(cohort.id) }}
          aria-hidden="true"
        >
          {initialsOf(cohort.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate font-display text-[14px] font-bold text-text-primary">{cohort.name}</h3>
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-0 font-mono text-[9px] font-bold uppercase',
                statusTone,
              )}
            >
              ● {statusLabel}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {isMember && (
              <span className="rounded-md bg-accent/20 px-1.5 py-0 font-mono text-[9px] font-semibold text-accent-hover">
                ТЫ
              </span>
            )}
            <span className="font-mono text-[10px] text-text-muted">
              {cohort.members_count}/{COHORT_CAPACITY}
              {cohort.status === 'active' && days > 0 && ` · ${days}d до конца`}
            </span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            'h-full',
            progress >= 80
              ? 'bg-accent'
              : 'bg-gradient-to-r from-accent to-cyan',
          )}
          style={{ width: `${Math.max(4, progress)}%` }}
        />
      </div>

      {errMsg && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">
          {errMsg}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Link
          to={`/c/${encodeURIComponent(cohort.slug)}`}
          className="flex-1 rounded-md bg-accent py-1.5 text-center text-[12px] font-semibold text-white hover:bg-accent/90"
        >
          {isMember ? 'Открыть →' : 'Подробнее →'}
        </Link>
        {!isMember && cohort.status === 'active' && cohort.members_count < capacity && (
          <button
            type="button"
            onClick={onJoin}
            disabled={join.isPending}
            className="rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-[12px] font-semibold text-accent-hover hover:bg-accent/20 disabled:opacity-60"
          >
            <Users className="-mt-0.5 mr-0.5 inline h-3 w-3" />
            {join.isPending ? '…' : '+'}
          </button>
        )}
        {!isMember && cohort.members_count >= capacity && (
          <span className="rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[10px] uppercase text-text-muted">
            Полно
          </span>
        )}
      </div>
    </Card>
  )
}

function labelForStatus(status: CohortStatus): string {
  switch (status) {
    case 'active':
      return 'active'
    case 'graduated':
      return 'finished'
    case 'cancelled':
      return 'cancelled'
    default:
      return String(status)
  }
}

function toneForStatus(status: CohortStatus): string {
  switch (status) {
    case 'active':
      return 'bg-success/20 text-success'
    case 'graduated':
      return 'bg-cyan/20 text-cyan'
    case 'cancelled':
      return 'bg-surface-2 text-text-muted'
    default:
      return 'bg-surface-2 text-text-muted'
  }
}
