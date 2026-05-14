// Onboarding Step 1 — Welcome gate.
// Single value-prop H1 + 3 mini-cards (mock / atlas / coach) — identity
// + AI-coach. Skip-route ведёт на /atlas (Atlas — основная карта).

import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { OnboardingLayout } from './_shared/Layout'
import { useOnboarding } from './_shared/useOnboarding'

export default function Step1Welcome() {
  const { t } = useTranslation('onboarding')
  const nav = useNavigate()
  const { setStep } = useOnboarding()
  const VALUE_PROPS = [
    { kicker: 'mock', title: t('step1_welcome.prop_mock') },
    { kicker: 'atlas', title: t('step1_welcome.prop_atlas') },
    { kicker: 'coach', title: t('step1_welcome.prop_coach') },
  ]

  const next = () => {
    setStep(2)
    nav('/onboarding/class')
  }
  const defer = () => nav('/atlas?onboarding=deferred')

  return (
    <OnboardingLayout step={1}>
      <div className="mx-auto text-center" style={{ maxWidth: 640, paddingTop: 32 }}>
        <div
          style={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--ink-40)',
            marginBottom: 14,
          }}
        >
          {t('step1_welcome.step_indicator')}
        </div>
        <h1
          style={{
            margin: 0,
            marginBottom: 16,
            fontSize: 'var(--type-h1-size)',
            lineHeight: 'var(--type-h1-lh)',
            letterSpacing: 'var(--type-h1-ls)',
            fontWeight: 'var(--type-h1-weight)',
            color: 'rgb(var(--ink))',
          }}
        >
          <span style={{ color: 'rgb(var(--ink))' }}>druz9</span>
          {t('step1_welcome.title_suffix')}
        </h1>
        <p
          className="mx-auto"
          style={{
            margin: '0 auto 32px',
            maxWidth: 540,
            fontSize: 'var(--type-body-size)',
            lineHeight: 'var(--type-body-lh)',
            color: 'var(--ink-60)',
          }}
        >
          {t('step1_welcome.body')}
        </p>
        <div
          className="auto-fit-grid"
          style={{
            ['--auto-fit-min' as string]: '160px',
            ['--gap' as string]: '10px',
            marginBottom: 40,
          }}
        >
          {VALUE_PROPS.map((v) => (
            <div
              key={v.kicker}
              style={{
                padding: '14px 16px',
                border: '1px solid var(--hair)',
                borderRadius: 'var(--radius-inner)',
                background: 'transparent',
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-40)',
                  marginBottom: 4,
                }}
              >
                {v.kicker}
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  letterSpacing: '-0.005em',
                  color: 'rgb(var(--ink))',
                }}
              >
                {v.title}
              </div>
            </div>
          ))}
        </div>
        <div className="flex-wrap-row" style={{ justifyContent: 'center', gap: 12 }}>
          <button type="button" onClick={next} className="focus-ring motion-press" style={primaryPill}>
            {t('step1_welcome.cta_start')}
          </button>
          <button type="button" onClick={defer} className="focus-ring motion-press" style={ghostPill}>
            {t('step1_welcome.cta_later')}
          </button>
        </div>
      </div>
    </OnboardingLayout>
  )
}

const primaryPill: React.CSSProperties = {
  padding: '10px 22px',
  background: 'rgb(var(--ink))',
  color: 'rgb(var(--color-bg))',
  border: 0,
  borderRadius: 'var(--radius-inner)',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  transition:
    'background-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
}

const ghostPill: React.CSSProperties = {
  padding: '10px 18px',
  background: 'transparent',
  color: 'var(--ink-60)',
  border: '1px solid var(--hair-2)',
  borderRadius: 'var(--radius-inner)',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  transition:
    'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
}
