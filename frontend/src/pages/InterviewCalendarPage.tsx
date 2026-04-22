// TODO i18n
import { Calendar, Check, RefreshCw, TrendingUp, AlertTriangle, Sparkles } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { useInterviewCalendarQuery } from '../lib/queries/calendar'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}


const STRENGTHS = [
  { label: 'Алгоритмы — Easy/Medium', value: 92 },
  { label: 'Go · конкурентность', value: 84 },
  { label: 'SQL · оконные функции', value: 78 },
]
const WEAKNESSES = [
  { label: 'Dynamic Programming', value: 38 },
  { label: 'System Design — большие масштабы', value: 44 },
  { label: 'Behavioral на английском', value: 52 },
  { label: 'Tree DP / Segment Tree', value: 31 },
]

function DayCell({ d, state }: { d: number; state: 'done' | 'active' | 'future' | 'final' }) {
  const cls =
    state === 'done' ? 'border-success/40 bg-success/10 text-success' :
    state === 'active' ? 'border-accent bg-accent/15 text-text-primary shadow-glow' :
    state === 'final' ? 'border-danger/60 bg-danger/15 text-danger shadow-[0_0_20px_rgba(239,68,68,0.4)]' :
    'border-border bg-surface-1 text-text-muted'
  return (
    <div className={`flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg border ${cls}`}>
      <span className="font-display text-sm font-bold">{state === 'final' ? 'СОБЕС' : d}</span>
      {state === 'active' && <span className="font-mono text-[9px] text-accent-hover">сейчас</span>}
      {state === 'done' && <Check className="h-3 w-3" />}
    </div>
  )
}

export default function InterviewCalendarPage() {
  const { data, isError } = useInterviewCalendarQuery()
  const company = data?.company ?? 'YANDEX'
  const daysLeft = data?.days_left ?? 17
  const role = data?.role ?? 'Senior Backend'
  const sections = data?.sections ?? 'Алгоритмы + System Design + Behavioral'
  const readiness = data?.readiness_pct ?? 62
  const countdown = data?.countdown ?? '17д 04ч 12м'
  const todayTasks = data?.today_tasks ?? [
    { id: 't1', title: 'Two Pointers · Easy', sub: '15 мин · 2 задачи', status: 'done' as const },
    { id: 't2', title: 'Mock System Design · кэш-инвалидация', sub: '40 мин · с AI-интервьюером', status: 'active' as const },
    { id: 't3', title: 'Behavioral · STAR-история про конфликт', sub: '20 мин · запись + разбор', status: 'future' as const },
  ]
  const strengths = data?.strengths ?? STRENGTHS
  const weaknesses = data?.weaknesses ?? WEAKNESSES
  const aiRec = data?.ai_recommendation ?? 'Завтра — 60 минут на DP: Knapsack + LIS. После — 1 mock с AI-интервьюером (System Design: дизайн ленты Twitter). Это закроет 2 главных пробела перед собесом.'
  return (
    <AppShellV2>
      <div className="relative h-auto overflow-hidden bg-gradient-to-br from-surface-3 to-accent lg:h-[220px]">
        <div className="flex h-full flex-col items-start justify-between gap-4 px-4 py-6 sm:px-8 lg:flex-row lg:items-center lg:gap-0 lg:px-20 lg:py-8">
          <div className="flex flex-col gap-3">
            <span className="inline-flex w-fit items-center gap-2 rounded-md bg-warn/20 px-3 py-1 font-mono text-[11px] font-bold tracking-[0.08em] text-warn">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warn" />
              АКТИВНАЯ ПОДГОТОВКА · {company.toUpperCase()}
            </span>
            <h1 className="font-display text-2xl sm:text-3xl lg:text-[36px] font-extrabold text-text-primary">Собеседование через {daysLeft} дней</h1>
            <p className="text-sm text-white/80">{role} · {sections}</p>
            {isError && <ErrorChip />}
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/80">Готовность</span>
              <div className="h-2 w-[160px] sm:w-[240px] overflow-hidden rounded-full bg-black/40">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan to-accent" style={{ width: `${readiness}%` }} />
              </div>
              <span className="font-mono text-sm font-bold text-cyan">{readiness}%</span>
            </div>
          </div>
          <div className="flex flex-col gap-3 rounded-xl bg-bg/40 p-5 backdrop-blur">
            <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-white/70">ОСТАЛОСЬ</span>
            <span className="font-display text-3xl font-extrabold text-text-primary">{countdown}</span>
            <Button variant="ghost" size="sm" className="border-white/30 text-text-primary hover:bg-white/10" icon={<Calendar className="h-3.5 w-3.5" />}>
              Изменить дату
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-4 py-8 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:py-10">
        <div className="flex flex-1 flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-lg font-bold text-text-primary">План на сегодня</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {todayTasks.map((t) => (
                <Card key={t.id} className={`flex-col gap-2 p-5 ${t.status === 'active' ? 'border-accent shadow-glow' : ''} ${t.status === 'future' ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between">
                    {t.status === 'done' && <span className="grid h-6 w-6 place-items-center rounded-full bg-success text-bg"><Check className="h-3.5 w-3.5" /></span>}
                    {t.status === 'active' && <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-bold text-accent-hover">СЕЙЧАС</span>}
                    {t.status === 'future' && <span className="font-mono text-[10px] text-text-muted">ПОЗЖЕ</span>}
                  </div>
                  <span className="font-display text-sm font-bold text-text-primary">{t.title}</span>
                  <span className="text-xs text-text-muted">{t.sub}</span>
                </Card>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="font-display text-lg font-bold text-text-primary">21-дневный план</h2>
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((row) => (
                <div key={row} className="grid grid-cols-7 gap-2">
                  {Array.from({ length: 7 }).map((_, col) => {
                    const d = row * 7 + col + 1
                    let state: 'done' | 'active' | 'future' | 'final' = 'future'
                    if (d <= 3) state = 'done'
                    else if (d === 4) state = 'active'
                    else if (d === 21) state = 'final'
                    return <DayCell key={d} d={d} state={state} />
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex w-full flex-col gap-4 lg:w-[360px]">
          <Card className="flex-col gap-3 border-success/40 p-5">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-success" />
              <h3 className="font-display text-sm font-bold text-text-primary">Сильные стороны</h3>
            </div>
            {strengths.map((s) => (
              <div key={s.label} className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary">{s.label}</span>
                  <span className="font-mono text-xs font-bold text-success">{s.value}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-success" style={{ width: `${s.value}%` }} />
                </div>
              </div>
            ))}
          </Card>

          <Card className="flex-col gap-3 border-danger/40 p-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-danger" />
              <h3 className="font-display text-sm font-bold text-text-primary">Слабые места</h3>
            </div>
            {weaknesses.map((s) => (
              <div key={s.label} className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary">{s.label}</span>
                  <span className="font-mono text-xs font-bold text-danger">{s.value}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-danger" style={{ width: `${s.value}%` }} />
                </div>
              </div>
            ))}
          </Card>

          <Card className="flex-col gap-3 p-5 bg-gradient-to-br from-accent to-pink border-accent/40 shadow-glow">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-text-primary" />
                <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-primary">AI РЕКОМЕНДАЦИЯ</span>
              </div>
              <button className="grid h-7 w-7 place-items-center rounded-md bg-white/20 text-text-primary hover:bg-white/30">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="text-xs leading-relaxed text-white/90">
              {aiRec}
            </p>
            <Button variant="ghost" size="sm" className="border-white/30 text-text-primary hover:bg-white/10">
              Добавить в план
            </Button>
          </Card>
        </div>
      </div>
    </AppShellV2>
  )
}
