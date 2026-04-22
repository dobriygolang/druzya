import { useReducedMotion, type MotionProps } from 'framer-motion'

/**
 * Returns motion props that respect the user's reduced-motion preference.
 * When the user prefers reduced motion, animations are disabled (set to no-op).
 */
export function useMotionSafe<T extends MotionProps>(props: T): T {
  const reduced = useReducedMotion()
  if (!reduced) return props
  // Strip animation-related props when reduced motion is on.
  const safe: MotionProps = { ...props }
  safe.initial = false
  safe.animate = undefined
  safe.exit = undefined
  safe.whileHover = undefined
  safe.whileTap = undefined
  safe.transition = { duration: 0 }
  return safe as T
}

/** Stagger container variants for lists where each child fades + slides up. */
export const staggerContainer = {
  hidden: { opacity: 1 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
}

export const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' as const } },
}

export const pageTransition = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.25, ease: 'easeOut' as const },
}

export const interactiveHover = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.98 },
}

export const pulseAnim = {
  animate: { opacity: [1, 0.3, 1] },
  transition: { duration: 1.5, repeat: Infinity },
}
