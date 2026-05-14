// Onboarding Step 3 — pick first core skill (Wave-10, design-review v3 A.5).
//
// Skip-able. If user clicks «подберите сами», we auto-select the middle
// skill so Atlas isn't empty when they arrive. The picked skill becomes
// the user's first allocated atlas node — the "starting point of gravity".

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { OnboardingLayout } from './_shared/Layout'
import { readFocusClass, useOnboarding, type FocusClass } from './_shared/useOnboarding'

type CoreSkill = { id: string; title: string; blurb: string; hours: number; tasks: number }

// Per focus-class core skills. Titles + blurbs are pulled from the
// onboarding namespace so they translate alongside everything else.
type SkillSeed = { id: string; hours: number; tasks: number }
const CORE_SKILL_IDS: Record<FocusClass, SkillSeed[]> = {
  algo: [
    { id: 'two-pointers', hours: 4, tasks: 12 },
    { id: 'sliding-window', hours: 6, tasks: 14 },
    { id: 'binary-search', hours: 5, tasks: 10 },
  ],
  backend: [
    { id: 'http-deep', hours: 5, tasks: 12 },
    { id: 'caching-strategies', hours: 6, tasks: 10 },
    { id: 'api-design', hours: 5, tasks: 12 },
  ],
  system: [
    { id: 'cap-theorem', hours: 6, tasks: 10 },
    { id: 'load-balancing', hours: 5, tasks: 12 },
    { id: 'sharding', hours: 7, tasks: 14 },
  ],
  concurrency: [
    { id: 'locks-mutex', hours: 5, tasks: 12 },
    { id: 'channels-csp', hours: 6, tasks: 14 },
    { id: 'race-conditions', hours: 5, tasks: 10 },
  ],
  ds: [
    { id: 'sql-windows', hours: 5, tasks: 12 },
    { id: 'ab-testing', hours: 6, tasks: 10 },
    { id: 'probability', hours: 5, tasks: 12 },
  ],
}

function getSkillsForClass(
  cls: FocusClass,
  t: (key: string) => string,
): { label: string; skills: CoreSkill[] } {
  return {
    label: t(`onboarding:step3.class.${cls}`),
    skills: CORE_SKILL_IDS[cls].map((seed) => ({
      ...seed,
      title: t(`onboarding:step3.skill.${seed.id}.title`),
      blurb: t(`onboarding:step3.skill.${seed.id}.blurb`),
    })),
  }
}

const captionMono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
}

export default function Step3Skill() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { setStep, allocateFirstSkill } = useOnboarding()
  const [picked, setPicked] = useState<string | null>(null)
  // Read class once on mount — Step 2 persists it to localStorage before
  // routing here, so a re-render can't lose it. Falls back to 'algo' if
  // user reached this URL directly without going through Step 2.
  const focusClass = useMemo(() => readFocusClass(), [])
  const block = useMemo(() => getSkillsForClass(focusClass, t), [focusClass, t])

  const go = async (skillId: string) => {
    await allocateFirstSkill.mutateAsync(skillId)
    setStep(4)
    nav('/onboarding/task')
  }

  // «подберите сами» = pick the middle option deterministically so the
  // Atlas isn't blank but we don't push a recommendation.
  const autopick = () => go(block.skills[Math.floor(block.skills.length / 2)].id)

  return (
    <OnboardingLayout step={3} onBack={() => nav('/onboarding/class')} onSkip={autopick} skipLabel={t('onboarding:step3.skip_label')}>
      <div className="text-center" style={{ marginBottom: 28 }}>
        <div style={{ ...captionMono, marginBottom: 10 }}>{t('onboarding:step3.eyebrow')}</div>
        <h2
          style={{
            margin: 0,
            marginBottom: 8,
            fontSize: 'var(--type-h2-size)',
            lineHeight: 'var(--type-h2-lh)',
            letterSpacing: 'var(--type-h2-ls)',
            fontWeight: 'var(--type-h2-weight)',
            color: 'rgb(var(--ink))',
          }}
        >
          {t('onboarding:step3.title_prefix')}{' '}
          <span style={{ color: 'rgb(var(--ink))' }}>{block.label}</span>
          {t('onboarding:step3.title_suffix')}
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-60)', lineHeight: 1.55 }}>
          {t('onboarding:step3.subtitle_pick')}
        </p>
      </div>

      <div
        className="auto-fit-grid"
        style={{ ['--auto-fit-min' as string]: '240px', ['--gap' as string]: '10px', marginBottom: 24 }}
      >
        {block.skills.map((s) => {
          const sel = picked === s.id
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setPicked(s.id)}
              aria-pressed={sel}
              className="focus-ring motion-press"
              style={{
                position: 'relative',
                textAlign: 'left',
                padding: '14px 16px',
                background: sel ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
                border: sel ? '1.5px solid rgb(var(--ink))' : '1px solid var(--hair-2)',
                borderRadius: 'var(--radius-outer)',
                cursor: 'pointer',
                color: 'rgb(var(--ink))',
                transition:
                  'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
              }}
            >
              {sel && (
                <span
                  aria-hidden="true"
                  style={{ position: 'absolute', top: 14, right: 14, width: 24, height: 1.5, background: 'var(--red)' }}
                />
              )}
              <div style={{ ...captionMono, fontSize: 10, marginBottom: 6, color: sel ? 'rgb(var(--ink))' : 'var(--ink-40)' }}>
                core · entry
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  letterSpacing: '-0.005em',
                  marginBottom: 6,
                  color: 'rgb(var(--ink))',
                }}
              >
                {s.title}
              </div>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--ink-60)', lineHeight: 1.55, marginBottom: 10 }}>{s.blurb}</p>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 10,
                  color: 'var(--ink-40)',
                }}
              >
                <span>{t('onboarding:step3.hours_short', { n: s.hours })}</span>
                <span>{t('onboarding:step3.tasks_short', { n: s.tasks })}</span>
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => picked && go(picked)}
          disabled={!picked || allocateFirstSkill.isPending}
          className="focus-ring motion-press"
          style={{
            padding: '10px 22px',
            background: 'rgb(var(--ink))',
            color: 'rgb(var(--color-bg))',
            border: 0,
            borderRadius: 'var(--radius-inner)',
            fontSize: 14,
            fontWeight: 500,
            cursor: !picked || allocateFirstSkill.isPending ? 'not-allowed' : 'pointer',
            opacity: !picked || allocateFirstSkill.isPending ? 0.5 : 1,
            transition:
              'background-color var(--motion-dur-small) var(--motion-ease-standard), opacity var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
          }}
        >
          {t('onboarding:step3.cta_continue')}
        </button>
      </div>
    </OnboardingLayout>
  )
}
