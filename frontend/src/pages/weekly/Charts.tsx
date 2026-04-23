import { useMemo } from 'react'
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
import type { EloPoint, SectionBreakdown } from '../../lib/queries/profile'
import { sectionColor, sectionLabel } from './utils'

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

export function EloChart({ series }: { series: EloPoint[] }) {
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

export function SectionBars({ data }: { data: SectionBreakdown[] }) {
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
