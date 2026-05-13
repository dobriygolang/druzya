// StreakChip — reusable habit indicator. Reads computeStreak() из F5 activity
// store. Hidden когда streak <3 (не показываем chip пока habit не set).
//
// Variants:
//   3-6 дней:  «N-day streak» (subtle)
//   7-13 дн:   «7-day streak · consistent» (text-primary)
//   14-29 дн:  «14-day streak · strong» (text-primary, slightly bolder)
//   30+ дн:    «30-day streak · locked in» (full emphasis)
//
// B/W rule: red 1.5px ring only когда includesToday=false (warning «не log'ал
// сегодня — streak в опасности»). Otherwise neutral surface.

import { Flame } from 'lucide-react'

import { useStreak } from '../lib/useActivity'

interface Props {
  /** Compact variant — для headers / hero. Без detail tier label. */
  compact?: boolean
}

export function StreakChip({ compact }: Props) {
  const streak = useStreak()

  if (streak.days < 3) return null

  const tierLabel = (() => {
    if (streak.days >= 30) return 'locked in'
    if (streak.days >= 14) return 'strong'
    if (streak.days >= 7) return 'consistent'
    return null
  })()

  const atRisk = !streak.includesToday

  return (
    <span
      role="status"
      className="relative inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)]"
      title={
        atRisk
          ? `${streak.days}-day streak · сегодня ещё не log'ал — successive day может прервать`
          : `${streak.days} ${pluralDays(streak.days)} подряд · longest за всё время ${streak.longestDays}`
      }
    >
      {/* Red ring если streak at-risk (сегодня не log'ал). B/W rule preserved
        — это критический индикатор юзеру (1.5px vertical stripe). */}
      {atRisk && (
        <span
          aria-hidden
          className="absolute -left-px top-0 h-full w-[1.5px] rounded-l-md"
          style={{ background: 'var(--red)' }}
        />
      )}
      <Flame className="h-3 w-3 text-text-secondary" />
      <span className="font-mono text-[11px] font-semibold text-text-primary tabular-nums">
        {streak.days}
      </span>
      {!compact && (
        <>
          <span className="font-mono text-[10px] text-text-muted">
            {pluralDaysShort(streak.days)}
          </span>
          {tierLabel && (
            <>
              <span className="text-text-muted">·</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
                {tierLabel}
              </span>
            </>
          )}
        </>
      )}
    </span>
  )
}

function pluralDays(n: number): string {
  if (n === 1) return 'день'
  if (n >= 2 && n <= 4) return 'дня'
  return 'дней'
}

function pluralDaysShort(_n: number): string {
  return 'дн.'
}
