// CohortsArchivePage — Hall-of-Fame twin of /cohorts. Lists graduated
// cohorts with their alumni count + finish date. Status filter is
// locked to `graduated`; we bypass the status tabs of the main page
// entirely so the page reads as a dedicated surface.
//
// Reuse rationale: instead of threading a `mode='archive'` prop into
// CohortsPage (which would fork the layout with conditionals) we ship
// a thin page that hits the same /cohort/list endpoint with a pinned
// filter. Keeps each page's JSX readable.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, GraduationCap } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { useCohortListInfiniteQuery } from '../lib/queries/cohort'

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

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
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return trimmed.slice(0, 2).toUpperCase()
}

export default function CohortsArchivePage() {
  const filters = useMemo(
    () => ({ status: 'graduated', sort: 'ending' as const }),
    [],
  )
  const list = useCohortListInfiniteQuery(filters)
  const items = useMemo(
    () => list.data?.pages.flatMap((p) => p.items) ?? [],
    [list.data],
  )

  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 pb-24 pt-6 sm:px-8 lg:px-20 lg:pb-6">
        <Link
          to="/cohorts"
          className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> К активным когортам
        </Link>

        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
            hall of fame
          </span>
          <h1 className="font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[34px]">
            Архив{' '}
            <span className="bg-gradient-to-r from-cyan to-accent bg-clip-text text-transparent">
              выпусков
            </span>
          </h1>
          <p className="text-sm text-text-secondary">
            Когорты, которые прошли 6 недель до конца. Выпускники получают бейдж «Cohort Alumni» +400 XP.
          </p>
        </div>

        {list.isLoading && <EmptyState variant="loading" skeletonLayout="card-grid" />}
        {list.isError && (
          <EmptyState
            variant="error"
            title="Не удалось загрузить архив"
            body="Попробуй обновить страницу."
          />
        )}
        {!list.isLoading && !list.isError && items.length === 0 && (
          <EmptyState
            variant="no-data"
            title="Пока никто не выпустился"
            body="Когда первая когорта пройдёт срок до конца — она окажется здесь."
          />
        )}

        {items.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((c) => (
              <Card key={c.id} className="flex-col items-stretch gap-3 p-4">
                <div className="flex items-start gap-2.5">
                  <div
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-md font-display text-sm font-bold text-white"
                    style={{ background: pickGradient(c.id) }}
                    aria-hidden="true"
                  >
                    {initialsOf(c.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-display text-[14px] font-bold text-text-primary">
                      {c.name}
                    </h3>
                    <p className="mt-0.5 font-mono text-[10px] text-text-muted">
                      <GraduationCap className="-mt-0.5 mr-0.5 inline h-3 w-3" />
                      {c.members_count} выпускников · {fmtDate(c.ends_at)}
                    </p>
                  </div>
                </div>

                {c.top_members && c.top_members.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <div className="flex -space-x-1.5">
                      {c.top_members.slice(0, 3).map((m) => (
                        <span
                          key={m.user_id}
                          className="grid h-6 w-6 place-items-center rounded-full border border-surface-1 font-mono text-[10px] font-semibold text-white"
                          style={{ background: pickGradient(m.user_id) }}
                          title={m.display_name || m.username || ''}
                        >
                          {(m.display_name || m.username || '?').slice(0, 1).toUpperCase()}
                        </span>
                      ))}
                    </div>
                    {c.members_count > 3 && (
                      <span className="rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                        +{c.members_count - 3}
                      </span>
                    )}
                  </div>
                )}

                <Link
                  to={`/c/${encodeURIComponent(c.slug)}`}
                  className="rounded-md border border-border bg-surface-2 py-1.5 text-center text-[12px] font-semibold text-text-primary hover:bg-surface-3"
                >
                  Смотреть выпуск →
                </Link>
              </Card>
            ))}
          </div>
        )}

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
    </AppShellV2>
  )
}
