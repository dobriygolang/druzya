// EloRing — animated ELO tween with circular progress ring
// (Wave-10, design-review v4 shared component #3).
//
// Two synchronised animations:
//   1. Number tweens from `from` → `to` over `duration` ms with cubic
//      ease-out. Each integer change can fire `onTick` (used for sound).
//   2. SVG circle stroke-dashoffset locks to the *final* progress within
//      tierBand — we don't animate the ring fill itself because it would
//      add visual weight competing with the number.
//
// Reduced-motion: skips the number tween entirely (jumps to `to`),
// per WCAG prefers-reduced-motion.

import { useState } from 'react'
import { motion, useAnimationFrame, useReducedMotion } from 'framer-motion'
import { cn } from '../lib/cn'

export type EloRingProps = {
  from: number
  to: number
  /** ELO band of the player's tier — defines what 100% of the ring means. */
  tierBand: { min: number; max: number }
  size?: number
  /** Delay before the tween starts (ms). */
  delay?: number
  /** Tween duration (ms). */
  duration?: number
  /** Fired once per integer step — wire to xp-tick sound. */
  onTick?: () => void
}

export function EloRing({
  from,
  to,
  tierBand,
  size = 180,
  delay = 300,
  duration = 1600,
  onTick,
}: EloRingProps) {
  const reduced = useReducedMotion()
  const [value, setValue] = useState(reduced ? to : from)
  const progress = (value - tierBand.min) / Math.max(1, tierBand.max - tierBand.min)
  const R = 45
  const CIRC = 2 * Math.PI * R
  const dashOffset = CIRC * (1 - Math.max(0, Math.min(1, progress)))

  useAnimationFrame((t) => {
    if (reduced) return
    const local = t - delay
    if (local < 0 || local > duration) return
    const k = local / duration
    // Cubic ease-out approx (1 - (1-k)^3).
    const e = 1 - Math.pow(1 - k, 3)
    const next = Math.round(from + (to - from) * e)
    if (next !== value) {
      setValue(next)
      onTick?.()
    }
  })

  const delta = to - from
  const tone = delta >= 0 ? 'text-success' : 'text-danger'
  const stroke = delta >= 0 ? 'rgb(var(--color-success))' : 'rgb(var(--color-danger))'

  return (
    <div className="relative" style={{ width: size, height: size }} aria-label={`ELO ${value}, изменение ${delta >= 0 ? '+' : ''}${delta}`}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgb(var(--color-surface-3))" strokeWidth="5" />
        <motion.circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke={stroke}
          strokeWidth="5"
          strokeLinecap="round"
          style={{ strokeDasharray: CIRC, strokeDashoffset: dashOffset }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-0.5">ELO</div>
          <div className="font-display text-[40px] font-extrabold leading-none tabular-nums">{value}</div>
          <div className={cn('font-mono text-[12px]', tone)}>
            {delta >= 0 ? '+' : ''}
            {delta}
          </div>
        </div>
      </div>
    </div>
  )
}
