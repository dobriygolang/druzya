// OGCardStreak — 1200×630 «Streak-focused» layout. Designer source:
// /Users/sedorofeevd/Downloads/og-cards.jsx :: CardStreak.

import type { WeeklyReport } from '../../../lib/queries/profile'
import {
  CardFrame,
  TopBar,
  BottomStrip,
  Eyebrow,
  PullQuote,
} from './ogPrimitives'
import type { OGCardCommon } from './OGCardXP'

const DAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС']

export function OGCardStreak({
  report,
  user,
}: {
  report: WeeklyReport
  user: OGCardCommon
}) {
  const streak = report.streak_days ?? 0
  const best = report.best_streak ?? 0
  const heatRaw = report.heatmap ?? []
  // Normalise heatmap to 7 cells in [0..1].
  const max = heatRaw.reduce((m, v) => Math.max(m, v), 0) || 1
  const heat: number[] = Array.from({ length: 7 }, (_, i) => {
    const v = heatRaw[i] ?? 0
    return v <= 0 ? 0 : Math.max(0.15, v / max)
  })
  const ratingDelta = report.metrics.rating_change ?? 0
  const xp = report.metrics.xp_earned ?? 0
  const matches = report.metrics.matches_won ?? 0
  const tasks = report.metrics.tasks_solved ?? 0
  const actions = report.actions_count ?? matches + tasks
  const activeDays = heatRaw.filter((v) => v > 0).length

  const quote = (report.ai_insight ?? report.stress_analysis ?? '').trim()
  const lead = quote.split('\n\n')[0].slice(0, 220)

  return (
    <CardFrame texture="grid">
      <TopBar name={user.name} letter={user.letter} week={user.week} range={user.range} />

      <div className="flex-1 flex items-center">
        <div className="w-full grid grid-cols-12 gap-10 items-center">
          <div className="col-span-5">
            <Eyebrow>🔥 streak · unbroken</Eyebrow>
            <div className="flex items-start gap-3">
              <span
                className="font-display font-extrabold tracking-tight text-warn"
                style={{ fontSize: 260, lineHeight: 0.82 }}
              >
                {streak}
              </span>
              <div className="flex flex-col justify-end pb-4 pt-24">
                <span
                  className="font-display font-bold text-text-primary"
                  style={{ fontSize: 32, lineHeight: 1 }}
                >
                  дней
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted mt-2">
                  {best > 0 ? `лучший: ${best}` : 'подряд · без пропуска'}
                </span>
              </div>
            </div>
          </div>

          <div className="col-span-7 border-l border-border-strong pl-10">
            <Eyebrow>7 дней{user.range ? ` · ${user.range}` : ''}</Eyebrow>
            <div className="mt-4 grid grid-cols-7 gap-2.5" style={{ width: 520 }}>
              {heat.map((h, i) => (
                <div key={i} className="flex flex-col items-center gap-2">
                  <div
                    className="w-full rounded-[4px] relative"
                    style={{
                      height: 92,
                      background: h === 0 ? 'transparent' : 'rgba(251,191,36,0.08)',
                      border:
                        h === 0
                          ? '1px dashed rgb(var(--color-danger))'
                          : '1px solid rgba(251,191,36,0.3)',
                    }}
                  >
                    {h > 0 && (
                      <div
                        className="absolute bottom-0 left-0 right-0 rounded-b-[3px]"
                        style={{
                          background: 'rgb(var(--color-warn))',
                          height: `${h * 100}%`,
                          opacity: 0.85,
                        }}
                      />
                    )}
                    {h === 0 && (
                      <span className="absolute inset-0 grid place-items-center font-mono text-[9px] uppercase text-danger">
                        skip
                      </span>
                    )}
                  </div>
                  <span
                    className={`font-mono text-[10px] uppercase ${h === 0 ? 'text-danger' : 'text-text-muted'}`}
                  >
                    {DAYS[i]}
                  </span>
                </div>
              ))}
            </div>
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
          { label: 'active', value: `${activeDays}/7`, tone: 'cyan' },
          { label: 'xp week', value: `+${xp.toLocaleString('ru-RU')}` },
          { label: 'actions', value: actions, foot: `${matches} w · ${tasks} t` },
          {
            label: 'elo Δ',
            value: `${ratingDelta >= 0 ? '+' : ''}${ratingDelta}`,
            tone: ratingDelta >= 0 ? 'success' : 'danger',
          },
        ]}
      />
    </CardFrame>
  )
}

export default OGCardStreak
