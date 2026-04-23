// OGCardAchievement — 1200×630 «Achievement-focused» layout. Designer source:
// /Users/sedorofeevd/Downloads/og-cards.jsx :: CardAchievement.

import type { WeeklyReport, AchievementBrief } from '../../../lib/queries/profile'
import {
  CardFrame,
  TopBar,
  BottomStrip,
  Eyebrow,
  PullQuote,
} from './ogPrimitives'
import type { OGCardCommon } from './OGCardXP'

// Tier → gradient (от пары пина→cyan для эпиков, тёплая для золота, и т.п.).
const TIER_GRAD: Record<string, [string, string]> = {
  bronze: ['#D97706', '#92400E'],
  silver: ['#94A3B8', '#475569'],
  gold: ['#FBBF24', '#B45309'],
  platinum: ['#22D3EE', '#0E7490'],
  epic: ['#22D3EE', '#582CFF'],
  legendary: ['#F472B6', '#582CFF'],
}

function gradFor(tier?: string): [string, string] {
  if (!tier) return ['#22D3EE', '#582CFF']
  return TIER_GRAD[tier.toLowerCase()] ?? ['#22D3EE', '#582CFF']
}

export function OGCardAchievement({
  report,
  user,
  achievement,
}: {
  report: WeeklyReport
  user: OGCardCommon
  achievement: AchievementBrief
}) {
  const [from, to] = gradFor(achievement.tier)
  const xp = report.metrics.xp_earned ?? 0
  const ratingDelta = report.metrics.rating_change ?? 0
  const matches = report.metrics.matches_won ?? 0
  const tasks = report.metrics.tasks_solved ?? 0
  const actions = report.actions_count ?? matches + tasks
  const streak = report.streak_days ?? 0

  const quote = (report.ai_insight ?? report.stress_analysis ?? '').trim()
  const lead = quote.split('\n\n')[0].slice(0, 220)

  return (
    <CardFrame texture="dots">
      <TopBar name={user.name} letter={user.letter} week={user.week} range={user.range} />

      <div className="flex-1 flex items-center">
        <div className="w-full grid grid-cols-12 gap-10 items-center">
          <div className="col-span-5">
            <div className="relative" style={{ width: 280, height: 280 }}>
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(135deg, ${from}, ${to})`,
                  clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
                  opacity: 0.18,
                }}
              />
              <div
                className="absolute grid place-items-center rounded-[32px]"
                style={{
                  inset: 36,
                  background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
                  boxShadow: '0 24px 60px -12px rgba(88,44,255,0.4)',
                }}
              >
                <span
                  className="font-display font-extrabold text-white"
                  style={{
                    fontSize: 96,
                    lineHeight: 1,
                    filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.3))',
                  }}
                >
                  {(achievement.title || '·').slice(0, 1).toUpperCase()}
                </span>
              </div>
              <div
                className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-md px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em]"
                style={{
                  background: 'rgb(var(--color-bg))',
                  border: '1px solid rgb(var(--color-border-strong))',
                  color: '#FBBF24',
                }}
              >
                {achievement.tier || 'tier'}
              </div>
            </div>
          </div>

          <div className="col-span-7">
            <Eyebrow>◆ achievement unlocked</Eyebrow>
            <h1
              className="mt-2 font-display font-extrabold g-ac"
              style={{ fontSize: 80, lineHeight: 0.95, letterSpacing: '-0.02em' }}
            >
              {achievement.title}
            </h1>
            <div className="mt-6 inline-flex items-center gap-3 rounded-md border border-border-strong bg-surface-1/60 px-4 py-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                неделя {user.week}
              </span>
              {user.range && (
                <>
                  <span className="text-border-strong">/</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                    {user.range}
                  </span>
                </>
              )}
              <span className="text-border-strong">/</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-success">
                +{xp.toLocaleString('ru-RU')} xp
              </span>
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
          { label: 'xp', value: `+${xp.toLocaleString('ru-RU')}`, tone: 'cyan' },
          {
            label: 'elo Δ',
            value: `${ratingDelta >= 0 ? '+' : ''}${ratingDelta}`,
            tone: ratingDelta >= 0 ? 'success' : 'danger',
          },
          { label: 'actions', value: actions, foot: 'across the week' },
          { label: 'streak', value: `${streak}d`, tone: 'warn' },
        ]}
      />
    </CardFrame>
  )
}

export default OGCardAchievement
