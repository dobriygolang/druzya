// WeeklyReportPage — /weekly. Текущая live shape:
//   - HeaderRow / TldrCards (XP, matches, streak)
//   - AiInsight (LLM-narrative, скрывается если empty)
//   - GoalsChecklist (локально стораджит цели на неделю)
//
// Anti-fallback policy: если бэк отдаёт "" — секция вовсе скрывается.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { DataLoader } from '../../components/DataLoader'
import { useWeeklyReportQuery, type WeeklyReport } from '../../lib/queries/weekly'
import { isoWeekKey } from './utils'
import { HeaderRow, TldrCards } from './HeaderRow'
import { AiInsight } from './InsightsPanels'
import { GoalsChecklist } from './GoalsChecklist'

function WeeklySkeleton() {
  return (
    <div className="flex flex-col gap-6 px-4 pb-10 pt-6 sm:px-8 lg:gap-7 lg:px-20">
      <div className="h-12 w-1/3 animate-pulse rounded bg-surface-2" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-surface-2" />
        ))}
      </div>
      <div className="h-32 animate-pulse rounded-xl bg-surface-2" />
      <div className="h-48 animate-pulse rounded-xl bg-surface-2" />
    </div>
  )
}

export default function WeeklyReportPage() {
  const weeklyQ = useWeeklyReportQuery()
  const { data, isLoading } = weeklyQ

  // weekISO для localStorage ключа целей. Если бэк ещё не отдал week_start,
  // используем текущую дату — пользователь не дождётся загрузки чтоб начать
  // писать цели.
  const weekISO = useMemo(() => {
    const base = data?.week_start ? new Date(data.week_start) : new Date()
    return isoWeekKey(Number.isNaN(base.getTime()) ? new Date() : base)
  }, [data?.week_start])

  return (
    <AppShellV2>
      <div className="flex h-[40px] items-center border-b border-border bg-bg px-4 sm:px-8 lg:px-20">
        <Link
          to="/profile"
          className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
        >
          <ChevronLeft className="h-4 w-4" /> Профиль
        </Link>
        <span className="ml-2 text-sm text-text-muted">/ Weekly</span>
      </div>
      <ErrorBoundary section="Weekly report">
        <DataLoader<WeeklyReport>
          state={weeklyQ}
          section="Weekly report"
          skeleton={
            <>
              <HeaderRow report={undefined} isLoading={isLoading} />
              <WeeklySkeleton />
            </>
          }
          // Empty state — отчёт без действий всё-равно рендерим (показываем
          // GoalsChecklist даже если week_start пуст). Поэтому пропускаем
          // empty-check.
          empty={() => false}
        >
          {(report) => (
            <>
              <HeaderRow report={report} isLoading={false} />
              <div className="flex flex-col gap-6 px-4 pb-10 pt-6 sm:px-8 lg:gap-7 lg:px-20">
                <ErrorBoundary section="TL;DR">
                  <TldrCards report={report} />
                </ErrorBoundary>
                <ErrorBoundary section="AI insight">
                  <AiInsight text={report?.ai_insight ?? ''} />
                </ErrorBoundary>
                <ErrorBoundary section="Goals checklist">
                  <GoalsChecklist weekISO={weekISO} />
                </ErrorBoundary>
              </div>
            </>
          )}
        </DataLoader>
      </ErrorBoundary>
    </AppShellV2>
  )
}
