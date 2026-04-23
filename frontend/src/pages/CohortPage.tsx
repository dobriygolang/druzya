// CohortPage — single cohort detail at /c/:slug.
//
// Shows: name, dates, status, goal text, members list, leaderboard,
// join/leave button. Anti-fallback:
//   - 404 from the API → dedicated not-found state, no mock cohort.
//   - empty leaderboard → empty-state copy, never fake rows.
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  useCohortQuery,
  useCohortLeaderboardQuery,
  useJoinCohortMutation,
  useLeaveCohortMutation,
} from '../lib/queries/cohort'
import { formatDate } from '../lib/i18n'
import { cn } from '../lib/cn'
import { readAccessToken } from '../lib/apiClient'

export default function CohortPage() {
  const { t } = useTranslation('pages')
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const detail = useCohortQuery(slug)
  const cohortID = detail.data?.cohort.id
  const leaderboard = useCohortLeaderboardQuery(cohortID)
  const join = useJoinCohortMutation()
  const leave = useLeaveCohortMutation()
  const isAuthed = !!readAccessToken()

  if (detail.isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-sm text-text-secondary sm:px-6">
        {t('common.load_failed') /* loading placeholder */}…
      </div>
    )
  }
  // Anti-fallback: 404 → dedicated not-found UI, не выдумываем когорту.
  if (!detail.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="mb-2 font-display text-2xl font-bold text-text-primary">
          {t('cohorts.not_found_title')}
        </h1>
        <p className="mb-6 text-sm text-text-secondary">{t('cohorts.not_found_subtitle')}</p>
        <button
          type="button"
          onClick={() => navigate('/cohorts')}
          className="rounded-md border border-border bg-surface-2 px-4 py-2 text-sm font-medium text-text-primary hover:border-accent/40"
        >
          {t('cohorts.back_to_list')}
        </button>
      </div>
    )
  }

  const { cohort, members } = detail.data

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <div className="mb-2 flex items-start justify-between gap-3">
          <h1 className="font-display text-3xl font-bold text-text-primary">{cohort.name}</h1>
          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-mono uppercase',
              cohort.status === 'active'
                ? 'bg-accent/15 text-accent'
                : 'bg-surface-2 text-text-secondary',
            )}
          >
            {cohort.status === 'active'
              ? t('cohorts.status_active')
              : cohort.status === 'graduated'
                ? t('cohorts.status_graduated')
                : t('cohorts.status_cancelled')}
          </span>
        </div>
        <div className="text-sm text-text-secondary">
          {t('cohorts.starts_at', { date: formatDate(cohort.starts_at) })} ·{' '}
          {t('cohorts.ends_in', { date: formatDate(cohort.ends_at) })}
        </div>
        <div className="mt-1 text-xs text-text-muted">
          {t('cohorts.goal')}: {t('cohorts.goal_default')} · /c/{cohort.slug}
        </div>
        <div className="mt-4 flex items-center gap-2">
          {isAuthed && cohort.status === 'active' && (
            <>
              <button
                type="button"
                onClick={() => join.mutate(cohort.id)}
                disabled={join.isPending}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-text-primary hover:opacity-90 disabled:opacity-60"
              >
                {t('cohorts.join')}
              </button>
              <button
                type="button"
                onClick={() => leave.mutate(cohort.id)}
                disabled={leave.isPending}
                className="rounded-md border border-border bg-surface-2 px-4 py-2 text-sm text-text-secondary hover:text-text-primary disabled:opacity-60"
              >
                {t('cohorts.leave')}
              </button>
            </>
          )}
        </div>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 font-display text-lg font-semibold text-text-primary">
          {t('cohorts.members_section')} · {members.length}
        </h2>
        {members.length === 0 ? (
          <div className="rounded-md border border-border bg-surface-1 p-4 text-sm text-text-secondary">
            {t('cohorts.empty')}
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="truncate font-mono text-text-secondary">{m.user_id.slice(0, 8)}</span>
                <span className="font-mono text-[11px] uppercase text-text-muted">{m.role}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold text-text-primary">
          {t('cohorts.leaderboard_section')}
        </h2>
        {leaderboard.isLoading && (
          <div className="text-sm text-text-secondary">{t('common.load_failed') /* loading */}…</div>
        )}
        {leaderboard.data && leaderboard.data.items.length === 0 && (
          <div className="rounded-md border border-border bg-surface-1 p-4 text-sm text-text-secondary">
            {t('cohorts.leaderboard_empty')}
          </div>
        )}
        {leaderboard.data && leaderboard.data.items.length > 0 && (
          <ol className="divide-y divide-border rounded-lg border border-border bg-surface-1">
            {leaderboard.data.items.map((row, i) => (
              <li key={row.user_id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-6 text-right font-mono text-text-muted">{i + 1}</span>
                <span className="flex-1 truncate text-text-primary">{row.display_name}</span>
                <span className="font-mono text-text-secondary">{row.overall_elo}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
