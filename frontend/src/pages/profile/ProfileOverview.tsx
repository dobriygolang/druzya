import { useState } from 'react'
import { Shield, Crown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Card } from '../../components/Card'
import { Avatar } from '../../components/Avatar'
import { cn } from '../../lib/cn'
import { useRatingMeQuery, useLeaderboardQuery } from '../../lib/queries/rating'
import { useMyCirclesQuery } from '../../lib/queries/circles'
import { SECTION_LABELS } from './viewModel'

// SkillsCard renders the live section ratings only — no synthetic fallback.
// When there are no ratings yet (new user) the card explicitly says so;
// previously we filled it with mock skills which gave a misleading impression
// of accomplishment.
export function SkillsCard() {
  const { t } = useTranslation('profile')
  const { data: rating, isLoading } = useRatingMeQuery()
  const skills = (rating?.ratings ?? []).map((r) => ({
    name: SECTION_LABELS[r.section] ?? r.section,
    value: Math.min(100, r.percentile),
    delta: r.decaying ? '↓' : `${r.elo}`,
    up: !r.decaying,
  }))
  return (
    <Card className="flex-col gap-4 p-5">
      <h3 className="font-display text-base font-bold text-text-primary">{t('skills')}</h3>
      {isLoading && <div className="font-mono text-[12px] text-text-muted">…</div>}
      {!isLoading && skills.length === 0 && (
        <div className="font-mono text-[12px] text-text-muted">{t('skills_empty')}</div>
      )}
      <div className="flex flex-col gap-3">
        {skills.map((s) => (
          <div key={s.name} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-text-secondary">{s.name}</span>
              <span className={cn('font-mono text-[12px] font-semibold', s.up ? 'text-success' : 'text-danger')}>
                {s.delta}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-black/30">
              <div
                className="h-full rounded-full bg-text-primary"
                style={{ width: `${s.value}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// Phase-4 ADR-001: AchievementsCard removed (gamification cut).

// CohortCard renamed to CircleCard (Wave 2 — cohort merged into circles).
// Shows membership count + most-recent circle name.
export function CohortCard() {
  const { data: circles, isLoading } = useMyCirclesQuery()
  if (isLoading) {
    return (
      <Card className="flex-col gap-2 p-5">
        <div className="h-4 w-1/3 animate-pulse rounded bg-surface-3" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-surface-3" />
      </Card>
    )
  }
  const list = circles ?? []
  if (list.length === 0) {
    return (
      <Card className="flex-col gap-0 overflow-hidden p-0" interactive={false}>
        <div className="flex flex-col gap-2 border-b border-border bg-surface-2 p-5">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-text-primary" />
            <span className="font-mono text-[11px] font-medium tracking-[0.08em] text-text-primary">CIRCLES</span>
          </div>
          <h3 className="font-display text-xl font-extrabold text-text-primary">Без circle</h3>
          <p className="text-xs text-text-secondary">Найди community — общие ивенты, обсуждения, события.</p>
        </div>
        <div className="flex items-center justify-between p-4">
          <Link to="/circles" className="font-mono text-[12px] font-medium text-text-primary hover:underline">
            Найти circle ›
          </Link>
        </div>
      </Card>
    )
  }
  const primary = list[0]
  return (
    <Card className="flex-col gap-0 overflow-hidden p-0" interactive={false}>
      <div className="flex flex-col gap-2 border-b border-border bg-surface-2 p-5">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-text-primary" />
          <span className="font-mono text-[11px] font-medium tracking-[0.08em] text-text-primary">CIRCLES</span>
        </div>
        <h3 className="font-display text-xl font-extrabold text-text-primary">{primary.name}</h3>
        <p className="text-xs text-text-secondary">
          {primary.members?.length ?? 0} участников
          {list.length > 1 ? ` · и ещё ${list.length - 1}` : ''}
        </p>
      </div>
      <div className="flex items-center justify-between p-4">
        <Link to={`/circles/${primary.id}`} className="font-mono text-[12px] font-medium text-text-primary hover:underline">
          Открыть circle ›
        </Link>
      </div>
    </Card>
  )
}

// Leaderboard scopes — only "global" is implemented end-to-end. The other
// scopes (friends/cohort/region) were previously rendered as fake tabs that
// returned the same hardcoded data; per production feedback we now expose
// only what we can actually back with real data.
type Scope = 'global'
const SCOPES: Scope[] = ['global']

function MedalBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="grid h-7 w-7 place-items-center rounded-full bg-warn font-display text-[13px] font-bold text-bg">
        <Crown className="h-3.5 w-3.5" />
      </span>
    )
  if (rank === 2)
    return (
      <span className="grid h-7 w-7 place-items-center rounded-full bg-[#C0C0C0] font-display text-[13px] font-bold text-bg">
        2
      </span>
    )
  if (rank === 3)
    return (
      <span className="grid h-7 w-7 place-items-center rounded-full bg-[#CD7F32] font-display text-[13px] font-bold text-white">
        3
      </span>
    )
  return (
    <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-1 font-mono text-[12px] font-semibold text-text-secondary">
      {rank}
    </span>
  )
}

// Leaderboard renders only real entries from the rating service. No fallback
// roster is rendered — when the leaderboard is empty (or the network is
// down) the user sees an explicit empty/error state instead of synthetic data.
export function Leaderboard() {
  const { t } = useTranslation('profile')
  const [scope] = useState<Scope>('global')
  const { data: lb, isError, isLoading, refetch } = useLeaderboardQuery('algorithms')
  const rows = (lb?.entries ?? []).map((e) => ({
    rank: e.rank,
    name: `@${e.username}`,
    tier: e.title ?? '—',
    lp: `${e.elo}`,
    wl: '—',
    wr: '—',
    delta: '+0',
  }))
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-surface-2 min-w-0">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h3 className="font-display text-lg font-bold text-text-primary">{t('leaderboard')}</h3>
        <div className="flex items-center gap-1 rounded-md bg-surface-1 p-1">
          {SCOPES.map((s) => (
            <span
              key={s}
              className={cn(
                'h-7 rounded px-3 text-[12px] font-semibold leading-7 transition-colors',
                scope === s ? 'bg-text-primary text-bg' : 'text-text-secondary',
              )}
            >
              {t(`scopes.${s}`)}
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-[50px_1fr_70px_90px_60px_60px] min-w-[640px] items-center gap-3 border-b border-border px-5 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
        <span>{t('table.rank')}</span>
        <span>{t('table.player')}</span>
        <span className="text-right">{t('table.lp')}</span>
        <span className="text-right">{t('table.wl')}</span>
        <span className="text-right">{t('table.wr')}</span>
        <span className="text-right">{t('table.delta')}</span>
      </div>
      <div className="flex-1 overflow-x-auto">
        {isLoading && <div className="px-5 py-3 text-[12px] text-text-muted">…</div>}
        {isError && (
          <div className="flex items-center justify-between px-5 py-3 text-[12px] text-danger">
            <span>{t('load_failed')}</span>
            <button onClick={() => refetch()} className="font-mono text-[12px] text-text-primary hover:underline">
              {t('retry')}
            </button>
          </div>
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <div className="px-5 py-3 text-[12px] text-text-muted">
            {t('leaderboard_empty')}
          </div>
        )}
        {rows.map((r) => {
          const positive = r.delta.startsWith('+')
          return (
            <div
              key={r.rank}
              className="grid grid-cols-[50px_1fr_70px_90px_60px_60px] min-w-[640px] items-center gap-3 px-5 py-2.5 text-[13px] transition-colors border-b border-border/50 hover:bg-surface-1/40"
            >
              <MedalBadge rank={r.rank} />
              <div className="flex items-center gap-2.5">
                <Avatar size="sm" gradient="violet-cyan" initials={r.name[1]?.toUpperCase()} />
                <div className="flex flex-col leading-tight">
                  <span className="text-sm font-semibold text-text-primary">{r.name}</span>
                  <span className="font-mono text-[10px] text-text-muted">{r.tier}</span>
                </div>
              </div>
              <span className="text-right font-mono text-[13px] font-semibold text-text-primary">{r.lp}</span>
              <span className="text-right font-mono text-[12px] text-text-secondary">{r.wl}</span>
              <span className="text-right font-mono text-[12px] text-text-secondary">{r.wr}</span>
              <span
                className={cn(
                  'text-right font-mono text-[12px] font-semibold',
                  positive ? 'text-success' : 'text-danger',
                )}
              >
                {r.delta}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
