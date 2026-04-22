// TODO i18n
import { Brain, Download, ChevronDown, Headphones } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { useWeeklyReportQuery } from '../lib/queries/weekly'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

function HeaderRow({ period, actions, isError }: { period: string; actions: number; isError: boolean }) {
  return (
    <div className="flex flex-col items-start gap-4 px-4 pt-6 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-20 lg:pt-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary">Weekly AI Report</h1>
        <p className="text-sm text-text-secondary">{period} · {actions} действий · скользящий 7-дневный агрегат</p>
        {isError && <ErrorChip />}
      </div>
      <div className="flex items-center gap-3">
        <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-secondary">
          Прошлая неделя <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <Button variant="ghost" size="sm" icon={<Download className="h-3.5 w-3.5" />}>Экспорт</Button>
      </div>
    </div>
  )
}

function MetricCard({ label, chip, chipColor, big, bigColor, sub }: { label: string; chip?: string; chipColor?: string; big: string; bigColor: string; sub: string }) {
  return (
    <div className="flex h-[130px] flex-1 flex-col gap-2 rounded-2xl bg-surface-2 p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">{label}</span>
        {chip && <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${chipColor}`}>{chip}</span>}
      </div>
      <span className={`font-display text-2xl lg:text-[32px] font-extrabold ${bigColor}`}>{big}</span>
      <span className="text-[11px] text-text-muted">{sub}</span>
    </div>
  )
}

function StatsRow({ stats }: { stats?: { xp: { value: string; delta: string }; matches: { value: string; wins: number; losses: number; delta: string }; streak: { value: string; best: number }; avg_lp: { value: string; total: string } } }) {
  const s = stats ?? {
    xp: { value: '+2 480', delta: '+47%' },
    matches: { value: '23', wins: 12, losses: 11, delta: '+18%' },
    streak: { value: '12 🔥', best: 47 },
    avg_lp: { value: '+2.4', total: '+18 lp всего' },
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard label="ОБЩИЙ XP" chip={s.xp.delta} chipColor="bg-success/15 text-success" big={s.xp.value} bigColor="text-accent-hover" sub="за 7 дней" />
      <MetricCard label="МАТЧЕЙ" chip={s.matches.delta} chipColor="bg-success/15 text-success" big={s.matches.value} bigColor="text-text-primary" sub={`${s.matches.wins} W · ${s.matches.losses} L`} />
      <MetricCard label="СТРИК" big={s.streak.value} bigColor="text-warn" sub={`лучшая ${s.streak.best}`} />
      <MetricCard label="СРЕДНИЙ LP/МАТЧ" big={s.avg_lp.value} bigColor="text-success" sub={s.avg_lp.total} />
    </div>
  )
}

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function heatLevel(hour: number, day: number): number {
  // Pattern: high activity Tue 10am, Wed 11am, Sun 9am
  if (day === 1 && hour === 10) return 4
  if (day === 2 && hour === 11) return 4
  if (day === 6 && hour === 9) return 4
  if (Math.abs(hour - 10) <= 1 && day < 5) return 2
  if (hour >= 19 && hour <= 22 && day < 5) return 1
  if ((hour * 7 + day * 13) % 23 === 0) return 3
  if ((hour * 3 + day * 5) % 11 === 0) return 1
  return 0
}

const LEVEL_BG = ['bg-surface-1', 'bg-accent/20', 'bg-accent/40', 'bg-accent', 'bg-accent-hover']

function Heatmap() {
  return (
    <div className="flex flex-col gap-5 rounded-2xl bg-surface-2 p-7">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-text-primary">Активность по дням и часам</h2>
        <div className="flex gap-1 rounded-md bg-surface-1 p-1">
          <button className="rounded bg-accent px-3 py-1 text-xs font-semibold text-text-primary">Heatmap</button>
          <button className="px-3 py-1 text-xs text-text-secondary">Calendar</button>
          <button className="px-3 py-1 text-xs text-text-secondary">Bar</button>
        </div>
      </div>
      <div className="flex overflow-x-auto">
        <div className="flex flex-col justify-around pr-2 text-right">
          {DAYS.map((d) => (
            <span key={d} className="font-mono text-[10px] text-text-muted">{d}</span>
          ))}
        </div>
        <div className="flex flex-1 gap-1">
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={h} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex flex-col gap-[3px]">
                {DAYS.map((_, d) => (
                  <div key={d} className={`h-[18px] w-[18px] rounded-[3px] ${LEVEL_BG[heatLevel(h, d)]}`} />
                ))}
              </div>
              <span className="font-mono text-[9px] text-text-muted">{h}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <span className="font-mono text-[10px] text-text-muted">Меньше</span>
        {LEVEL_BG.map((bg, i) => (
          <div key={i} className={`h-3 w-3 rounded-[3px] ${bg}`} />
        ))}
        <span className="font-mono text-[10px] text-text-muted">Больше</span>
      </div>
    </div>
  )
}

function StrongSections() {
  const rows = [
    { letter: 'A', name: 'Algorithms', sub: '9 матчей · 78% wr', xp: '+340 XP' },
    { letter: 'S', name: 'Strings', sub: '6 матчей · 67% wr', xp: '+220 XP' },
    { letter: 'Q', name: 'SQL', sub: '4 матча · 75% wr', xp: '+180 XP' },
  ]
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-success bg-surface-2 p-5">
      <h3 className="font-display text-sm font-bold text-text-primary">Сильные секции</h3>
      {rows.map((r) => (
        <div key={r.letter} className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-success/20 font-display text-sm font-bold text-success">{r.letter}</span>
          <div className="flex flex-1 flex-col">
            <span className="text-sm font-semibold text-text-primary">{r.name}</span>
            <span className="text-[11px] text-text-muted">{r.sub}</span>
          </div>
          <span className="font-mono text-sm font-bold text-success">{r.xp}</span>
        </div>
      ))}
    </div>
  )
}

function WeakSections() {
  const rows = [
    { letter: 'D', name: 'DP', sub: '3 матча · 33% wr', xp: '-80 XP', color: 'danger' },
    { letter: 'S', name: 'System Design', sub: '2 матча · 50% wr', xp: '+40 XP', color: 'warn' },
  ]
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-danger bg-surface-2 p-5">
      <h3 className="font-display text-sm font-bold text-text-primary">Слабые секции</h3>
      {rows.map((r) => (
        <div key={r.letter} className="flex items-center gap-3">
          <span className={`grid h-9 w-9 place-items-center rounded-full font-display text-sm font-bold ${r.color === 'danger' ? 'bg-danger/20 text-danger' : 'bg-warn/20 text-warn'}`}>{r.letter}</span>
          <div className="flex flex-1 flex-col">
            <span className="text-sm font-semibold text-text-primary">{r.name}</span>
            <span className="text-[11px] text-text-muted">{r.sub}</span>
          </div>
          <span className={`font-mono text-sm font-bold ${r.color === 'danger' ? 'text-danger' : 'text-warn'}`}>{r.xp}</span>
        </div>
      ))}
    </div>
  )
}

function StressPattern() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent-hover bg-gradient-to-br from-accent/20 to-pink/20 p-5">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-pink" />
        <h3 className="font-display text-sm font-bold text-text-primary">Психологический паттерн</h3>
      </div>
      <p className="text-xs leading-relaxed text-text-secondary">
        На этой неделе ты делаешь плохие решения когда таймер &lt; 5 мин — 4 из 5 проигрышей пришлись на цейтнот. Попробуй замедлиться в первой половине: 60 секунд на план перед кодом.
      </p>
    </div>
  )
}

function ActionsCard() {
  const rows = [
    { p: 'P1', text: 'Решить 5 DP задач (medium)', sub: 'закроет слабую секцию' },
    { p: 'P1', text: 'Mock interview по System Design', sub: 'с @alexey, среда 19:00' },
    { p: 'P2', text: 'Replay 3 проигрыша из истории', sub: 'найти общий паттерн' },
  ]
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-accent bg-surface-2 p-5">
      <h3 className="font-display text-sm font-bold text-text-primary">3 действия на следующую неделю</h3>
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-2 border-b border-border pb-2 last:border-0">
          <span className={`mt-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${r.p === 'P1' ? 'bg-danger/15 text-danger' : 'bg-warn/15 text-warn'}`}>{r.p}</span>
          <div className="flex flex-1 flex-col">
            <span className="text-xs font-semibold text-text-primary">{r.text}</span>
            <span className="text-[11px] text-text-muted">{r.sub}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function PodcastCard() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-5">
      <h3 className="font-display text-sm font-bold text-text-primary">Подкаст недели</h3>
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-md bg-gradient-to-br from-pink to-accent">
          <Headphones className="h-5 w-5 text-text-primary" />
        </div>
        <div className="flex flex-1 flex-col">
          <span className="text-xs font-semibold text-text-primary">DP без боли · 32 мин</span>
          <span className="text-[11px] text-text-muted">по твоей слабой секции</span>
        </div>
      </div>
    </div>
  )
}

function CompareWeeks() {
  const rows = [
    { label: 'Эта', xp: 2480, w: '100%' },
    { label: '-1', xp: 1690, w: '68%' },
    { label: '-2', xp: 2010, w: '81%' },
    { label: '-3', xp: 1240, w: '50%' },
  ]
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-5">
      <h3 className="font-display text-sm font-bold text-text-primary">Последние 4 недели</h3>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="w-8 font-mono text-[11px] text-text-muted">{r.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-1">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan to-accent" style={{ width: r.w }} />
          </div>
          <span className="w-14 text-right font-mono text-[11px] text-text-secondary">{r.xp}</span>
        </div>
      ))}
    </div>
  )
}

export default function WeeklyReportPage() {
  const { data, isError } = useWeeklyReportQuery()
  return (
    <AppShellV2>
      <HeaderRow period={data?.period ?? '21–27 апреля'} actions={data?.actions_count ?? 47} isError={isError} />
      <div className="flex flex-col gap-6 px-4 pb-6 pt-6 sm:px-8 lg:px-20 lg:pb-7">
        <StatsRow stats={data?.stats} />
        <Heatmap />
        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <div className="flex flex-1 flex-col gap-5">
            <StrongSections />
            <WeakSections />
            <StressPattern />
          </div>
          <div className="flex w-full flex-col gap-5 lg:w-[360px]">
            <ActionsCard />
            <PodcastCard />
            <CompareWeeks />
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
