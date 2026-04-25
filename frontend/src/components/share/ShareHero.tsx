// ShareHero — hero stat for the public weekly-share view.
//
// Three variants pick the dominant number a viewer-screenshot tells the story
// around. Each variant follows the same skeleton (eyebrow / giant number /
// caption) so the OG-screenshot at 1200×630 maintains a uniform centre of
// gravity regardless of which metric we lead with.
//
// Anti-fallback: каждое значение приходит из бэкенда. Никаких "—" / "0" с
// дельтой "+0%" — если поле пустое, секция всё равно рендерит «нет данных»
// в caption (нет смысла прятать всю плашку, она задаёт layout-rhythm).

export type HeroVariant = 'achievement' | 'xp' | 'streak'

export type ShareHeroProps = {
  variant: HeroVariant
  // XP-вариант — сколько XP заработано за неделю.
  xpEarned?: number
  prevXpEarned?: number
  // Streak-вариант — текущий и лучший стрик.
  streakDays?: number
  bestStreak?: number
  // Achievement-вариант — заголовок ачивки (берётся первый из
  // achievements_this_week) + tier для подсветки.
  achievementTitle?: string
  achievementTier?: string
}

function fmtDelta(curr: number, prev: number): string {
  if (prev <= 0) return curr > 0 ? '+∞%' : '0%'
  const d = ((curr - prev) / prev) * 100
  const sign = d >= 0 ? '+' : ''
  return `${sign}${Math.round(d)}%`
}

export function ShareHero(props: ShareHeroProps) {
  if (props.variant === 'xp') {
    const xp = props.xpEarned ?? 0
    const delta = fmtDelta(xp, props.prevXpEarned ?? 0)
    return (
      <HeroFrame eyebrow="Заработано XP">
        <span className="font-display text-[88px] sm:text-[120px] lg:text-[160px] font-extrabold leading-none text-text-primary">
          {xp.toLocaleString('ru-RU')}
        </span>
        <span className="font-mono text-sm text-text-secondary">
          {delta} к прошлой неделе
        </span>
      </HeroFrame>
    )
  }
  if (props.variant === 'streak') {
    const cur = props.streakDays ?? 0
    const best = props.bestStreak ?? 0
    const isPB = cur > 0 && cur >= best
    return (
      <HeroFrame eyebrow="Стрик">
        <span className="font-display text-[88px] sm:text-[120px] lg:text-[160px] font-extrabold leading-none text-text-primary">
          {cur}
          <span className="ml-2 text-warn">🔥</span>
        </span>
        <span className="font-mono text-sm text-text-secondary">
          {isPB ? 'личный рекорд' : `лучший: ${best} дн`}
        </span>
      </HeroFrame>
    )
  }
  // achievement
  const title = (props.achievementTitle ?? '').trim()
  const tier = (props.achievementTier ?? '').toUpperCase()
  return (
    <HeroFrame eyebrow="Ачивка недели">
      {title ? (
        <>
          <span className="font-display text-3xl sm:text-5xl lg:text-6xl font-extrabold leading-tight text-text-primary text-center max-w-[18ch]">
            {title}
          </span>
          {tier && (
            <span className="rounded-full border border-warn/50 bg-warn/15 px-3 py-1 font-mono text-[11px] font-bold uppercase text-warn">
              {tier}
            </span>
          )}
        </>
      ) : (
        <span className="font-mono text-sm text-text-muted">Нет ачивок за неделю</span>
      )}
    </HeroFrame>
  )
}

function HeroFrame({
  eyebrow,
  children,
}: {
  eyebrow: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col items-center gap-4 rounded-2xl border border-border-strong bg-surface-2 p-6 sm:p-10 lg:p-14">
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-secondary">
        {eyebrow}
      </span>
      {children}
    </section>
  )
}

export default ShareHero
