import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { WeeklyReport } from '../../lib/queries/weekly'
import { isoWeekKey } from './utils'

// ============================================================================
// Header
// ============================================================================

export function HeaderRow({ report, isLoading }: { report?: WeeklyReport; isLoading: boolean }) {
  const { t } = useTranslation('wave14')
  // Week N номер — считаем по week_start из бэка (а не "сейчас"), потому что
  // отчёт может быть за прошлую неделю в кеше после инвалидации.
  const weekN = useMemo(() => {
    if (!report?.week_start) return ''
    const d = new Date(report.week_start)
    if (Number.isNaN(d.getTime())) return ''
    return isoWeekKey(d).split('-W')[1]
  }, [report?.week_start])

  return (
    <div className="relative flex flex-col items-start gap-4 px-4 pt-6 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-20 lg:pt-8">
      <span
        aria-hidden
        className="absolute left-4 top-7 hidden h-10 w-[1.5px] sm:block sm:left-8 lg:left-20"
        style={{ background: 'var(--red)' }}
      />
      <div className="flex flex-col gap-1.5 sm:pl-4">
        <h1 className="font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary">
          {weekN ? `${t('weekly_extra.week')} ${weekN}` : isLoading ? t('weekly_extra.loading') : t('weekly_extra.week')}
        </h1>
        <p className="text-sm text-text-secondary">
          {report?.period ?? (isLoading ? '…' : '—')} · {report?.actions_count ?? 0} {t('weekly_extra.actions')}
        </p>
      </div>
    </div>
  )
}

// ============================================================================
// 1. TL;DR cards
// ============================================================================

export function TldrCards({ report }: { report?: WeeklyReport }) {
  const { t } = useTranslation('wave14')
  const best = report?.strong_sections?.[0]
  const weakest = report?.weak_sections?.[0]
  const streak = Number(report?.stats.streak.value.replace(/\D/g, '')) || 0
  const bestStreak = report?.stats.streak.best ?? 0
  const isStreakRecord = streak > 0 && streak >= bestStreak

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {/* Best section — strong rung on the ink ramp. */}
      <div className="flex flex-col gap-2 rounded-2xl border border-border-strong bg-surface-2 p-5">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-primary">
          {t('weekly_extra.best_section')}
        </span>
        {best ? (
          <>
            <span className="font-display text-xl font-extrabold text-text-primary">{best.name}</span>
            <span className="text-[12px] text-text-secondary">
              {best.sub} · <span className="text-text-primary">{best.xp}</span>
            </span>
          </>
        ) : (
          <span className="text-[12px] text-text-muted">{t('weekly_extra.play_more')}</span>
        )}
      </div>
      {/* Streak — muted rung on the ink ramp. */}
      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface-2 p-5">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-secondary">{t('weekly_extra.streak')}</span>
        <span className="font-display text-xl font-extrabold text-text-primary">
          {streak} {streak > 0 ? t('weekly_extra.days') : '—'}
        </span>
        <span className="text-[12px] text-text-secondary">
          {isStreakRecord && streak > 0
            ? t('weekly_extra.personal_record')
            : `${t('weekly_extra.best_record')} ${bestStreak} ${t('weekly_extra.days_short')}`}
        </span>
      </div>
      {/* Focus next — red signal stripe (active selection / weak spot). */}
      <div className="relative flex flex-col gap-2 overflow-hidden rounded-2xl border border-border bg-surface-2 p-5">
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-[1.5px]"
          style={{ background: 'var(--red)' }}
        />
        <span
          className="font-mono text-[11px] font-semibold tracking-[0.08em]"
          style={{ color: 'var(--red)' }}
        >
          {t('weekly_extra.focus_next')}
        </span>
        {weakest ? (
          <>
            <span className="font-display text-xl font-extrabold text-text-primary">{weakest.name}</span>
            <span className="text-[12px] text-text-secondary">
              {weakest.sub} ·{' '}
              <span style={{ color: 'var(--red)' }}>{weakest.xp}</span>
            </span>
          </>
        ) : (
          <span className="text-[12px] text-text-muted">{t('weekly_extra.no_weak_sections')}</span>
        )}
      </div>
    </div>
  )
}
