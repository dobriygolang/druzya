// TODO i18n
import { AlertTriangle, TrendingDown, Info, ThumbsUp } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Card } from '../components/Card'

function PageHeader() {
  return (
    <div className="flex flex-col items-start gap-4 px-4 pb-4 pt-6 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-20 lg:pb-6 lg:pt-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl lg:text-[28px] font-extrabold text-text-primary">
          Стресс-метрика
        </h1>
        <p className="text-sm text-text-secondary">
          Микро-сигналы стресса по сессиям: паузы, откаты, копи-пасты, хаотичные движения.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button className="rounded-md border border-border bg-surface-1 px-3 py-1.5 font-mono text-xs text-text-secondary">
          30 дней ▾
        </button>
        <span className="rounded-full bg-success/15 px-3 py-1 font-mono text-xs font-semibold text-success">
          Среднее: 34/100 (норма)
        </span>
      </div>
    </div>
  )
}

const heroMetrics = [
  { k: 'ПАУЗЫ', v: '12', sub: 'на сессию', chip: 'warn', bar: 60, color: 'bg-warn' },
  { k: 'ОТКАТЫ', v: '8', sub: 'undo за час', chip: 'cyan', bar: 40, color: 'bg-cyan' },
  { k: 'ХАОС', v: '3.2', sub: 'переключений', chip: 'success', bar: 25, color: 'bg-success' },
  { k: 'PASTE', v: '0', sub: 'честный код', chip: 'success', bar: 10, color: 'bg-success' },
] as const

function HeroMetrics() {
  const chipColor: Record<string, string> = {
    warn: 'bg-warn/15 text-warn',
    cyan: 'bg-cyan/15 text-cyan',
    success: 'bg-success/15 text-success',
  }
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {heroMetrics.map((m) => (
        <Card key={m.k} className="h-[140px] flex-1 flex-col justify-between p-5" interactive={false}>
          <div className="flex items-start justify-between">
            <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
              {m.k}
            </span>
            <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${chipColor[m.chip]}`}>
              {m.chip}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-extrabold text-text-primary">{m.v}</span>
            <span className="text-xs text-text-muted">{m.sub}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-surface-2">
            <div className={`h-full ${m.color}`} style={{ width: `${m.bar}%` }} />
          </div>
        </Card>
      ))}
    </div>
  )
}

function StressChart() {
  const bars = Array.from({ length: 22 }).map((_, i) => {
    if (i === 16) return { h: 88, color: 'bg-danger', peak: true }
    if (i === 15 || i === 17) return { h: 60, color: 'bg-warn' }
    if (i % 3 === 0) return { h: 32, color: 'bg-cyan' }
    return { h: 18 + ((i * 7) % 18), color: 'bg-success' }
  })
  return (
    <Card className="flex-col gap-4 bg-surface-2 p-6" interactive={false}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-text-primary">
          Стресс по минутам · последний мок
        </h3>
        <div className="flex gap-1">
          <span className="rounded-md bg-danger/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-danger">
            Стресс
          </span>
          <span className="rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-text-muted">
            Скорость
          </span>
          <span className="rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-text-muted">
            Точность
          </span>
        </div>
      </div>
      <div className="flex">
        <div className="flex h-60 flex-col justify-between pr-3 font-mono text-[10px] text-text-muted">
          <span>100</span>
          <span>75</span>
          <span>50</span>
          <span>25</span>
          <span>0</span>
        </div>
        <div className="relative flex h-60 flex-1 items-end gap-1.5 rounded-lg bg-surface-1 p-3">
          <span
            className="absolute left-3 right-3 border-t border-dashed border-warn/60"
            style={{ top: '2%' }}
          />
          {bars.map((b, i) => (
            <div key={i} className="relative flex flex-1 flex-col justify-end">
              <div
                className={`w-full rounded-t ${b.color}`}
                style={{ height: `${b.h}%` }}
              />
              {b.peak && (
                <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-danger px-1.5 py-0.5 font-mono text-[9px] font-semibold text-text-primary">
                  ПИК · 88/100
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-between pl-8 font-mono text-[10px] text-text-muted">
        <span>0:00</span>
        <span>15:00</span>
        <span>30:00</span>
        <span>45:00</span>
      </div>
    </Card>
  )
}

function PatternsCard() {
  const rows = [
    { i: <AlertTriangle className="h-4 w-4 text-danger" />, t: 'Стресс растёт когда таймер < 5 мин' },
    { i: <TrendingDown className="h-4 w-4 text-success" />, t: 'Стресс падает после первого зелёного теста' },
    { i: <Info className="h-4 w-4 text-cyan" />, t: 'На System Design — стабильно тревожнее на 22%' },
    { i: <ThumbsUp className="h-4 w-4 text-warn" />, t: 'Recovery time < нормы' },
  ]
  return (
    <div className="flex-1 rounded-xl border border-accent-hover bg-gradient-to-br from-accent/15 to-pink/15 p-5">
      <h3 className="font-display text-base font-bold text-text-primary">Паттерны</h3>
      <div className="mt-4 flex flex-col gap-3">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg bg-surface-1/50 p-3">
            {r.i}
            <span className="text-xs text-text-secondary">{r.t}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ComparisonCard() {
  const rows = [
    ['Этот месяц', '34/100', 'text-success'],
    ['Прошлый месяц', '42/100', 'text-warn'],
    ['Дельта', '-19%', 'text-success'],
    ['Лучшая сессия', '12/100', 'text-cyan'],
  ]
  return (
    <Card className="flex-1 flex-col gap-3 p-5" interactive={false}>
      <h3 className="font-display text-base font-bold text-text-primary">Сравнение</h3>
      {rows.map(([k, v, c]) => (
        <div key={k} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
          <span className="text-sm text-text-secondary">{k}</span>
          <span className={`font-mono text-sm font-semibold ${c}`}>{v}</span>
        </div>
      ))}
    </Card>
  )
}

export default function StressMeterPage() {
  return (
    <AppShellV2>
      <PageHeader />
      <div className="flex flex-col gap-6 px-4 pb-6 sm:px-8 lg:px-20 lg:pb-7">
        <HeroMetrics />
        <StressChart />
        <div className="flex flex-col gap-4 lg:flex-row">
          <PatternsCard />
          <ComparisonCard />
        </div>
      </div>
    </AppShellV2>
  )
}
