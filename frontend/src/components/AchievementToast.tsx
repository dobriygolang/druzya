// AchievementToast — single revealed achievement card with spring-out
// scale (Wave-10, design-review v4 shared component #1).
//
// Reusable beyond match-end: Sanctum daily-kata completion, /weekly
// share, /atlas mastery — anywhere a single achievement reveal is
// the "moment". Cascade renders multiple staggered.
//
// Color tone is semantic: rare = warn-pink, epic = pink-accent,
// streak = cyan-accent, tier = warn-accent (gold-ish), common = grey.

import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export type AchievementRarity = 'common' | 'rare' | 'epic' | 'streak' | 'tier'

const TONES: Record<AchievementRarity, { border: string; grad: string; label: string }> = {
  common: { border: 'border-border', grad: 'from-text-muted to-text-secondary', label: 'text-text-muted' },
  rare: { border: 'border-warn/40', grad: 'from-warn to-pink', label: 'text-warn' },
  epic: { border: 'border-pink/40', grad: 'from-pink to-accent', label: 'text-pink' },
  streak: { border: 'border-cyan/40', grad: 'from-cyan to-accent', label: 'text-cyan' },
  tier: { border: 'border-warn/40', grad: 'from-warn to-accent', label: 'text-warn' },
}

export type AchievementToastProps = {
  rarity: AchievementRarity
  title: string
  body: string
  icon: ReactNode
  /** Reveal delay in ms — used by AchievementCascade to stagger. */
  delay?: number
}

export function AchievementToast({ rarity, title, body, icon, delay = 0 }: AchievementToastProps) {
  const t = TONES[rarity]
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: [0.6, 1.08, 1] }}
      // Spring overshoot then settle — feels like an "unlock chime" without sound.
      transition={{ delay: delay / 1000, duration: 0.55, times: [0, 0.7, 1], ease: [0.34, 1.56, 0.64, 1] }}
      className={cn('rounded-xl border bg-surface-1 p-4', t.border)}
      role="status"
      aria-label={`Ачивка · ${title}`}
    >
      <div className="flex items-center gap-3">
        <div className={cn('grid h-10 w-10 place-items-center rounded-lg bg-gradient-to-br shadow-card text-white', t.grad)}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className={cn('font-mono text-[9px] uppercase tracking-wider', t.label)}>{rarity}</div>
          <div className="font-display text-sm font-bold truncate">{title}</div>
          <div className="text-[11px] text-text-muted truncate">{body}</div>
        </div>
      </div>
    </motion.div>
  )
}

export type AchievementCascadeProps = {
  items: Omit<AchievementToastProps, 'delay'>[]
  /** Delay before the first toast appears (ms). */
  startDelay?: number
  /** Per-toast offset (ms). Default 400 = 2.5 cards/second. */
  stagger?: number
}

export function AchievementCascade({ items, startDelay = 0, stagger = 400 }: AchievementCascadeProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {items.map((a, i) => (
        <AchievementToast key={i} {...a} delay={startDelay + i * stagger} />
      ))}
    </div>
  )
}
