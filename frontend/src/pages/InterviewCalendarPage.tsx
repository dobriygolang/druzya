// /calendar — план подготовки к собеседованию.
//
// Источник правды — `daily.GetCalendar` (REST: GET /api/v1/daily/calendar)
// через `useInterviewCalendarQuery` в queries/calendar.ts. Все «виджетные»
// поля, которые backend не отдаёт (sections-метка, strengths/weaknesses-
// прогрессбары, AI-рекомендация), здесь УБРАНЫ — раньше они показывались
// захардкоженными цифрами и вводили пользователя в заблуждение. Когда домен
// расширится, добавим их обратно как реальные данные.
//
// Стратегия empty-states:
//   - 404 от бэка → пользователю показывается «Создай план подготовки»
//     с CTA на /daily.
//   - есть план, но пуст today_tasks → блок свернут.
//   - week_plan пуст → grid не рисуется.
import { useState } from 'react'
import { Calendar, Check, AlertTriangle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import {
  useInterviewCalendarQuery,
  useUpsertCalendarMutation,
  priorityLabelRU,
  type InterviewCalendarView,
} from '../lib/queries/calendar'
import { useCompaniesQuery } from '../lib/queries/companies'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

function HeaderSkeleton() {
  return (
    <div className="relative h-auto overflow-hidden bg-gradient-to-br from-surface-3 to-accent lg:h-[220px]">
      <div className="flex h-full flex-col items-start justify-between gap-4 px-4 py-6 sm:px-8 lg:flex-row lg:items-center lg:gap-0 lg:px-20 lg:py-8">
        <div className="flex w-full max-w-lg flex-col gap-3">
          <div className="h-3 w-40 animate-pulse rounded bg-white/20" />
          <div className="h-8 w-72 animate-pulse rounded bg-white/20" />
          <div className="h-3 w-56 animate-pulse rounded bg-white/15" />
        </div>
      </div>
    </div>
  )
}

function EmptyCalendar() {
  return (
    <AppShellV2>
      <div className="flex w-full items-center justify-center px-4 py-12 sm:px-8 lg:px-20">
        <div className="flex w-full max-w-[640px] flex-col items-center gap-5 rounded-2xl border border-border bg-surface-1 p-8 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-accent/30 to-pink/30">
            <Calendar className="h-6 w-6 text-accent-hover" />
          </div>
          <h2 className="font-display text-2xl font-bold text-text-primary">
            План подготовки ещё не создан
          </h2>
          <p className="max-w-[480px] text-sm text-text-secondary">
            Укажи дату собеседования и компанию — мы соберём ежедневные задачи
            и оценим готовность по разделам.
          </p>
          <Link
            to="/arena/kata"
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-text-primary shadow-glow hover:bg-accent/90"
          >
            Создать план
          </Link>
        </div>
      </div>
    </AppShellV2>
  )
}

function DayCell({ d, state }: { d: number; state: 'done' | 'active' | 'future' | 'final' }) {
  const cls =
    state === 'done' ? 'border-success/40 bg-success/10 text-success' :
    state === 'active' ? 'border-accent bg-accent/15 text-text-primary shadow-glow' :
    state === 'final' ? 'border-danger/60 bg-danger/15 text-danger shadow-[0_0_20px_rgba(239,68,68,0.4)]' :
    'border-border bg-surface-1 text-text-muted'
  return (
    <div className={`flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg border ${cls}`}>
      <span className="font-display text-sm font-bold">{state === 'final' ? 'СОБЕС' : d}</span>
      {state === 'active' && <span className="font-mono text-[9px] text-accent-hover">сегодня</span>}
      {state === 'done' && <Check className="h-3 w-3" />}
    </div>
  )
}

// renderWeekGrid строит 21-дневную сетку, ставя «active» на сегодняшний
// день (по индексу относительно days_left) и «final» — на последний.
// Всё, что раньше = done; всё после, кроме final = future.
function renderWeekGrid(daysLeft: number) {
  const totalDays = 21
  // Если до собеса больше 21 дня — рисуем 3 будущих недели; если меньше —
  // первые (totalDays - daysLeft) считаем «done», текущий — «active»,
  // последний — «final» (день X).
  const todayIdx = Math.max(0, Math.min(totalDays - 1, totalDays - daysLeft))
  const finalIdx = Math.max(todayIdx, Math.min(totalDays - 1, todayIdx + Math.min(daysLeft, totalDays - 1)))
  return [0, 1, 2].map((row) => (
    <div key={row} className="grid grid-cols-7 gap-2">
      {Array.from({ length: 7 }).map((_, col) => {
        const d = row * 7 + col
        let state: 'done' | 'active' | 'future' | 'final' = 'future'
        if (d < todayIdx) state = 'done'
        else if (d === todayIdx) state = 'active'
        else if (d === finalIdx) state = 'final'
        return <DayCell key={d} d={d + 1} state={state} />
      })}
    </div>
  ))
}

// EditDateModal — редактирует interview_date / company / role текущего
// календаря. Список компаний приходит из GET /api/v1/companies
// (см. lib/queries/companies.ts), default-selection = current.company_id.
// UpsertCalendar требует валидный UUID компании, поэтому save заблокирован
// пока companies загружаются или selection пуст.
function EditDateModal({
  current,
  onClose,
}: {
  current: InterviewCalendarView
  onClose: () => void
}) {
  const upsert = useUpsertCalendarMutation()
  const companies = useCompaniesQuery()
  const [date, setDate] = useState(current.interview_date.slice(0, 10))
  const [role, setRole] = useState(current.role ?? '')
  const [companyId, setCompanyId] = useState(current.company_id)
  const [err, setErr] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (!date) {
      setErr('Укажи дату собеседования')
      return
    }
    if (!companyId) {
      setErr('Выбери компанию')
      return
    }
    try {
      await upsert.mutateAsync({
        company_id: companyId,
        role: role.trim() || undefined,
        interview_date: date,
      })
      onClose()
    } catch (e) {
      setErr((e as Error).message ?? 'Не удалось сохранить')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-xl border border-border bg-surface-1 p-6 shadow-xl"
      >
        <h3 className="font-display text-lg font-bold text-text-primary">
          Изменить параметры собеседования
        </h3>
        <p className="mt-1 text-[12px] text-text-muted">
          План подготовки пересчитается под новые данные.
        </p>
        <label className="mt-4 flex flex-col gap-1 text-sm">
          <span className="font-mono text-[11px] uppercase text-text-secondary">Компания</span>
          <select
            required
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            disabled={companies.isLoading || companies.isError}
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-text-primary focus:border-accent focus:outline-none disabled:opacity-60"
          >
            {companies.isLoading && <option value={current.company_id}>Загрузка…</option>}
            {!companies.isLoading && (companies.data ?? []).length === 0 && (
              <option value={current.company_id}>Список пуст</option>
            )}
            {(companies.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {companies.isError && (
            <span className="font-mono text-[10px] text-danger">
              Не удалось загрузить компании.
            </span>
          )}
        </label>
        <label className="mt-3 flex flex-col gap-1 text-sm">
          <span className="font-mono text-[11px] uppercase text-text-secondary">Дата</span>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-text-primary focus:border-accent focus:outline-none"
          />
        </label>
        <label className="mt-3 flex flex-col gap-1 text-sm">
          <span className="font-mono text-[11px] uppercase text-text-secondary">Роль</span>
          <input
            type="text"
            value={role}
            placeholder="Backend Engineer"
            onChange={(e) => setRole(e.target.value)}
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-text-primary focus:border-accent focus:outline-none"
          />
        </label>
        {err && (
          <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {err}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} type="button">
            Отмена
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={upsert.isPending || companies.isLoading || !companyId}
          >
            {upsert.isPending ? 'Сохраняю…' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </div>
  )
}

export default function InterviewCalendarPage() {
  const { data, isError, isLoading, error } = useInterviewCalendarQuery()
  const status = (error as { status?: number } | null)?.status
  const [editOpen, setEditOpen] = useState(false)

  if (isLoading) {
    return (
      <AppShellV2>
        <HeaderSkeleton />
        <div className="flex flex-col gap-4 px-4 py-8 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:py-10">
          <div className="flex flex-1 flex-col gap-4">
            <div className="h-32 animate-pulse rounded-xl border border-border bg-surface-1" />
            <div className="h-48 animate-pulse rounded-xl border border-border bg-surface-1" />
          </div>
        </div>
      </AppShellV2>
    )
  }

  if (status === 404 || (!data && !isError)) {
    return <EmptyCalendar />
  }

  if (!data) {
    return (
      <AppShellV2>
        <div className="px-4 py-12 sm:px-8 lg:px-20">
          <ErrorChip />
        </div>
      </AppShellV2>
    )
  }

  const { role, days_left, readiness_pct, countdown, today_tasks, weak_zones } = data
  const hasCountdown = countdown.length > 0
  const heading = days_left > 0 ? `Собеседование через ${days_left} дней` : 'Собеседование сегодня'

  return (
    <AppShellV2>
      <div className="relative h-auto overflow-hidden bg-gradient-to-br from-surface-3 to-accent lg:h-[220px]">
        <div className="flex h-full flex-col items-start justify-between gap-4 px-4 py-6 sm:px-8 lg:flex-row lg:items-center lg:gap-0 lg:px-20 lg:py-8">
          <div className="flex flex-col gap-3">
            <span className="inline-flex w-fit items-center gap-2 rounded-md bg-warn/20 px-3 py-1 font-mono text-[11px] font-bold tracking-[0.08em] text-warn">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warn" />
              АКТИВНАЯ ПОДГОТОВКА
            </span>
            <h1 className="font-display text-2xl sm:text-3xl lg:text-[36px] font-extrabold text-text-primary">
              {heading}
            </h1>
            <p className="text-sm text-white/80">{role}</p>
            {isError && <ErrorChip />}
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/80">Готовность</span>
              <div className="h-2 w-[160px] sm:w-[240px] overflow-hidden rounded-full bg-black/40">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan to-accent"
                  style={{ width: `${Math.max(0, Math.min(100, readiness_pct))}%` }}
                />
              </div>
              <span className="font-mono text-sm font-bold text-cyan">{readiness_pct}%</span>
            </div>
          </div>
          {hasCountdown && (
            <div className="flex flex-col gap-3 rounded-xl bg-bg/40 p-5 backdrop-blur">
              <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-white/70">
                ОСТАЛОСЬ
              </span>
              <span className="font-display text-3xl font-extrabold text-text-primary">{countdown}</span>
              <Button
                variant="ghost"
                size="sm"
                className="border-white/30 text-text-primary hover:bg-white/10"
                icon={<Calendar className="h-3.5 w-3.5" />}
                onClick={() => setEditOpen(true)}
              >
                Изменить
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 px-4 py-8 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:py-10">
        <div className="flex flex-1 flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-lg font-bold text-text-primary">План на сегодня</h2>
            {today_tasks.length === 0 ? (
              <Card className="flex-col gap-2 p-5 text-sm text-text-muted">
                На сегодня задач нет — отдыхай или возьми kata из{' '}
                <Link to="/arena/kata" className="text-accent-hover hover:underline">
                  /arena/kata
                </Link>
                .
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {today_tasks.map((t) => (
                  <Card
                    key={t.id}
                    className={`flex-col gap-2 p-5 ${t.status === 'active' ? 'border-accent shadow-glow' : ''} ${t.status === 'future' ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      {t.status === 'done' && (
                        <span className="grid h-6 w-6 place-items-center rounded-full bg-success text-bg">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      )}
                      {t.status === 'active' && (
                        <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-bold text-accent-hover">
                          СЕЙЧАС
                        </span>
                      )}
                      {t.status === 'future' && (
                        <span className="font-mono text-[10px] text-text-muted">ПОЗЖЕ</span>
                      )}
                    </div>
                    <span className="font-display text-sm font-bold text-text-primary">{t.title}</span>
                    <span className="text-xs text-text-muted">{t.sub}</span>
                  </Card>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="font-display text-lg font-bold text-text-primary">21-дневный план</h2>
            <div className="flex flex-col gap-2">{renderWeekGrid(days_left)}</div>
          </div>
        </div>

        <div className="flex w-full flex-col gap-4 lg:w-[360px]">
          {weak_zones.length > 0 && (
            <Card className="flex-col gap-3 border-danger/40 p-5">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-danger" />
                <h3 className="font-display text-sm font-bold text-text-primary">Слабые зоны</h3>
              </div>
              {weak_zones.map((wz) => (
                <div
                  key={wz.atlas_node_key}
                  className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2"
                >
                  <span className="text-xs text-text-secondary">{wz.atlas_node_key}</span>
                  <span className="font-mono text-[10px] font-bold uppercase text-danger">
                    {priorityLabelRU(wz.priority)}
                  </span>
                </div>
              ))}
              <Link
                to="/atlas"
                className="mt-1 inline-flex items-center justify-center rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text-secondary hover:border-border-strong hover:text-text-primary"
              >
                Открыть атлас
              </Link>
            </Card>
          )}

          <Card className="flex-col gap-2 p-5">
            <h3 className="font-display text-sm font-bold text-text-primary">Недельный план</h3>
            {data.week_plan.length === 0 ? (
              <span className="text-xs text-text-muted">План на неделю пока пуст.</span>
            ) : (
              data.week_plan.slice(0, 7).map((entry) => (
                <div key={entry.date} className="flex items-center justify-between border-b border-border/60 py-1.5 last:border-b-0">
                  <span className="font-mono text-[11px] text-text-muted">{entry.date}</span>
                  <span className="font-mono text-[11px] text-text-secondary">{entry.tasks.length} задач</span>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>
      {editOpen && <EditDateModal current={data} onClose={() => setEditOpen(false)} />}
    </AppShellV2>
  )
}
