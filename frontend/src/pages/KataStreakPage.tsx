// KataStreakPage — /daily/streak surface.
//
// Year-grid + streak hero + freeze tokens, all driven by GET
// /api/v1/kata/streak (chi-mounted handler in
// backend/services/daily/ports/streak_calendar_handler.go). Today's kata
// (the right-most card) re-uses the existing /api/v1/daily/kata Connect
// RPC — no new endpoint needed.
//
// "Cursed Friday" / "Boss Kata" banners are *product copy*, not data —
// they describe the gamification mechanic. We surface today's kata's
// is_cursed / is_weekly_boss flags inline in TodayCard so the page only
// shows the relevant banners.
import { Snowflake, Gem, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { useKataStreakQuery, type StreakMonth, type StreakResponse } from '../lib/queries/streak'
import { useDailyKataQuery, type DailyKata } from '../lib/queries/daily'

function ErrorChip() {
  const { t } = useTranslation('pages')
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      {t('common.load_failed')}
    </span>
  )
}

function LoadingChip({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-semibold text-text-muted">
      {label}
    </span>
  )
}

type CellKind = 'success' | 'warn' | 'danger' | 'cyan' | 'future'

const CELL_COLOR: Record<CellKind, string> = {
  success: 'bg-success',
  warn: 'bg-warn',
  danger: 'bg-danger',
  cyan: 'bg-cyan',
  future: 'bg-border-strong',
}

// ZERO_MONTHS — placeholder grid used while the query is in flight.
// 12 months × 0 done so the layout doesn't pop.
const ZERO_MONTHS: StreakMonth[] = [
  'ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН',
  'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК',
].map((name) => ({ name, done: 0, missed: 0, freeze: 0, total: 30 }))

function Hero({
  current,
  best,
  freezeTokens,
  freezeMax,
}: {
  current: number
  best: number
  freezeTokens: number
  freezeMax: number
}) {
  const { t } = useTranslation('pages')
  const safeMax = Math.max(freezeMax, 1)
  return (
    <div className="relative h-auto overflow-hidden bg-gradient-to-br from-surface-3 via-surface-3 to-warn/70 px-4 py-6 sm:px-8 lg:h-[220px] lg:px-20 lg:py-8">
      <div className="flex h-full flex-col items-start justify-between gap-6 lg:flex-row lg:items-center lg:gap-0">
        <div className="flex flex-col gap-3">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-3 py-1 font-mono text-[11px] font-bold tracking-[0.08em] text-warn">
            {t('kata_streak.streak_of', { n: current })}
          </span>
          <div className="flex items-end gap-3">
            <span className="font-display text-6xl sm:text-7xl lg:text-[96px] font-extrabold leading-none text-text-primary">
              {current}
            </span>
            <span className="text-4xl sm:text-5xl lg:text-[64px] leading-none">🔥</span>
            <div className="flex flex-col gap-0.5 pb-2">
              <span className="font-mono text-sm text-text-secondary">
                {t('kata_streak.days_in_row')}
              </span>
              <span className="font-mono text-xs text-text-muted">
                {t('kata_streak.best', { n: best })}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          <span className="font-mono text-[11px] font-bold tracking-[0.08em] text-text-secondary">
            {t('kata_streak.freeze_tokens')}
          </span>
          <div className="flex gap-2">
            {Array.from({ length: safeMax }).map((_, i) => (
              <div
                key={i}
                className="grid h-8 w-8 place-items-center rounded-lg"
                style={{ background: '#00000050' }}
              >
                <Snowflake
                  className={`h-4 w-4 ${i < freezeTokens ? 'text-cyan' : 'text-text-muted/40'}`}
                />
              </div>
            ))}
          </div>
          <span className="font-mono text-xs text-text-secondary">
            {t('kata_streak.available', { a: freezeTokens, b: safeMax })}
          </span>
          <Button variant="ghost" size="sm" className="border-white text-text-primary">
            {t('kata_streak.buy_more')} <Gem className="ml-1 inline h-3 w-3 text-cyan" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// monthCells projects a real MonthBucket onto the 35 grid cells the UI
// shows. First N=done cells are green (with sprinkles of cyan-freeze and
// warn-missed if the bucket has them); next M=missed cells are red, then
// freeze cells in cyan, then padding "future" cells out to 35 (or the
// month's `total`, whichever's smaller).
function monthCells(mo: StreakMonth, isFuture: boolean): CellKind[] {
  const cells: CellKind[] = []
  if (isFuture) {
    for (let i = 0; i < 35; i++) {
      cells.push(i < mo.total ? 'future' : 'future')
    }
    return cells
  }
  let i = 0
  for (let k = 0; k < mo.done && i < 35; k++, i++) cells.push('success')
  for (let k = 0; k < mo.freeze && i < 35; k++, i++) cells.push('cyan')
  for (let k = 0; k < mo.missed && i < 35; k++, i++) cells.push('danger')
  // remaining real days in the month — neutral (warn = "not yet started")
  for (; i < mo.total && i < 35; i++) cells.push('warn')
  // padding past month length
  for (; i < 35; i++) cells.push('future')
  return cells
}

function CalendarCard({
  year,
  done,
  missed,
  freeze,
  remaining,
  months,
  currentMonthIdx,
}: {
  year: number
  done: number
  missed: number
  freeze: number
  remaining: number
  months: StreakMonth[]
  currentMonthIdx: number
}) {
  const { t } = useTranslation('pages')
  return (
    <div className="flex flex-col gap-5 rounded-2xl bg-surface-2 p-6">
      <div className="flex items-end justify-between">
        <h2 className="font-display text-xl font-bold text-text-primary">
          {t('kata_streak.calendar', { year })}
        </h2>
        <div className="flex gap-6">
          <div className="flex flex-col">
            <span className="font-display text-base font-bold text-success">{done}</span>
            <span className="text-[10px] text-text-muted">{t('kata_streak.done')}</span>
          </div>
          <div className="flex flex-col">
            <span className="font-display text-base font-bold text-danger">{missed}</span>
            <span className="text-[10px] text-text-muted">{t('kata_streak.missed')}</span>
          </div>
          <div className="flex flex-col">
            <span className="font-display text-base font-bold text-cyan">{freeze}</span>
            <span className="text-[10px] text-text-muted">{t('kata_streak.freeze')}</span>
          </div>
          <div className="flex flex-col">
            <span className="font-display text-base font-bold text-text-secondary">{remaining}</span>
            <span className="text-[10px] text-text-muted">{t('kata_streak.left')}</span>
          </div>
        </div>
      </div>
      <div className="flex justify-between gap-3 overflow-x-auto">
        {months.map((mo, mi) => {
          const isFuture = mi > currentMonthIdx
          const cells = monthCells(mo, isFuture)
          const hasActivity = mo.done + mo.missed + mo.freeze > 0
          return (
            <div key={mo.name} className="flex flex-1 flex-col items-center gap-2">
              <span className="font-mono text-[10px] font-semibold text-text-muted">{mo.name}</span>
              <div className="grid grid-cols-7 gap-[2px]">
                {cells.map((c, i) => (
                  <div key={i} className={`h-3 w-3 rounded-[2px] ${CELL_COLOR[c]}`} />
                ))}
              </div>
              <span
                className={`font-mono text-[10px] ${hasActivity ? 'text-success' : 'text-text-muted'}`}
              >
                {mo.done}/{mo.total}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TodayCard({ kata, dayOfYear }: { kata: DailyKata | undefined; dayOfYear: number }) {
  const { t } = useTranslation('pages')
  const navigate = useNavigate()
  const title = kata?.task.title ?? '—'
  const difficulty = kata?.task.difficulty ?? '—'
  const section = kata?.task.section ?? '—'
  const submitted = kata?.already_submitted ?? false
  return (
    <div className="flex w-full flex-col gap-4 rounded-2xl bg-gradient-to-br from-surface-3 to-accent p-6 lg:w-[480px]">
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-2.5 py-1 font-mono text-[11px] font-bold text-warn">
        {t('kata_streak.today', { n: dayOfYear })}
      </span>
      <h3 className="font-display text-2xl font-bold text-text-primary">{title}</h3>
      <div className="flex gap-2">
        <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-text-secondary">
          {difficulty}
        </span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-text-secondary">
          {section}
        </span>
        {submitted && (
          <span className="rounded-full bg-success/20 px-2 py-0.5 font-mono text-[11px] text-success">
            ✓
          </span>
        )}
      </div>
      <div className="mt-auto flex items-end justify-end">
        <Button
          variant="primary"
          iconRight={<ArrowRight className="h-4 w-4" />}
          className="bg-text-primary text-bg shadow-none hover:bg-white/90"
          onClick={() => navigate('/daily')}
        >
          {submitted ? t('kata_streak.review') : t('kata_streak.solve_now')}
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
      <h3 className="font-display text-lg font-bold text-text-primary">
        {t('kata_streak.cursed_title')}
      </h3>
      <p className="text-xs text-text-secondary">{t('kata_streak.cursed_desc')}</p>
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
      <h3 className="font-display text-lg font-bold text-text-primary">
        {t('kata_streak.boss_title')}
      </h3>
      <p className="text-xs text-white/80">{t('kata_streak.boss_desc')}</p>
      <div className="mt-auto">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 font-mono text-[11px] font-bold text-text-primary">
          {t('kata_streak.boss_when')}
        </span>
      </div>
    </div>
  )
}

// dayOfYear computes the 1-based day index for a UTC date — used as the
// "Day N of the year" badge on TodayCard.
function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0)
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return Math.floor((today - start) / 86_400_000)
}

export default function KataStreakPage() {
  const now = new Date()
  const year = now.getUTCFullYear()
  const monthIdx = now.getUTCMonth() // 0..11

  const streakQ = useKataStreakQuery(year)
  const todayQ = useDailyKataQuery()

  const data: StreakResponse = streakQ.data ?? {
    current: 0,
    best: 0,
    freeze_tokens: 0,
    freeze_max: 5,
    total_done: 0,
    total_missed: 0,
    total_freeze: 0,
    remaining: 0,
    year,
    months: ZERO_MONTHS,
  }

  return (
    <AppShellV2>
      <Hero
        current={data.current}
        best={data.best}
        freezeTokens={data.freeze_tokens}
        freezeMax={data.freeze_max}
      />
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-7">
        <div className="flex items-center gap-2">
          {streakQ.isError && <ErrorChip />}
          {streakQ.isLoading && <LoadingChip label="…" />}
        </div>
        <CalendarCard
          year={data.year}
          done={data.total_done}
          missed={data.total_missed}
          freeze={data.total_freeze}
          remaining={data.remaining}
          months={data.months}
          currentMonthIdx={monthIdx}
        />
        <div className="flex flex-col gap-4 lg:h-[280px] lg:flex-row lg:gap-5">
          <TodayCard kata={todayQ.data} dayOfYear={dayOfYear(now)} />
          <CursedCard />
          <BossCard />
        </div>
      </div>
    </AppShellV2>
  )
}
