// Onboarding Step 1 — Welcome gate (Wave-10, design-review v3 A.1/A.5).
// Single value-prop H1 + 3 mini-cards (atlas / arena / coach).
// Skip-route: «Не сейчас» → /sanctum?onboarding=deferred (lets the user
// in without completing; we'll re-prompt on next /sanctum visit).

import { useNavigate } from 'react-router-dom'
import { OnboardingLayout } from './_shared/Layout'
import { useOnboarding } from './_shared/useOnboarding'

const VALUE_PROPS = [
  { kicker: 'atlas', title: 'карта скиллов' },
  { kicker: 'arena', title: 'дуэли 1:1' },
  { kicker: 'coach', title: 'AI-ревью' },
] as const

export default function Step1Welcome() {
  const nav = useNavigate()
  const { setStep } = useOnboarding()

  const next = () => {
    setStep(2)
    nav('/onboarding/class')
  }
  const defer = () => nav('/sanctum?onboarding=deferred')

  return (
    <OnboardingLayout step={1}>
      <div className="max-w-[640px] mx-auto text-center pt-8">
        <div className="font-mono text-[11px] uppercase tracking-wider text-text-muted mb-3">
          onboarding · 1 из 5
        </div>
        <h1 className="font-display text-3xl lg:text-[40px] font-bold leading-[1.05] mb-4">
          <span className="bg-gradient-to-r from-accent to-cyan bg-clip-text text-transparent">druz9</span>
          {' — инструмент готовиться к собесам Big-Tech'}
        </h1>
        <p className="text-text-secondary text-[15px] leading-relaxed max-w-[520px] mx-auto mb-8">
          Прокачка скиллов через дуэли, daily kata, AI-коуч. Живой ELO, реальные вопросы, карта прогресса.
        </p>
        <div className="grid grid-cols-3 gap-3 mb-10">
          {VALUE_PROPS.map((v) => (
            <div key={v.kicker} className="rounded-lg border border-border bg-surface-1 p-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-1">{v.kicker}</div>
              <div className="font-display text-sm font-bold">{v.title}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={next}
            className="rounded-md bg-accent hover:bg-accent/90 text-white font-semibold text-sm px-5 py-2.5"
          >
            Начать →
          </button>
          <button
            type="button"
            onClick={defer}
            className="rounded-md border border-border bg-surface-1 text-text-secondary font-medium text-sm px-4 py-2.5 hover:bg-surface-2"
          >
            Не сейчас
          </button>
        </div>
      </div>
    </OnboardingLayout>
  )
}
