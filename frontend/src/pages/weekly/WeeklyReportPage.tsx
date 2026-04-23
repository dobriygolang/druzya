// WeeklyReportPage — /weekly. Killer-stats Phase D dashboard.
//
// Все агрегаты (XP, секции, weekly compare, streak, hourly heatmap, ELO
// series, percentiles, AI insight, achievements) приходят с бэка через
// useWeeklyReportQuery → /api/v1/profile/me/report. Backend держит 5-min
// Redis-кеш + инвалидацию по событиям MatchCompleted/XPGained, см.
// profile/infra/report_cache.go.
//
// Anti-fallback policy: ни одного захардкоженного числа. Если поле пустое —
// рендерится honest empty-state ("Нет активности на этой неделе") или
// секция вовсе скрывается (ai_insight, elo_series). НЕТ STUB / TODO в JSX.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { useWeeklyReportQuery } from '../../lib/queries/weekly'
import { isoWeekKey } from './utils'
import { HeaderRow, TldrCards } from './HeaderRow'
import { HourlyHeatmap } from './HourlyHeatmap'
import { EloChart, SectionBars } from './Charts'
import { AchievementsGrid, AiInsight, PercentileRow } from './InsightsPanels'
import { GoalsChecklist } from './GoalsChecklist'

// ============================================================================
// Page shell
// ============================================================================

export default function WeeklyReportPage() {
  const { data, isLoading } = useWeeklyReportQuery()

  // weekISO для localStorage ключа целей. Если бэк ещё не отдал week_start,
  // используем текущую дату — пользователь не дождётся загрузки чтоб начать
  // писать цели.
  const weekISO = useMemo(() => {
    const base = data?.week_start ? new Date(data.week_start) : new Date()
    return isoWeekKey(Number.isNaN(base.getTime()) ? new Date() : base)
  }, [data?.week_start])

  return (
    <AppShellV2>
      {/* WAVE-13 — Weekly теперь sub-section /profile. Лёгкий breadcrumb
          вверху помогает понять контекст и даёт быстрый возврат к табам. */}
      <div className="flex h-[40px] items-center border-b border-border bg-bg px-4 sm:px-8 lg:px-20">
        <Link
          to="/profile"
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
        >
          <ChevronLeft className="h-4 w-4" /> Профиль
        </Link>
        <span className="ml-2 text-sm text-text-muted">/ Weekly</span>
      </div>
      <HeaderRow report={data} isLoading={isLoading} />
      <div className="flex flex-col gap-6 px-4 pb-10 pt-6 sm:px-8 lg:gap-7 lg:px-20">
        <TldrCards report={data} />
        <HourlyHeatmap data={data?.hourly_heatmap ?? []} />
        <EloChart series={data?.elo_series ?? []} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionBars data={data?.match_aggregates ?? []} />
          <PercentileRow
            percentiles={data?.percentiles ?? { in_tier: 0, in_friends: 0, in_global: 0 }}
          />
        </div>
        <AiInsight text={data?.ai_insight ?? ''} />
        <AchievementsGrid items={data?.achievements_this_week ?? []} />
        <GoalsChecklist weekISO={weekISO} />
      </div>
    </AppShellV2>
  )
}
