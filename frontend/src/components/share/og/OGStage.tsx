// OGStage — fixed 1200×630 viewport for puppeteer to crop. Picks one of the
// three OGCard layouts based on the resolved variant. Mounted by
// WeeklyShareView when ?screenshot=1 is present.
//
// Backend renderer flow (TODO when wired):
//   GET /api/v1/profile/weekly/share/{token}/og.png
//     → puppeteer goto /weekly/share/{token}?screenshot=1&variant=…
//     → wait for #screenshot-stage
//     → element.screenshot({ omitBackground: false }) → cache 24h.

import { useEffect, type ReactNode } from 'react'
import type { WeeklyReport, AchievementBrief } from '../../../lib/queries/profile'
import { OGCardXP, type OGCardCommon } from './OGCardXP'
import { OGCardStreak } from './OGCardStreak'
import { OGCardAchievement } from './OGCardAchievement'
import type { HeroVariant } from '../ShareHero'

export function OGStage({
  variant,
  report,
  user,
  achievement,
}: {
  variant: HeroVariant
  report: WeeklyReport
  user: OGCardCommon
  achievement?: AchievementBrief
}) {
  useEffect(() => {
    document.body.classList.add('share-screenshot-mode')
    return () => {
      document.body.classList.remove('share-screenshot-mode')
    }
  }, [])

  // Achievement variant degrades to XP if no achievement exists. Fail-honest:
  // не рисуем «Achievement» с пустым названием.
  let card: ReactNode
  if (variant === 'achievement' && achievement) {
    card = <OGCardAchievement report={report} user={user} achievement={achievement} />
  } else if (variant === 'streak') {
    card = <OGCardStreak report={report} user={user} />
  } else {
    card = <OGCardXP report={report} user={user} />
  }

  return (
    <div
      id="screenshot-stage"
      style={{
        width: 1200,
        height: 630,
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: 'rgb(var(--color-bg))',
      }}
    >
      {card}
    </div>
  )
}

export default OGStage
