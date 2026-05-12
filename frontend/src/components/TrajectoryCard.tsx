// TrajectoryCard — R3 (progress twin v0 — frontend MVP) — 2026-05-12.
//
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

import { Sparkline } from './Sparkline'
import { computeTrajectory } from '../lib/activity'
import { useEffect, useState } from 'react'
import { subscribeActivities, type TrajectoryTrend } from '../lib/activity'

export function TrajectoryCard() {
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
            Траектория · 30 дн
          </h2>
        </header>
        <p className="text-[13px] italic text-text-muted">
          Журнал пуст. Каждое залогированное занятие появится здесь как точка
          трактории. После 7-14 дней увидишь week-vs-week trend.
        </p>
      </section>
    )
  }

  const isDeclining = trend.verdict === 'просел'
  const TrendIcon =
    trend.weekDelta > 2 ? TrendingUp : trend.weekDelta < -2 ? TrendingDown : Minus
  const verdictColor =
    trend.verdict === 'на подъёме' || trend.verdict === 'строит привычку'
      ? 'text-text-primary'
      : trend.verdict === 'просел'
        ? 'text-text-secondary'
        : 'text-text-muted'

  const values = trend.daily30.map((b) => b.count)
  const peak = Math.max(...values)

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
            Траектория · 30 дн
          </span>
          <h2 className="font-display text-base font-bold leading-tight">
            {trend.thisWeek} {pluralActions(trend.thisWeek)} за 7 дней
          </h2>
        </div>
        <span
          className={`flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.08em] ${verdictColor}`}
          title={`vs прошлая неделя: ${trend.weekDelta >= 0 ? '+' : ''}${trend.weekDelta}`}
        >
          <TrendIcon className="h-3.5 w-3.5" />
          {trend.verdict}
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
          <span>30 дн назад</span>
          <span>сегодня</span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="дней с активностью"
          value={`${trend.activeDays30} / 30`}
          hint={trend.activeDays30 >= 21 ? 'привычка' : trend.activeDays30 >= 10 ? 'строится' : 'редко'}
        />
        <Stat
          label="неделя vs прошлая"
          value={`${trend.weekDelta >= 0 ? '+' : ''}${trend.weekDelta}`}
          hint={`${trend.thisWeek} vs ${trend.lastWeek}`}
        />
        <Stat
          label="минут · 7 дн"
          value={trend.minutes7 > 0 ? String(trend.minutes7) : '—'}
          hint={trend.minutes7 > 0 ? `~${Math.round(trend.minutes7 / 60)}ч` : 'не фикс.'}
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

function pluralActions(n: number): string {
  if (n === 1) return 'занятие'
  if (n >= 2 && n <= 4) return 'занятия'
  return 'занятий'
}
