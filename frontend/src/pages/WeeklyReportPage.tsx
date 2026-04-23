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
import { useEffect, useMemo, useState } from 'react'
import { Brain, Share2, Trophy, Plus, X, Check } from 'lucide-react'
import { motion } from 'framer-motion'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AppShellV2 } from '../components/AppShell'
import { useWeeklyReportQuery, type WeeklyReport } from '../lib/queries/weekly'
import {
  useIssueShareTokenMutation,
  type AchievementBrief,
  type EloPoint,
  type PercentileView,
  type SectionBreakdown,
} from '../lib/queries/profile'

// ============================================================================
// Misc utilities
// ============================================================================

const DAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const DAYS_RU_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']

const SECTION_NAMES: Record<string, string> = {
  algorithms: 'Algorithms',
  sql: 'SQL',
  go: 'Go',
  system_design: 'System Design',
  behavioral: 'Behavioral',
  graphs: 'Graphs',
}

// Стабильная палитра по секции — одинаковые цвета на heatmap/ELO/bars.
// Не trust-усь на CSS-переменные внутри SVG-stroke (там через
// currentColor лишний геморрой), берём явные hex.
const SECTION_COLORS: Record<string, string> = {
  algorithms: '#a78bfa',
  sql: '#22d3ee',
  go: '#34d399',
  system_design: '#fb7185',
  behavioral: '#fbbf24',
  graphs: '#f472b6',
}
const FALLBACK_COLOR = '#94a3b8'

function sectionLabel(s: string): string {
  return SECTION_NAMES[s] ?? s.charAt(0).toUpperCase() + s.slice(1)
}
function sectionColor(s: string): string {
  return SECTION_COLORS[s] ?? FALLBACK_COLOR
}

// ISO week — для localStorage-ключа целей. Год+номер недели по ISO-8601
// (понедельник — первый день, неделя 1 — неделя с первым четвергом года).
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function relativeFromNow(iso: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} ч назад`
  const days = Math.floor(h / 24)
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} дн назад`
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

// ============================================================================
// Header
// ============================================================================

function HeaderRow({ report, isLoading }: { report?: WeeklyReport; isLoading: boolean }) {
  // Week N номер — считаем по week_start из бэка (а не "сейчас"), потому что
  // отчёт может быть за прошлую неделю в кеше после инвалидации.
  const weekN = useMemo(() => {
    if (!report?.week_start) return ''
    const d = new Date(report.week_start)
    if (Number.isNaN(d.getTime())) return ''
    return isoWeekKey(d).split('-W')[1]
  }, [report?.week_start])

  // Phase C: share-link. mutate() дёргает /profile/me/report?include_share_token=true
  // и возвращает свежий токен; копируем https://druz9.dev/weekly/share/{token}
  // в clipboard и показываем мини-тост на 2с. Сетевой/clipboard fail —
  // тост с ошибкой (не молчим, anti-fallback).
  const issueShare = useIssueShareTokenMutation()
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function showToast(kind: 'ok' | 'err', text: string) {
    setToast({ kind, text })
    window.setTimeout(() => setToast(null), 2200)
  }

  async function handleShare() {
    try {
      const token = await issueShare.mutateAsync()
      if (!token) {
        showToast('err', 'Не удалось получить ссылку')
        return
      }
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://druz9.dev'
      const url = `${origin}/weekly/share/${token}`
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url)
        showToast('ok', 'Ссылка скопирована')
      } else {
        showToast('ok', url)
      }
    } catch {
      showToast('err', 'Не удалось поделиться')
    }
  }

  return (
    <div className="flex flex-col items-start gap-4 px-4 pt-6 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-20 lg:pt-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary">
          {weekN ? `Неделя ${weekN}` : isLoading ? 'Загрузка…' : 'Неделя'}
        </h1>
        <p className="text-sm text-text-secondary">
          {report?.period ?? (isLoading ? '…' : '—')} · {report?.actions_count ?? 0} действий
        </p>
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={handleShare}
          disabled={issueShare.isPending}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          <Share2 className="h-4 w-4" />
          {issueShare.isPending ? 'Генерируем…' : 'Поделиться'}
        </button>
        {toast && (
          <div
            role="status"
            className={`absolute right-0 top-full mt-2 rounded-lg px-3 py-1.5 font-mono text-[11px] shadow-md ${
              toast.kind === 'ok' ? 'bg-success text-white' : 'bg-danger text-white'
            }`}
          >
            {toast.text}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// 1. TL;DR cards
// ============================================================================

function TldrCards({ report }: { report?: WeeklyReport }) {
  const best = report?.strong_sections?.[0]
  const weakest = report?.weak_sections?.[0]
  const streak = Number(report?.stats.streak.value.replace(/\D/g, '')) || 0
  const bestStreak = report?.stats.streak.best ?? 0
  const isStreakRecord = streak > 0 && streak >= bestStreak

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-5 ring-1 ring-success/30">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-success">
          ЛУЧШАЯ СЕКЦИЯ
        </span>
        {best ? (
          <>
            <span className="font-display text-xl font-extrabold text-text-primary">{best.name}</span>
            <span className="text-[12px] text-text-secondary">
              {best.sub} · <span className="text-success">{best.xp}</span>
            </span>
          </>
        ) : (
          <span className="text-[12px] text-text-muted">Сыграй несколько матчей.</span>
        )}
      </div>
      <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-5 ring-1 ring-warn/30">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-warn">СТРИК</span>
        <span className="font-display text-xl font-extrabold text-text-primary">
          {streak} {streak > 0 ? 'дней' : '—'}
        </span>
        <span className="text-[12px] text-text-secondary">
          {isStreakRecord && streak > 0
            ? 'Личный рекорд!'
            : `лучший: ${bestStreak} дн`}
        </span>
      </div>
      <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-5 ring-1 ring-danger/30">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-danger">
          ФОКУС НА СЛЕДУЮЩУЮ
        </span>
        {weakest ? (
          <>
            <span className="font-display text-xl font-extrabold text-text-primary">{weakest.name}</span>
            <span className="text-[12px] text-text-secondary">
              {weakest.sub} · <span className="text-danger">{weakest.xp}</span>
            </span>
          </>
        ) : (
          <span className="text-[12px] text-text-muted">Слабых секций нет — отличная неделя.</span>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// 2. <HourlyHeatmap data={hourly} /> — 7×24 SVG
// ============================================================================

function HourlyHeatmap({ data }: { data: number[] }) {
  const cells = data.length === 168 ? data : []
  const max = Math.max(0, ...cells)
  const isEmpty = max === 0

  // 5 уровней: 0, 25%, 50%, 75%, 100% от max (percentile-ish bucketing).
  // CSS-классы вместо SVG-fill — так Tailwind сам тянет --color-accent
  // через bg-accent/N с alpha-каналом.
  const LEVELS = ['bg-surface-1', 'bg-accent/20', 'bg-accent/40', 'bg-accent/70', 'bg-accent-hover']
  function levelOf(v: number): number {
    if (v <= 0 || max <= 0) return 0
    const p = v / max
    if (p > 0.75) return 4
    if (p > 0.5) return 3
    if (p > 0.25) return 2
    return 1
  }

  const HOUR_LABELS = [0, 4, 8, 12, 16, 20]

  return (
    <section className="flex flex-col gap-5 rounded-2xl bg-surface-2 p-5 sm:p-7">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-text-primary">Когда ты учишься</h2>
        <span className="font-mono text-[11px] text-text-muted">7 дней × 24 часа</span>
      </div>
      {isEmpty ? (
        <div className="grid place-items-center rounded-xl bg-surface-1 py-12 text-center">
          <span className="text-sm text-text-muted">Нет активности на этой неделе</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex">
            <div className="w-8" />
            <div
              className="grid flex-1 gap-[2px] font-mono text-[10px] text-text-muted"
              style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
            >
              {Array.from({ length: 24 }).map((_, h) => (
                <div key={h} className="text-center">
                  {HOUR_LABELS.includes(h) ? String(h).padStart(2, '0') : ''}
                </div>
              ))}
            </div>
          </div>
          {DAYS_RU.map((d, dow) => (
            <div key={d} className="flex items-center">
              <div className="w-8 font-mono text-[11px] text-text-muted">{d}</div>
              <div
                className="grid flex-1 gap-[2px]"
                style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
              >
                {Array.from({ length: 24 }).map((_, h) => {
                  const v = cells[dow * 24 + h] ?? 0
                  const lvl = levelOf(v)
                  return (
                    <div
                      key={h}
                      className={`h-5 rounded-[3px] ${LEVELS[lvl]} transition-colors`}
                      title={`${DAYS_RU_FULL[dow]} ${String(h).padStart(2, '0')}:00 — ${v} ${v === 1 ? 'матч' : 'матчей'}`}
                    />
                  )
                })}
              </div>
            </div>
          ))}
          <div className="mt-2 flex items-center gap-2 text-[10px] text-text-muted">
            <span>меньше</span>
            {LEVELS.map((cls, i) => (
              <span key={i} className={`h-3 w-3 rounded-[3px] ${cls}`} />
            ))}
            <span>больше</span>
          </div>
        </div>
      )}
    </section>
  )
}

// ============================================================================
// 3. <EloChart series={elo_series} /> — recharts LineChart
// ============================================================================
//
// Refactored from custom SVG to recharts (Phase D polish): we get free axis
// scaling, hover tooltip, legend toggling, and animated path-draw without
// re-implementing them. Section colors stay byte-identical via SECTION_COLORS.

function formatEloDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru', { day: 'numeric', month: 'short' })
}

// Wide-format row keyed by date with one numeric column per section. Recharts
// expects this shape for multi-line charts (one <Line dataKey="..." /> per
// section).
type EloRow = { date: string; label: string } & Record<string, number | string>

function EloChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string; dataKey: string }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-md bg-surface-3 px-3 py-2 text-[11px] shadow-md ring-1 ring-border">
      <div className="mb-1 font-mono text-[10px] text-text-muted">
        {label ? formatEloDate(label) : ''}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-text-primary">
            {sectionLabel(p.dataKey)} · <span className="font-semibold">{p.value}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

function EloChart({ series }: { series: EloPoint[] }) {
  // Build wide-format rows: one row per unique date, columns per section.
  // Sections list is stable-sorted to keep legend/line render order
  // deterministic across re-renders.
  const { rows, sections } = useMemo(() => {
    const sectionSet = new Set<string>()
    const byDate = new Map<string, EloRow>()
    for (const p of series) {
      sectionSet.add(p.section)
      const existing = byDate.get(p.date)
      if (existing) {
        existing[p.section] = p.elo
      } else {
        byDate.set(p.date, { date: p.date, label: formatEloDate(p.date), [p.section]: p.elo })
      }
    }
    const sortedDates = Array.from(byDate.keys()).sort()
    return {
      rows: sortedDates.map((d) => byDate.get(d) as EloRow),
      sections: Array.from(sectionSet).sort(),
    }
  }, [series])

  if (series.length === 0) return null // anti-fallback: пусто → секцию скрываем

  // Y-axis padding ±20 (preserved from prior implementation) so points don't
  // sit on the chart border.
  const elos = series.map((p) => p.elo)
  const minElo = Math.min(...elos) - 20
  const maxElo = Math.max(...elos) + 20

  return (
    <section className="flex flex-col gap-5 rounded-2xl bg-surface-2 p-5 sm:p-7">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-text-primary">Динамика ELO</h2>
        <span className="font-mono text-[11px] text-text-muted">{series.length} точек</span>
      </div>
      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="rgb(var(--color-border))" strokeDasharray="2 4" />
            <XAxis
              dataKey="date"
              tickFormatter={formatEloDate}
              stroke="rgb(var(--color-text-muted))"
              tick={{ fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
            />
            <YAxis
              domain={[Math.round(minElo), Math.round(maxElo)]}
              stroke="rgb(var(--color-text-muted))"
              tick={{ fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
              width={40}
            />
            <Tooltip content={<EloChartTooltip />} cursor={{ stroke: 'rgb(var(--color-border))' }} />
            <Legend
              iconType="circle"
              wrapperStyle={{ fontSize: 12 }}
              formatter={(v) => sectionLabel(String(v))}
            />
            {sections.map((s) => (
              <Line
                key={s}
                type="monotone"
                dataKey={s}
                stroke={sectionColor(s)}
                strokeWidth={2}
                dot={{ r: 4, strokeWidth: 2, stroke: 'rgb(var(--color-surface-2))', fill: sectionColor(s) }}
                activeDot={{ r: 5 }}
                connectNulls
                isAnimationActive
                animationDuration={700}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

// ============================================================================
// 4. <SectionBars data={match_aggregates} />
// ============================================================================

// Tooltip for the recharts SectionBars — renders a per-section win/loss
// summary instead of recharts' default (which lists series independently).
function SectionBarsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ payload: { section: string; wins: number; losses: number; win_rate_pct: number } }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload
  return (
    <div className="rounded-md bg-surface-3 px-3 py-2 text-[11px] shadow-md ring-1 ring-border">
      <div className="mb-1 font-semibold text-text-primary">{label}</div>
      <div className="font-mono text-text-muted">
        <span className="text-success">{row.wins}W</span> ·{' '}
        <span className="text-danger">{row.losses}L</span> · {row.win_rate_pct}% wr
      </div>
    </div>
  )
}

function SectionBars({ data }: { data: SectionBreakdown[] }) {
  if (data.length === 0) {
    return (
      <section className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-5">
        <h2 className="font-display text-lg font-bold text-text-primary">Секции недели</h2>
        <div className="grid place-items-center rounded-xl bg-surface-1 py-10">
          <span className="text-sm text-text-muted">Нет матчей за неделю.</span>
        </div>
      </section>
    )
  }

  // Recharts wants flat row objects. We project name (label) onto x-axis, and
  // stack two numeric series (wins / losses) on y-axis.
  const rows = data.map((s) => ({
    section: s.section,
    name: sectionLabel(s.section),
    wins: s.wins,
    losses: s.losses,
    win_rate_pct: s.win_rate_pct,
  }))

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-surface-2 p-5 sm:p-7">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-text-primary">Секции недели</h2>
        <span className="font-mono text-[11px] text-text-muted">{data.length} разделов</span>
      </div>
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="rgb(var(--color-border))" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="name"
              stroke="rgb(var(--color-text-muted))"
              tick={{ fontSize: 11 }}
              interval={0}
            />
            <YAxis
              allowDecimals={false}
              stroke="rgb(var(--color-text-muted))"
              tick={{ fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
              width={32}
            />
            <Tooltip content={<SectionBarsTooltip />} cursor={{ fill: 'rgb(var(--color-surface-1))' }} />
            <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="wins" stackId="wl" name="Wins" fill="rgb(var(--color-success))" radius={[0, 0, 0, 0]} />
            <Bar dataKey="losses" stackId="wl" name="Losses" fill="rgb(var(--color-danger))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

// ============================================================================
// 5. <PercentileGauge label value /> — SVG semi-circle
// ============================================================================

function PercentileGauge({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, value))
  // Top X% где X = 100 - percentile (то есть «лучше тебя только X%»).
  const topX = 100 - v
  // Цвет: top 25 → success, top 50 → accent, иначе warn.
  const color = topX <= 25 ? 'rgb(var(--color-success))' : topX <= 50 ? 'rgb(var(--color-accent))' : 'rgb(var(--color-warn))'

  // Arc: полукруг радиуса R, от (-R, 0) до (R, 0), центр в (0, 0).
  // Заливка от 0 до v/100 — рисуем path через большую дугу.
  const R = 70
  const W = 180
  const H = 110
  const cx = W / 2
  const cy = 90

  // Угол в радианах: t∈[0..1] → угол π → 0 (слева направо).
  const angle = Math.PI * (1 - v / 100)
  const x = cx + R * Math.cos(angle)
  const y = cy - R * Math.sin(angle)
  const largeArc = v > 50 ? 1 : 0

  // Background semi-circle (всегда дуга 180°).
  const bgPath = `M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`
  // Foreground path до текущей точки.
  const fgPath = `M ${cx - R} ${cy} A ${R} ${R} 0 ${largeArc} 1 ${x} ${y}`

  return (
    <div className="flex flex-1 flex-col items-center gap-2 rounded-2xl bg-surface-2 p-5">
      <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
        {label.toUpperCase()}
      </span>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[200px]">
        <path d={bgPath} stroke="rgb(var(--color-surface-1))" strokeWidth={14} fill="none" strokeLinecap="round" />
        <motion.path
          d={fgPath}
          stroke={color}
          strokeWidth={14}
          fill="none"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
        <text x={cx} y={cy - 18} textAnchor="middle" className="fill-text-primary font-display text-[22px] font-extrabold">
          {v}%
        </text>
        <text x={cx} y={cy - 2} textAnchor="middle" className="fill-text-muted font-mono text-[10px]">
          percentile
        </text>
      </svg>
      <span className="text-[12px] text-text-secondary">
        Top <span className="font-bold" style={{ color }}>{topX}%</span> {label.toLowerCase()}
      </span>
    </div>
  )
}

function PercentileRow({ percentiles }: { percentiles: PercentileView }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-bold text-text-primary">Где ты на лестнице</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <PercentileGauge label="Tier" value={percentiles.in_tier} />
        <PercentileGauge label="Friends" value={percentiles.in_friends} />
        <PercentileGauge label="Globally" value={percentiles.in_global} />
      </div>
    </section>
  )
}

// ============================================================================
// 6. AI Insight
// ============================================================================

function AiInsight({ text }: { text: string }) {
  // Anti-fallback policy (Phase B): empty insight = backend deliberately
  // returned "" (OPENROUTER_API_KEY missing OR upstream errored). НИКОГДА
  // не рендерим placeholder — секция должна полностью исчезать.
  if (!text.trim()) return null
  // Делим на 2 параграфа: либо по двойному \n\n, либо пополам по точке.
  const paragraphs = text.includes('\n\n')
    ? text.split('\n\n').slice(0, 2)
    : [text]
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-accent-hover bg-gradient-to-br from-accent/15 to-pink/10 p-5 sm:p-7">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-pink" />
          <h3 className="font-display text-lg font-bold text-text-primary">AI insight недели</h3>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-muted">
          Сгенерировано Claude Sonnet 4
        </p>
      </div>
      {paragraphs.map((p, i) => (
        <p key={i} className="text-sm leading-relaxed text-text-secondary">
          {p.trim()}
        </p>
      ))}
    </section>
  )
}

// ============================================================================
// 7. <AchievementCard a={achievement} /> + grid
// ============================================================================

const TIER_STYLES: Record<string, string> = {
  bronze: 'bg-warn/15 text-warn border-warn/30',
  silver: 'bg-text-muted/15 text-text-secondary border-text-muted/30',
  gold: 'bg-warn/20 text-warn border-warn/50',
  platinum: 'bg-cyan/15 text-cyan border-cyan/30',
  diamond: 'bg-pink/15 text-pink border-pink/30',
}

function AchievementCard({ a }: { a: AchievementBrief }) {
  const tierCls = TIER_STYLES[a.tier] ?? 'bg-surface-1 text-text-muted border-border'
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-4 ring-1 ring-border">
      <div className="flex items-center gap-2">
        <Trophy className="h-4 w-4 text-warn" />
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${tierCls}`}>
          {a.tier || '—'}
        </span>
      </div>
      <span className="text-sm font-semibold text-text-primary">{a.title}</span>
      <span className="text-[11px] text-text-muted">{relativeFromNow(a.unlocked_at)}</span>
    </div>
  )
}

function AchievementsGrid({ items }: { items: AchievementBrief[] }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-surface-2 p-5 sm:p-7">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-text-primary">Разблокировано на этой неделе</h2>
        <span className="font-mono text-[11px] text-text-muted">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="grid place-items-center rounded-xl bg-surface-1 py-10 text-center">
          <span className="text-sm text-text-muted">Ничего нового — играй активнее.</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((a) => (
            <AchievementCard key={a.code} a={a} />
          ))}
        </div>
      )}
    </section>
  )
}

// ============================================================================
// 8. <GoalsChecklist weekISO /> — localStorage backed
// ============================================================================

type Goal = { id: string; text: string; done: boolean }

function GoalsChecklist({ weekISO }: { weekISO: string }) {
  const storageKey = `druz9.weekly.goals.${weekISO}`
  const [goals, setGoals] = useState<Goal[]>([])
  const [draft, setDraft] = useState('')
  const [hydrated, setHydrated] = useState(false)

  // Hydration из localStorage. Делаем в effect чтобы SSR-safe (хотя у нас
  // CSR-only сейчас — на всякий) и чтобы useState не дёргался при рендере.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as Goal[]
        if (Array.isArray(parsed)) setGoals(parsed.slice(0, 5))
      }
    } catch {
      // повреждённый JSON в localStorage — игнорим, начинаем с пустого
    }
    setHydrated(true)
  }, [storageKey])

  // Persist — только после первой гидратации, чтобы не затереть данные
  // пустым массивом до того как успели прочитать.
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(goals))
    } catch {
      // quota / private mode — silent fail, всё равно в памяти живёт
    }
  }, [goals, storageKey, hydrated])

  function add() {
    const t = draft.trim()
    if (!t || goals.length >= 5) return
    setGoals((g) => [...g, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: t, done: false }])
    setDraft('')
  }
  function toggle(id: string) {
    setGoals((g) => g.map((it) => (it.id === id ? { ...it, done: !it.done } : it)))
  }
  function remove(id: string) {
    setGoals((g) => g.filter((it) => it.id !== id))
  }

  const canAdd = draft.trim().length > 0 && goals.length < 5

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-surface-2 p-5 sm:p-7">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-text-primary">Цели на следующую неделю</h2>
        <span className="font-mono text-[11px] text-text-muted">{goals.length}/5</span>
      </div>
      <div className="flex flex-col gap-2">
        {goals.map((g) => (
          <div
            key={g.id}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2"
          >
            <button
              type="button"
              onClick={() => toggle(g.id)}
              className={`grid h-5 w-5 place-items-center rounded border ${
                g.done ? 'border-success bg-success/20' : 'border-border bg-transparent'
              }`}
              aria-label={g.done ? 'Снять отметку' : 'Отметить выполненной'}
            >
              {g.done && <Check className="h-3 w-3 text-success" />}
            </button>
            <span
              className={`flex-1 text-sm ${g.done ? 'text-text-muted line-through' : 'text-text-primary'}`}
            >
              {g.text}
            </span>
            <button
              type="button"
              onClick={() => remove(g.id)}
              className="grid h-6 w-6 place-items-center rounded text-text-muted hover:text-danger"
              aria-label="Удалить"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {goals.length === 0 && (
          <span className="text-[12px] text-text-muted">Добавь до 5 целей — они сохранятся локально.</span>
        )}
      </div>
      {goals.length < 5 && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            placeholder="Например: 5 LeetCode medium"
            maxLength={100}
            className="flex-1 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={add}
            disabled={!canAdd}
            className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Добавить цель"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}
    </section>
  )
}

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
