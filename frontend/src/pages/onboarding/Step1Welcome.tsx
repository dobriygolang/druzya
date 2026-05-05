// Onboarding Step 1 — Welcome gate.
// Single value-prop H1 + 3 mini-cards (mock / atlas / coach) — identity
// 2026-05-04: arena/duels/ELO выпилены, продукт = AI-mock + Skill Atlas
// + AI-coach. Skip-route ведёт на /atlas (Atlas — основная карта).

import { useNavigate } from 'react-router-dom'
import { OnboardingLayout } from './_shared/Layout'
import { useOnboarding } from './_shared/useOnboarding'

const VALUE_PROPS = [
  { kicker: 'mock', title: 'strict + AI-mode' },
  { kicker: 'atlas', title: 'карта скиллов' },
  { kicker: 'coach', title: 'AI с памятью' },
] as const

export default function Step1Welcome() {
  const nav = useNavigate()
  const { setStep } = useOnboarding()

  const next = () => {
    setStep(2)
    nav('/onboarding/class')
  }
  const defer = () => nav('/atlas?onboarding=deferred')

  return (
    <OnboardingLayout step={1}>
      <div className="max-w-[640px] mx-auto text-center pt-8">
        <div className="font-mono text-[11px] uppercase tracking-wider text-text-muted mb-3">
          onboarding · 1 из 5
        </div>
        <h1 className="font-display text-3xl lg:text-[40px] font-bold leading-[1.05] mb-4">
          <span className="text-text-primary">druz9</span>
          {' — подготовка к Senior IT-собесам'}
        </h1>
        <p className="text-text-secondary text-[15px] leading-relaxed max-w-[520px] mx-auto mb-8">
          Strict mock с watermark, AI-coach с памятью, карта прогресса. Для тех, у кого
          есть база и нужна объективная оценка готовности.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
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
            className="rounded-md bg-text-primary hover:bg-text-primary/90 text-bg font-medium text-sm px-5 py-2.5"
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
