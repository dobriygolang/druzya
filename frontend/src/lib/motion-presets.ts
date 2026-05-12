/**
 * Druz9 motion presets — Framer Motion variants matching the v2 visual-language spec.
 *
 * Use:
 *   const m = useMotion('modalIn')
 *   <motion.div {...m} />
 *
 * Tokens come from ./design-tokens (generated; do not hardcode durations/eases).
 * Reduced-motion: useMotion() returns no-op props automatically.
 *
 * Legacy presets in ./motion.ts stay for backwards compat. New code uses this file.
 */

import { useReducedMotion, type Easing, type MotionProps, type Variants } from 'framer-motion'

import { motion as motionTokens } from './design-tokens'

const ms = (n: number) => n / 1000

const easeStandard: Easing = [0.2, 0.7, 0.2, 1]
const easeEmphasized: Easing = [0.16, 1, 0.3, 1]
const easeDecelerate: Easing = [0, 0, 0.2, 1]
const easeAccelerate: Easing = [0.4, 0, 1, 1]

// Map token names → Framer easing arrays. Single source of truth.
const ease = {
  standard: easeStandard,
  emphasized: easeEmphasized,
  decelerate: easeDecelerate,
  accelerate: easeAccelerate,
} as const

// Convenience for components that want raw values.
export const motionTiming = {
  dur: motionTokens.dur,
  ease,
} as const

export const pageTransition: MotionProps = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: ms(motionTokens.dur.large), ease: easeEmphasized } },
  exit: { opacity: 0, y: -3, transition: { duration: ms(motionTokens.dur.medium), ease: easeAccelerate } },
}

export const modalIn: MotionProps = {
  initial: { opacity: 0, scale: 0.97, y: 8 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: ms(motionTokens.dur.large), ease: easeEmphasized, delay: ms(60) },
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    y: 8,
    transition: { duration: ms(motionTokens.dur.medium), ease: easeAccelerate },
  },
}

// Scrim is sibling to the modal card — fades faster than card opens.
export const modalScrim: MotionProps = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: ms(motionTokens.dur.medium), ease: easeStandard } },
  exit: { opacity: 0, transition: { duration: ms(motionTokens.dur.medium), ease: easeAccelerate } },
}

// 60ms stagger between children, capped via inline `delayChildren` + `staggerChildren`.
export const staggerContainer: Variants = {
  hidden: { opacity: 1 },
  show: {
    opacity: 1,
    transition: { staggerChildren: ms(60), delayChildren: ms(40) },
  },
}

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 4 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: ms(motionTokens.dur.medium), ease: easeEmphasized },
  },
}

export const hoverLift: MotionProps = {
  whileHover: { y: -1, transition: { duration: ms(motionTokens.dur.small), ease: easeStandard } },
  whileTap: { scale: 0.985, transition: { duration: ms(motionTokens.dur.micro), ease: easeStandard } },
}

export const successFlash: MotionProps = {
  initial: { opacity: 0, scale: 0.6 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { duration: ms(motionTokens.dur.large), ease: easeEmphasized },
  },
}

export const drawerInRight: MotionProps = {
  initial: { x: '100%' },
  animate: { x: 0, transition: { duration: ms(motionTokens.dur.large), ease: easeEmphasized } },
  exit: { x: '100%', transition: { duration: ms(motionTokens.dur.medium), ease: easeAccelerate } },
}

export const drawerInLeft: MotionProps = {
  initial: { x: '-100%' },
  animate: { x: 0, transition: { duration: ms(motionTokens.dur.large), ease: easeEmphasized } },
  exit: { x: '-100%', transition: { duration: ms(motionTokens.dur.medium), ease: easeAccelerate } },
}

export const drawerInBottom: MotionProps = {
  initial: { y: '100%' },
  animate: { y: 0, transition: { duration: ms(motionTokens.dur.large), ease: easeEmphasized } },
  exit: { y: '100%', transition: { duration: ms(motionTokens.dur.medium), ease: easeAccelerate } },
}

const presets = {
  pageTransition,
  modalIn,
  modalScrim,
  staggerContainer,
  staggerItem,
  hoverLift,
  successFlash,
  drawerInRight,
  drawerInLeft,
  drawerInBottom,
} as const

export type PresetName = keyof typeof presets

const REDUCED_MOTION_NOOP: MotionProps = {
  initial: false,
  animate: undefined,
  exit: undefined,
  whileHover: undefined,
  whileTap: undefined,
  transition: { duration: 0 },
}

/**
 * Returns one of the named motion presets, with prefers-reduced-motion applied.
 *
 * For MotionProps presets: returns no-op props (no transforms, instant transitions).
 * For Variants presets: returns the original — Framer Motion respects reduced-motion
 *   on Variants automatically when `<MotionConfig reducedMotion="user" />` is set,
 *   or you can wrap with useReducedMotion checks inside the consumer.
 */
export function useMotion<K extends PresetName>(name: K): (typeof presets)[K] {
  const reduce = useReducedMotion()
  if (!reduce) return presets[name]
  const preset = presets[name]
  // Variants are plain objects without `initial`/`animate` top-level keys — pass through.
  if (typeof preset === 'object' && 'hidden' in (preset as object)) {
    return preset
  }
  return REDUCED_MOTION_NOOP as (typeof presets)[K]
}
