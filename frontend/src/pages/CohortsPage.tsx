// CohortsPage — public list of cohorts (Phase 1 MVP).
//
// Filters: status (all|active|finished) + plain-text search. Renders a
// minimal grid of cards linking to /c/{slug}. Anti-fallback: an empty
// list shows an empty-state, never injects mock cohorts.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useCohortListQuery } from '../lib/queries/cohort'
import { formatDate } from '../lib/i18n'
import { cn } from '../lib/cn'

type StatusFilter = '' | 'active' | 'graduated'

export default function CohortsPage() {
  const { t } = useTranslation('pages')
  const [status, setStatus] = useState<StatusFilter>('')
  const [search, setSearch] = useState('')

  const filters = useMemo(
    () => ({ status: status || undefined, search: search || undefined }),
    [status, search],
  )
  const list = useCohortListQuery(filters)

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold text-text-primary">
          {t('cohorts.title')}
        </h1>
        <p className="text-sm text-text-secondary">{t('cohorts.subtitle')}</p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(['', 'active', 'graduated'] as StatusFilter[]).map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatus(s)}
            className={cn(
              'rounded-md border border-border px-3 py-1.5 text-sm transition-colors',
              status === s
                ? 'bg-surface-2 font-semibold text-text-primary'
                : 'text-text-secondary hover:bg-surface-2',
            )}
          >
            {s === '' ? t('cohorts.filter_all') : s === 'active' ? t('cohorts.filter_active') : t('cohorts.filter_finished')}
          </button>
        ))}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('common.search')}
          className="ml-auto h-9 rounded-md border border-border bg-surface-2 px-3 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
        />
      </div>

      {list.isLoading && (
        <div className="text-sm text-text-secondary">{t('common.load_failed') /* loading placeholder */}…</div>
      )}
      {list.isError && (
        <div className="rounded-md border border-border bg-surface-1 p-4 text-sm text-text-secondary">
          {t('common.load_failed')}
        </div>
      )}
      {list.data && list.data.items.length === 0 && (
        <div className="rounded-md border border-border bg-surface-1 p-8 text-center text-sm text-text-secondary">
          {t('cohorts.empty')}
        </div>
      )}
      {list.data && list.data.items.length > 0 && (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.items.map((c) => (
            <li key={c.id}>
              <Link
                to={`/c/${encodeURIComponent(c.slug)}`}
                className="block rounded-lg border border-border bg-surface-1 p-4 transition-colors hover:border-accent/40 hover:bg-surface-2"
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <h3 className="truncate font-display text-base font-semibold text-text-primary">{c.name}</h3>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-mono uppercase',
                      c.status === 'active'
                        ? 'bg-accent/15 text-accent'
                        : c.status === 'graduated'
                          ? 'bg-surface-2 text-text-secondary'
                          : 'bg-surface-2 text-text-muted',
                    )}
                  >
                    {c.status === 'active'
                      ? t('cohorts.status_active')
                      : c.status === 'graduated'
                        ? t('cohorts.status_graduated')
                        : t('cohorts.status_cancelled')}
                  </span>
                </div>
                <div className="mb-2 text-xs text-text-muted">{c.slug}</div>
                <div className="text-sm text-text-secondary">
                  {t('cohorts.members', { count: c.members_count })}
                </div>
                <div className="mt-1 text-xs text-text-muted">
                  {t('cohorts.ends_in', { date: formatDate(c.ends_at) })}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
