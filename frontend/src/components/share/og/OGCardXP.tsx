// OGCardXP — 1200×630 «XP-focused» layout. Designer source:
// /Users/sedorofeevd/Downloads/og-cards.jsx :: CardXP.
//
// All numbers come from the WeeklyReport payload. Empty/zero is rendered
// honestly (e.g. «+0»), не подменяем заглушками.

import type { WeeklyReport } from '../../../lib/queries/profile'
import {
  CardFrame,
  TopBar,
  BottomStrip,
  Eyebrow,
  PullQuote,
} from './ogPrimitives'

export type OGCardCommon = {
  name: string
  letter: string
  week: number | string
  range?: string
  showCta?: boolean
}

function pct(curr: number, prev: number): number {
  if (prev <= 0) return 0
  return Math.round(((curr - prev) / prev) * 100)
}

export function OGCardXP({
  report,
  user,
}: {
  report: WeeklyReport
  user: OGCardCommon
}) {
  const xp = report.metrics.xp_earned ?? 0
  const xpPct = pct(xp, report.prev_xp_earned ?? 0)
  const ratingDelta = report.metrics.rating_change ?? 0
  const matches = report.metrics.matches_won ?? 0
  const tasks = report.metrics.tasks_solved ?? 0
  const streak = report.streak_days ?? 0
  const actions = report.actions_count ?? matches + tasks
  const activeDays = (report.heatmap ?? []).filter((v) => v > 0).length
  const topSection = (report.strong_sections ?? [])[0]

  const quote = (report.ai_insight ?? report.stress_analysis ?? '').trim()
  const lead = quote.split('\n\n')[0].slice(0, 220)

  return (
    <CardFrame texture="grid">
      <TopBar name={user.name} letter={user.letter} week={user.week} range={user.range} />

      <div className="flex-1 flex items-center">
        <div className="w-full grid grid-cols-12 gap-10 items-center">
          <div className="col-span-8">
            <div className="flex items-center gap-3 mb-2">
              <Eyebrow>▲ xp earned · week {user.week}</Eyebrow>
              {report.prev_xp_earned !== undefined && (
                <span className="font-mono text-[10px] text-success">
                  {xpPct >= 0 ? '+' : ''}{xpPct}% week-over-week
                </span>
              )}
            </div>
            <div className="flex items-start gap-4 leading-none">
              <span
                className="font-display font-medium text-text-muted"
                style={{ fontSize: 52, marginTop: 24 }}
              >
                +
              </span>
              <span
                className="font-display font-extrabold tracking-tight g-ac"
                style={{ fontSize: 220, lineHeight: 0.85 }}
              >
                {xp.toLocaleString('ru-RU')}
              </span>
            </div>
            <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted">
              experience points
            </div>
          </div>

          <div className="col-span-4 border-l border-border-strong pl-8">
            <Eyebrow>elo Δ</Eyebrow>
            <div className="mt-2 flex items-baseline gap-2">
              <span
                className={`font-display font-extrabold ${ratingDelta >= 0 ? 'text-success' : 'text-danger'}`}
                style={{ fontSize: 56, lineHeight: 1 }}
              >
                {ratingDelta >= 0 ? '+' : ''}
                {ratingDelta}
              </span>
            </div>
            <div className="mt-3 font-mono text-[13px] text-text-secondary">
              {matches}<span className="text-text-muted"> w</span> · {tasks}<span className="text-text-muted"> tasks</span>
            </div>
            <div className="mt-5 hairline w-20" />
            {topSection && (
              <div className="mt-5">
                <Eyebrow>top section</Eyebrow>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="font-display font-bold" style={{ fontSize: 18 }}>
                    {topSection.section}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {lead && (
        <div className="pt-4 pb-6 border-t border-border-strong">
          <PullQuote>{lead}</PullQuote>
        </div>
      )}

      <BottomStrip
        showCta={user.showCta}
        metrics={[
          { label: 'actions', value: actions, foot: `${matches} w · ${tasks} t` },
          { label: 'active days', value: `${activeDays}/7`, tone: 'cyan' },
          { label: 'streak', value: streak, tone: 'warn', foot: 'days · unbroken' },
          {
            label: 'minutes',
            value: report.metrics.time_minutes ?? 0,
            foot: 'deliberate practice',
          },
        ]}
      />
    </CardFrame>
  )
}

export default OGCardXP
