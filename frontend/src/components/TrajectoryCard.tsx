// Цель: визуализировать персональную траекторию юзера over 30d. Это
// «прогресс-двойник» не на уровне per-skill (это придёт с backend
// resource→atlas node mapping), а на уровне overall activity. Mirror'ит:
//   - daily activity counts (sparkline)
//   - this week vs last week delta
//   - total time invested (minutes)
//   - days active out of 30
//   - verdict («на подъёме» / «просел» / «строит привычку»)
//
// Anti-fallback: если за 30 дней ни одного activity, рендерим CTA-карточку
// «ничего не залогировано», не симулируем «нормально».
//
// B/W rule: red 1.5px stripe слева когда verdict='просел' (warning signal).

import { TrendingUp, TrendingDown, Minus, Flame, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Sparkline } from './Sparkline'
import { computeTrajectory } from '../lib/activity'
import { useEffect, useState } from 'react'
import { subscribeActivities, type TrajectoryTrend } from '../lib/activity'

export function TrajectoryCard() {
  const { t } = useTranslation('pages')
  const [trend, setTrend] = useState<TrajectoryTrend>(() => computeTrajectory())

  useEffect(() => {
    const unsub = subscribeActivities(() => setTrend(computeTrajectory()))
    return () => {
      unsub()
    }
  }, [])

  const isEmpty = trend.thisWeek === 0 && trend.lastWeek === 0 && trend.minutes30 === 0
  if (isEmpty) {
    return (
      <section
        id="trajectory"
        className="flex flex-col gap-3 scroll-mt-24 rounded-xl border border-border bg-surface-1 p-5"
      >
        <header className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-text-secondary" />
          <h2 className="font-display text-base font-bold leading-tight">
            {t('trajectory_card.header')}
          </h2>
        </header>
        <p className="text-[13px] italic text-text-muted">
          {t('trajectory_card.empty')}
        </p>
      </section>
    )
  }

  const isDeclining = trend.verdict === 'drop'
  const TrendIcon =
    trend.weekDelta > 2 ? TrendingUp : trend.weekDelta < -2 ? TrendingDown : Minus
  const verdictColor =
    trend.verdict === 'rising' || trend.verdict === 'habit'
      ? 'text-text-primary'
      : trend.verdict === 'drop'
        ? 'text-text-secondary'
        : 'text-text-muted'

  const verdictLabel =
    trend.verdict === 'rising' ? t('trajectory_card.verdict_rising')
    : trend.verdict === 'habit' ? t('trajectory_card.verdict_habit')
    : trend.verdict === 'drop' ? t('trajectory_card.verdict_drop')
    : trend.verdict === 'steady' ? t('trajectory_card.verdict_steady')
    : t('trajectory_card.verdict_silence')

  const values = trend.daily30.map((b) => b.count)
  const peak = Math.max(...values)
  const deltaSigned = `${trend.weekDelta >= 0 ? '+' : ''}${trend.weekDelta}`

  return (
    <section
      id="trajectory"
      className="relative flex flex-col gap-4 scroll-mt-24 rounded-xl border border-border bg-surface-1 p-5"
    >
      {isDeclining && (
        <span
          aria-hidden
          className="absolute left-0 top-3 h-[calc(100%-24px)] w-[1.5px] rounded-l-md"
          style={{ background: '#FF3B30' }}
        />
      )}

      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {t('trajectory_card.header')}
          </span>
          <h2 className="font-display text-base font-bold leading-tight">
            {t('trajectory_card.actions_count', { count: trend.thisWeek, label: pluralActions(trend.thisWeek, t) })}
          </h2>
        </div>
        <span
          className={`flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.08em] ${verdictColor}`}
          title={t('trajectory_card.tooltip_week', { delta: deltaSigned })}
        >
          <TrendIcon className="h-3.5 w-3.5" />
          {verdictLabel}
        </span>
      </header>

      {/* Sparkline + axis hint */}
      <div className="flex flex-col gap-1">
        <Sparkline
          values={values}
          height={32}
          stroke="rgba(255,255,255,0.85)"
          fill="rgba(255,255,255,0.10)"
          ariaLabel={`30-day activity trend · peak ${peak}`}
        />
        <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">
          <span>{t('trajectory_card.ago_30d')}</span>
          <span>{t('trajectory_card.today')}</span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3">
        <Stat
          label={t('trajectory_card.stat_days_active')}
          value={t('trajectory_card.stat_days_value', { n: trend.activeDays30 })}
          hint={trend.activeDays30 >= 21 ? t('trajectory_card.stat_habit') : trend.activeDays30 >= 10 ? t('trajectory_card.stat_building') : t('trajectory_card.stat_rare')}
        />
        <Stat
          label={t('trajectory_card.stat_week_vs')}
          value={deltaSigned}
          hint={`${trend.thisWeek} vs ${trend.lastWeek}`}
        />
        <Stat
          label={t('trajectory_card.stat_minutes')}
          value={trend.minutes7 > 0 ? String(trend.minutes7) : '—'}
          hint={trend.minutes7 > 0 ? t('trajectory_card.stat_minutes_hint', { h: Math.round(trend.minutes7 / 60) }) : t('trajectory_card.stat_minutes_none')}
          icon={<Clock className="h-3 w-3 text-text-muted" />}
        />
      </div>
    </section>
  )
}

function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: string
  value: string
  hint?: string
  icon?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-text-muted">
        {label}
      </span>
      <span className="flex items-center gap-1 font-display text-xl font-bold tabular-nums text-text-primary">
        {icon}
        {value}
      </span>
      {hint && (
        <span className="font-mono text-[10px] text-text-muted">{hint}</span>
      )}
    </div>
  )
}

function pluralActions(n: number, t: (k: string) => string): string {
  if (n === 1) return t('trajectory_card.plural.one')
  if (n >= 2 && n <= 4) return t('trajectory_card.plural.few')
  return t('trajectory_card.plural.many')
}
