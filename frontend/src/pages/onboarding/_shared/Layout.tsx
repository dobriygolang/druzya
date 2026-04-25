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

import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { cn } from '../../../lib/cn'

export type OnboardingLayoutProps = {
  step: 1 | 2 | 3 | 4 | 5
  total?: number
  onBack?: () => void
  onSkip?: () => void
  skipLabel?: string
  children: ReactNode
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
    <div className="min-h-screen bg-bg text-text-primary">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-surface-2 border border-border-strong font-display text-sm font-extrabold text-text-primary">
            9
          </span>
          <span className="font-display text-sm font-bold">druz9</span>
        </div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-text-muted hover:text-text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> назад
          </button>
        )}
      </header>

      {showStepper && (
        <div className="flex items-center justify-center gap-1.5 pt-6" aria-label={`шаг ${step} из ${total}`}>
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 w-8 rounded-full transition-colors',
                i < step ? 'bg-text-primary' : 'bg-surface-3',
              )}
              aria-hidden="true"
            />
          ))}
        </div>
      )}

      <main className="mx-auto max-w-[900px] px-6 py-8">{children}</main>

      {onSkip && (
        <div className="text-center pb-8">
          <button
            type="button"
            onClick={onSkip}
            className="font-mono text-[11px] uppercase tracking-wider text-text-muted hover:text-text-primary"
          >
            {skipLabel ?? 'пропустить'} →
          </button>
        </div>
      )}
    </div>
  )
}
