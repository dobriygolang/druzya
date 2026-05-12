// OnboardingLayout — chrome shared by every Step{1..5}.tsx
// (Wave-10, design-review v3 A.5).
//
// Composition:
//   - top header (logo + optional «← назад»)
//   - 5-dot stepper (hidden on Step 1, which is the welcome gate)
//   - main slot (the step's own content)
//   - bottom «пропустить →» when the step is skip-able
//
// Skip is opt-in per step via the onSkip prop; Steps 3 & 4 pass it,
// Steps 1, 2, 5 don't. Persistence (where in the flow we are) lives in
// useOnboarding — Layout is purely visual.
//
// 2026-05-12: applied v2 visual language — hairline header (no surface
// fill on logo box), caption-mono uppercase for back/skip, motion-tokens,
// focus-ring on focusables, density tokens for spacing. Page wrapped in
// staggerContainer for entry choreography.

import { type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { motion } from 'framer-motion'

import { cn } from '../../../lib/cn'
import { staggerContainer, staggerItem } from '../../../lib/motion-presets'

export type OnboardingLayoutProps = {
  step: 1 | 2 | 3 | 4 | 5
  total?: number
  onBack?: () => void
  onSkip?: () => void
  skipLabel?: string
  children: ReactNode
}

const captionMonoBtn: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-60)',
  background: 'transparent',
  border: 0,
  padding: '6px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  transition: 'color var(--motion-dur-small) var(--motion-ease-standard)',
}

export function OnboardingLayout({
  step,
  total = 5,
  onBack,
  onSkip,
  skipLabel,
  children,
}: OnboardingLayoutProps) {
  // Step 1 is the gate — no stepper dots (we don't want a "1/5"
  // pressure on first-touch; let the value-prop stand alone).
  const showStepper = step > 1

  return (
    <div className="min-h-screen text-text-primary" style={{ background: 'rgb(var(--color-bg))' }}>
      <header
        className="flex items-center justify-between px-6"
        style={{
          height: 64,
          borderBottom: '1px solid var(--hair)',
        }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="grid place-items-center"
            style={{
              width: 28,
              height: 28,
              border: '1px solid var(--hair-2)',
              borderRadius: 8,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontWeight: 600,
              fontSize: 14,
              color: 'rgb(var(--ink))',
            }}
          >
            9
          </span>
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '-0.005em',
              color: 'rgb(var(--ink))',
            }}
          >
            druz9
          </span>
        </div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="focus-ring"
            style={captionMonoBtn}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'rgb(var(--ink))')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-60)')}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> назад
          </button>
        )}
      </header>

      {showStepper && (
        <div
          className="flex items-center justify-center gap-1.5 pt-6"
          aria-label={`шаг ${step} из ${total}`}
          role="progressbar"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={total}
        >
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-[3px] w-10 rounded-full',
              )}
              style={{
                background: i < step ? 'rgb(var(--ink))' : 'var(--hair-2)',
                transition: 'background-color var(--motion-dur-medium) var(--motion-ease-emphasized)',
              }}
              aria-hidden="true"
            />
          ))}
        </div>
      )}

      <motion.main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-[900px] px-6 py-8 focus:outline-none"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={staggerItem}>{children}</motion.div>
      </motion.main>

      {onSkip && (
        <div className="text-center pb-8">
          <button
            type="button"
            onClick={onSkip}
            className="focus-ring"
            style={captionMonoBtn}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'rgb(var(--ink))')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-60)')}
          >
            {skipLabel ?? 'пропустить'} →
          </button>
        </div>
      )}
    </div>
  )
}
