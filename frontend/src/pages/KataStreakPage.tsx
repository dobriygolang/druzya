// TODO i18n
import { Snowflake, Gem, ArrowRight } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { useKataStreakQuery } from '../lib/queries/streak'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

const MONTHS = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК']

type CellKind = 'success' | 'warn' | 'danger' | 'cyan' | 'future'

function makeMonth(monthIdx: number): CellKind[] {
  const cells: CellKind[] = []
  for (let i = 0; i < 35; i++) {
    if (monthIdx > 3) {
      cells.push('future')
      continue
    }
    const seed = (monthIdx * 11 + i * 7) % 19
    if (seed === 0) cells.push('cyan')
    else if (seed === 1) cells.push('danger')
    else if (seed === 2) cells.push('warn')
    else cells.push('success')
  }
  return cells
}

const CELL_COLOR: Record<CellKind, string> = {
  success: 'bg-success',
  warn: 'bg-warn',
  danger: 'bg-danger',
  cyan: 'bg-cyan',
  future: 'bg-border-strong',
}

function Hero({ current, best, freezeTokens, freezeMax }: { current: number; best: number; freezeTokens: number; freezeMax: number }) {
  return (
    <div className="relative h-auto overflow-hidden bg-gradient-to-br from-surface-3 via-surface-3 to-warn/70 px-4 py-6 sm:px-8 lg:h-[220px] lg:px-20 lg:py-8">
      <div className="flex h-full flex-col items-start justify-between gap-6 lg:flex-row lg:items-center lg:gap-0">
        <div className="flex flex-col gap-3">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-3 py-1 font-mono text-[11px] font-bold tracking-[0.08em] text-warn">
            СЕРИЯ ИЗ {current} ДНЕЙ
          </span>
          <div className="flex items-end gap-3">
            <span className="font-display text-6xl sm:text-7xl lg:text-[96px] font-extrabold leading-none text-text-primary">{current}</span>
            <span className="text-4xl sm:text-5xl lg:text-[64px] leading-none">🔥</span>
            <div className="flex flex-col gap-0.5 pb-2">
              <span className="font-mono text-sm text-text-secondary">дней подряд</span>
              <span className="font-mono text-xs text-text-muted">лучшая {best}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          <span className="font-mono text-[11px] font-bold tracking-[0.08em] text-text-secondary">FREEZE TOKENS</span>
          <div className="flex gap-2">
            {Array.from({ length: freezeMax }).map((_, i) => (
              <div
                key={i}
                className="grid h-8 w-8 place-items-center rounded-lg"
                style={{ background: '#00000050' }}
              >
                <Snowflake className={`h-4 w-4 ${i < freezeTokens ? 'text-cyan' : 'text-text-muted/40'}`} />
              </div>
            ))}
          </div>
          <span className="font-mono text-xs text-text-secondary">{freezeTokens}/{freezeMax} доступно</span>
          <Button variant="ghost" size="sm" className="border-white text-text-primary">
            Купить ещё · 100 <Gem className="ml-1 inline h-3 w-3 text-cyan" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function CalendarCard({ year, done, missed, freeze, remaining }: { year: number; done: number; missed: number; freeze: number; remaining: number }) {
  return (
    <div className="flex flex-col gap-5 rounded-2xl bg-surface-2 p-6">
      <div className="flex items-end justify-between">
        <h2 className="font-display text-xl font-bold text-text-primary">Календарь {year}</h2>
        <div className="flex gap-6">
          <div className="flex flex-col"><span className="font-display text-base font-bold text-success">{done}</span><span className="text-[10px] text-text-muted">пройдено</span></div>
          <div className="flex flex-col"><span className="font-display text-base font-bold text-danger">{missed}</span><span className="text-[10px] text-text-muted">пропущено</span></div>
          <div className="flex flex-col"><span className="font-display text-base font-bold text-cyan">{freeze}</span><span className="text-[10px] text-text-muted">freeze</span></div>
          <div className="flex flex-col"><span className="font-display text-base font-bold text-text-secondary">{remaining}</span><span className="text-[10px] text-text-muted">ост.</span></div>
        </div>
      </div>
      <div className="flex justify-between gap-3 overflow-x-auto">
        {MONTHS.map((m, mi) => {
          const cells = makeMonth(mi)
          const total = mi <= 3 ? 31 : 31
          const done = mi <= 3 ? (mi === 3 ? 22 : 31) : 0
          return (
            <div key={m} className="flex flex-1 flex-col items-center gap-2">
              <span className="font-mono text-[10px] font-semibold text-text-muted">{m}</span>
              <div className="grid grid-cols-7 gap-[2px]">
                {cells.map((c, i) => (
                  <div key={i} className={`h-3 w-3 rounded-[2px] ${CELL_COLOR[c]}`} />
                ))}
              </div>
              <span className={`font-mono text-[10px] ${mi <= 3 ? 'text-success' : 'text-text-muted'}`}>
                {done}/{total}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TodayCard({ today }: { today: { title: string; difficulty: string; section: string; complexity: string; time_left: string; day: number } }) {
  return (
    <div className="flex w-full flex-col gap-4 rounded-2xl bg-gradient-to-br from-surface-3 to-accent p-6 lg:w-[480px]">
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-2.5 py-1 font-mono text-[11px] font-bold text-warn">
        СЕГОДНЯ · ДЕНЬ {today.day}
      </span>
      <h3 className="font-display text-2xl font-bold text-text-primary">{today.title}</h3>
      <div className="flex gap-2">
        <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-text-secondary">{today.difficulty}</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-text-secondary">{today.section}</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-text-secondary">{today.complexity}</span>
      </div>
      <div className="mt-auto flex items-end justify-between">
        <div className="flex flex-col">
          <span className="font-display text-xl font-bold text-cyan">{today.time_left}</span>
          <span className="text-[11px] text-text-muted">до конца дня</span>
        </div>
        <Button variant="primary" iconRight={<ArrowRight className="h-4 w-4" />} className="bg-text-primary text-bg shadow-none hover:bg-white/90">
          Решить сейчас
        </Button>
      </div>
    </div>
  )
}

function CursedCard() {
  return (
    <div
      className="flex flex-1 flex-col gap-3 rounded-2xl border-2 border-danger p-6"
      style={{ background: 'linear-gradient(135deg, #2A0510 0%, #1A1A2E 100%)' }}
    >
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-danger/20 px-2.5 py-1 font-mono text-[11px] font-bold text-danger">
        🎃 ПРОКЛЯТАЯ ПЯТНИЦА
      </span>
      <h3 className="font-display text-lg font-bold text-text-primary">Каждую пятницу — сложнее, ×3 XP</h3>
      <p className="text-xs text-text-secondary">
        Пропустишь — серия не сломается, но сгорит freeze. Пройдёшь — тройная награда и редкий титул.
      </p>
      <div className="mt-auto">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/15 px-3 py-1 font-mono text-[11px] font-bold text-danger">
          Следующая через 2 дня
        </span>
      </div>
    </div>
  )
}

function BossCard() {
  return (
    <div className="flex flex-1 flex-col gap-3 rounded-2xl border-2 border-pink bg-gradient-to-br from-surface-3 to-pink p-6">
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 font-mono text-[11px] font-bold text-text-primary">
        👑 BOSS KATA
      </span>
      <h3 className="font-display text-lg font-bold text-text-primary">Воскресный босс — редкий титул</h3>
      <p className="text-xs text-white/80">
        Раз в неделю — кошмарная задача от топовых интервьюеров. Решишь — попадёшь в зал славы.
      </p>
      <div className="mt-auto">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 font-mono text-[11px] font-bold text-text-primary">
          В это воскресенье · через 4 дня
        </span>
      </div>
    </div>
  )
}

export default function KataStreakPage() {
  const { data, isError } = useKataStreakQuery()
  const today = data?.today ?? { title: 'Binary Search Rotated', difficulty: 'Medium', section: 'Algorithms', complexity: 'O(log n)', time_left: 'осталось 14ч 32м', day: 12 }
  return (
    <AppShellV2>
      <Hero current={data?.current ?? 12} best={data?.best ?? 47} freezeTokens={data?.freeze_tokens ?? 3} freezeMax={data?.freeze_max ?? 5} />
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-7">
        {isError && <ErrorChip />}
        <CalendarCard year={data?.year ?? 2026} done={data?.total_done ?? 127} missed={data?.total_missed ?? 12} freeze={data?.total_freeze ?? 5} remaining={data?.remaining ?? 121} />
        <div className="flex flex-col gap-4 lg:h-[280px] lg:flex-row lg:gap-5">
          <TodayCard today={today} />
          <CursedCard />
          <BossCard />
        </div>
      </div>
    </AppShellV2>
  )
}
