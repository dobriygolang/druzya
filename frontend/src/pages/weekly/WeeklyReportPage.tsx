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
import { useWeeklyReportQuery } from '../../lib/queries/weekly'
import { isoWeekKey } from './utils'
import { HeaderRow, TldrCards } from './HeaderRow'
import { AiInsight } from './InsightsPanels'
import { GoalsChecklist } from './GoalsChecklist'

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
        <AiInsight text={data?.ai_insight ?? ''} />
        <GoalsChecklist weekISO={weekISO} />
      </div>
    </AppShellV2>
  )
}
