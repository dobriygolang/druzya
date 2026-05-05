import { useMemo } from 'react'
import type { WeeklyReport } from '../../lib/queries/weekly'
import { isoWeekKey } from './utils'

// ============================================================================
// Header
// ============================================================================

export function HeaderRow({ report, isLoading }: { report?: WeeklyReport; isLoading: boolean }) {
  // Week N номер — считаем по week_start из бэка (а не "сейчас"), потому что
  // отчёт может быть за прошлую неделю в кеше после инвалидации.
  const weekN = useMemo(() => {
    if (!report?.week_start) return ''
    const d = new Date(report.week_start)
    if (Number.isNaN(d.getTime())) return ''
    return isoWeekKey(d).split('-W')[1]
  }, [report?.week_start])

  return (
    <div className="flex flex-col items-start gap-4 px-4 pt-6 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-20 lg:pt-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary">
          {weekN ? `Неделя ${weekN}` : isLoading ? 'Загрузка…' : 'Неделя'}
        </h1>
        <p className="text-sm text-text-secondary">
          {report?.period ?? (isLoading ? '…' : '—')} · {report?.actions_count ?? 0} действий
        </p>
      </div>
    </div>
  )
}

// ============================================================================
// 1. TL;DR cards
// ============================================================================

export function TldrCards({ report }: { report?: WeeklyReport }) {
  const best = report?.strong_sections?.[0]
  const weakest = report?.weak_sections?.[0]
  const streak = Number(report?.stats.streak.value.replace(/\D/g, '')) || 0
  const bestStreak = report?.stats.streak.best ?? 0
  const isStreakRecord = streak > 0 && streak >= bestStreak

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-5 ring-1 ring-success/30">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-success">
          ЛУЧШАЯ СЕКЦИЯ
        </span>
        {best ? (
          <>
            <span className="font-display text-xl font-extrabold text-text-primary">{best.name}</span>
            <span className="text-[12px] text-text-secondary">
              {best.sub} · <span className="text-success">{best.xp}</span>
            </span>
          </>
        ) : (
          <span className="text-[12px] text-text-muted">Сыграй несколько матчей.</span>
        )}
      </div>
      <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-5 ring-1 ring-warn/30">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-warn">СТРИК</span>
        <span className="font-display text-xl font-extrabold text-text-primary">
          {streak} {streak > 0 ? 'дней' : '—'}
        </span>
        <span className="text-[12px] text-text-secondary">
          {isStreakRecord && streak > 0
            ? 'Личный рекорд!'
            : `лучший: ${bestStreak} дн`}
        </span>
      </div>
      <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-5 ring-1 ring-danger/30">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-danger">
          ФОКУС НА СЛЕДУЮЩУЮ
        </span>
        {weakest ? (
          <>
            <span className="font-display text-xl font-extrabold text-text-primary">{weakest.name}</span>
            <span className="text-[12px] text-text-secondary">
              {weakest.sub} · <span className="text-danger">{weakest.xp}</span>
            </span>
          </>
        ) : (
          <span className="text-[12px] text-text-muted">Слабых секций нет — отличная неделя.</span>
        )}
      </div>
    </div>
  )
}
