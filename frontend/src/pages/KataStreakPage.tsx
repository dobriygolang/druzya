import { Snowflake, Gem, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { useKataStreakQuery, type StreakMonth } from '../lib/queries/streak'

function ErrorChip() {
  const { t } = useTranslation('pages')
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      {t('common.load_failed')}
    </span>
  )
}

const MONTHS = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК']

type CellKind = 'success' | 'warn' | 'danger' | 'cyan' | 'future'

const CELL_COLOR: Record<CellKind, string> = {
  success: 'bg-success',
  warn: 'bg-warn',
  danger: 'bg-danger',
  cyan: 'bg-cyan',
  future: 'bg-border-strong',
}

function Hero({ current, best, freezeTokens, freezeMax }: { current: number; best: number; freezeTokens: number; freezeMax: number }) {
  const { t } = useTranslation('pages')
  return (
    <div className="relative h-auto overflow-hidden bg-gradient-to-br from-surface-3 via-surface-3 to-warn/70 px-4 py-6 sm:px-8 lg:h-[220px] lg:px-20 lg:py-8">
      <div className="flex h-full flex-col items-start justify-between gap-6 lg:flex-row lg:items-center lg:gap-0">
        <div className="flex flex-col gap-3">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-3 py-1 font-mono text-[11px] font-bold tracking-[0.08em] text-warn">
            {t('kata_streak.streak_of', { n: current })}
          </span>
          <div className="flex items-end gap-3">
            <span className="font-display text-6xl sm:text-7xl lg:text-[96px] font-extrabold leading-none text-text-primary">{current}</span>
            <span className="text-4xl sm:text-5xl lg:text-[64px] leading-none">🔥</span>
            <div className="flex flex-col gap-0.5 pb-2">
              <span className="font-mono text-sm text-text-secondary">{t('kata_streak.days_in_row')}</span>
              <span className="font-mono text-xs text-text-muted">{t('kata_streak.best', { n: best })}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          <span className="font-mono text-[11px] font-bold tracking-[0.08em] text-text-secondary">{t('kata_streak.freeze_tokens')}</span>
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
          <span className="font-mono text-xs text-text-secondary">{t('kata_streak.available', { a: freezeTokens, b: freezeMax })}</span>
          <Button variant="ghost" size="sm" className="border-white text-text-primary">
            {t('kata_streak.buy_more')} <Gem className="ml-1 inline h-3 w-3 text-cyan" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function CalendarCard({ year, done, missed, freeze, remaining, months }: { year: number; done: number; missed: number; freeze: number; remaining: number; months: StreakMonth[] }) {
  const { t } = useTranslation('pages')
  return (
    <div className="flex flex-col gap-5 rounded-2xl bg-surface-2 p-6">
      <div className="flex items-end justify-between">
        <h2 className="font-display text-xl font-bold text-text-primary">{t('kata_streak.calendar', { year })}</h2>
        <div className="flex gap-6">
          <div className="flex flex-col"><span className="font-display text-base font-bold text-success">{done}</span><span className="text-[10px] text-text-muted">{t('kata_streak.done')}</span></div>
          <div className="flex flex-col"><span className="font-display text-base font-bold text-danger">{missed}</span><span className="text-[10px] text-text-muted">{t('kata_streak.missed')}</span></div>
          <div className="flex flex-col"><span className="font-display text-base font-bold text-cyan">{freeze}</span><span className="text-[10px] text-text-muted">{t('kata_streak.freeze')}</span></div>
          <div className="flex flex-col"><span className="font-display text-base font-bold text-text-secondary">{remaining}</span><span className="text-[10px] text-text-muted">{t('kata_streak.left')}</span></div>
        </div>
      </div>
      <div className="flex justify-between gap-3 overflow-x-auto">
        {months.map((mo, mi) => {
          const cells: CellKind[] = []
          for (let i = 0; i < 35; i++) {
            if (i >= mo.total) {
              cells.push('future')
            } else if (i < mo.done) {
              const seed = (mi * 11 + i * 7) % 19
              if (seed === 0) cells.push('cyan')
              else if (seed === 1) cells.push('warn')
              else cells.push('success')
            } else if (mo.done === 0 && mi >= 4) {
              cells.push('future')
            } else {
              cells.push('danger')
            }
          }
          const isPast = mo.done > 0
          return (
            <div key={mo.name} className="flex flex-1 flex-col items-center gap-2">
              <span className="font-mono text-[10px] font-semibold text-text-muted">{mo.name}</span>
              <div className="grid grid-cols-7 gap-[2px]">
                {cells.map((c, i) => (
                  <div key={i} className={`h-3 w-3 rounded-[2px] ${CELL_COLOR[c]}`} />
                ))}
              </div>
              <span className={`font-mono text-[10px] ${isPast ? 'text-success' : 'text-text-muted'}`}>
                {mo.done}/{mo.total}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TodayCard({ today }: { today: { title: string; difficulty: string; section: string; complexity: string; time_left: string; day: number } }) {
  const { t } = useTranslation('pages')
  return (
    <div className="flex w-full flex-col gap-4 rounded-2xl bg-gradient-to-br from-surface-3 to-accent p-6 lg:w-[480px]">
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-2.5 py-1 font-mono text-[11px] font-bold text-warn">
        {t('kata_streak.today', { n: today.day })}
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
          <span className="text-[11px] text-text-muted">{t('kata_streak.time_left')}</span>
        </div>
        <Button variant="primary" iconRight={<ArrowRight className="h-4 w-4" />} className="bg-text-primary text-bg shadow-none hover:bg-white/90">
          {t('kata_streak.solve_now')}
        </Button>
      </div>
    </div>
  )
}

function CursedCard() {
  const { t } = useTranslation('pages')
  return (
    <div
      className="flex flex-1 flex-col gap-3 rounded-2xl border-2 border-danger p-6"
      style={{ background: 'linear-gradient(135deg, #2A0510 0%, #1A1A2E 100%)' }}
    >
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-danger/20 px-2.5 py-1 font-mono text-[11px] font-bold text-danger">
        {t('kata_streak.cursed_friday')}
      </span>
      <h3 className="font-display text-lg font-bold text-text-primary">{t('kata_streak.cursed_title')}</h3>
      <p className="text-xs text-text-secondary">
        {t('kata_streak.cursed_desc')}
      </p>
      <div className="mt-auto">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/15 px-3 py-1 font-mono text-[11px] font-bold text-danger">
          {t('kata_streak.cursed_next')}
        </span>
      </div>
    </div>
  )
}

function BossCard() {
  const { t } = useTranslation('pages')
  return (
    <div className="flex flex-1 flex-col gap-3 rounded-2xl border-2 border-pink bg-gradient-to-br from-surface-3 to-pink p-6">
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 font-mono text-[11px] font-bold text-text-primary">
        {t('kata_streak.boss')}
      </span>
      <h3 className="font-display text-lg font-bold text-text-primary">{t('kata_streak.boss_title')}</h3>
      <p className="text-xs text-white/80">
        {t('kata_streak.boss_desc')}
      </p>
      <div className="mt-auto">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 font-mono text-[11px] font-bold text-text-primary">
          {t('kata_streak.boss_when')}
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
        <CalendarCard year={data?.year ?? 2026} done={data?.total_done ?? 127} missed={data?.total_missed ?? 12} freeze={data?.total_freeze ?? 5} remaining={data?.remaining ?? 121} months={data?.months ?? MONTHS.map((m, mi) => ({ name: m, done: mi <= 3 ? (mi === 3 ? 22 : 31) : 0, total: 31 }))} />
        <div className="flex flex-col gap-4 lg:h-[280px] lg:flex-row lg:gap-5">
          <TodayCard today={today} />
          <CursedCard />
          <BossCard />
        </div>
      </div>
    </AppShellV2>
  )
}
