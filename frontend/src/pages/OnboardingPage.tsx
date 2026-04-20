import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AppShell } from '../components/AppShell'
import {
  Panel,
  PanelHead,
  PageHeader,
  Button,
  InsetGroove,
  Bar,
} from '../components/chrome'

type CharClass = 'alg' | 'dba' | 'back' | 'arch' | 'comm' | 'ai'
type CareerStage = 'junior' | 'middle' | 'senior' | 'staff'
type Goal = 'faang' | 'ru_top' | 'relocate' | 'promotion'

type OnboardingState = {
  charClass: CharClass | null
  stage: CareerStage | null
  goals: Goal[]
  warmupDone: boolean
  step: number
}

const LS_KEY = 'druz9.onboarding'

/**
 * Class sigils — geometric SVG marks, one per class, matching bible §3.1.
 * Rendered as 40×40 glyphs inside the class tiles. Each sigil uses
 * a distinctive domain-colored stroke: algo=blue, dba=green, back=gold,
 * arch=purple, comm=teal, ai=crimson.
 */
type ClassMeta = {
  key: CharClass
  ru: string
  en: string
  tagline: string
  color: string
  sigil: JSX.Element
}

const CLASSES: ClassMeta[] = [
  {
    key: 'alg',
    ru: 'Алгоритмист',
    en: 'Algorithmist',
    tagline: 'Граф. Мета. O(n).',
    color: 'var(--sec-algo-accent)',
    sigil: (
      <>
        <polygon
          points="20,3 37,34 3,34"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <circle cx="20" cy="22" r="4" fill="currentColor" opacity="0.9" />
        <circle cx="20" cy="22" r="1.5" fill="var(--bg-void)" />
      </>
    ),
  },
  {
    key: 'dba',
    ru: 'Жрец DBA',
    en: 'DBA Priest',
    tagline: 'ACID. Indexes. Joins.',
    color: 'var(--sec-sql-accent)',
    sigil: (
      <>
        <ellipse
          cx="20"
          cy="8"
          rx="13"
          ry="4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M7 8 V30 Q20 36 33 30 V8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M7 18 Q20 23 33 18 M7 26 Q20 31 33 26"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.5"
        />
      </>
    ),
  },
  {
    key: 'back',
    ru: 'Бэкенд-воин',
    en: 'Backend Warrior',
    tagline: 'Queues. Gateways. Retries.',
    color: 'var(--gold)',
    sigil: (
      <>
        <path
          d="M20 3 L32 10 L32 24 L20 34 L8 24 L8 10 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M20 10 L26 14 L26 22 L20 28 L14 22 L14 14 Z"
          fill="currentColor"
          opacity="0.85"
        />
      </>
    ),
  },
  {
    key: 'arch',
    ru: 'Архитектор',
    en: 'Architect',
    tagline: 'Systems. Trade-offs. HLD.',
    color: 'var(--sec-sd-accent)',
    sigil: (
      <>
        <rect
          x="4"
          y="26"
          width="8"
          height="10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <rect
          x="16"
          y="18"
          width="8"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <rect
          x="28"
          y="10"
          width="8"
          height="26"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M8 4 L32 4 L32 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.5"
        />
      </>
    ),
  },
  {
    key: 'comm',
    ru: 'Беhav-маг',
    en: 'Behavioral Mage',
    tagline: 'STAR. Conflict. Lead.',
    color: 'var(--sec-beh-accent)',
    sigil: (
      <>
        <circle
          cx="20"
          cy="20"
          r="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M20 5 L24 18 L37 20 L24 22 L20 35 L16 22 L3 20 L16 18 Z"
          fill="currentColor"
          opacity="0.7"
        />
      </>
    ),
  },
  {
    key: 'ai',
    ru: 'AI-апостат',
    en: 'AI Apostate',
    tagline: 'Prompt. Provenance. Guard.',
    color: 'var(--blood-lit)',
    sigil: (
      <>
        <path
          d="M20 4 L36 20 L20 36 L4 20 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <circle cx="20" cy="20" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="20" cy="20" r="2" fill="currentColor" />
        <path
          d="M20 4 L20 36 M4 20 L36 20"
          stroke="currentColor"
          strokeWidth="0.6"
          opacity="0.45"
        />
      </>
    ),
  },
]

const STAGES: { key: CareerStage; ru: string }[] = [
  { key: 'junior', ru: 'Junior' },
  { key: 'middle', ru: 'Middle' },
  { key: 'senior', ru: 'Senior' },
  { key: 'staff', ru: 'Staff+' },
]

const GOALS: { key: Goal; ru: string }[] = [
  { key: 'faang', ru: 'FAANG / BigTech' },
  { key: 'ru_top', ru: 'Yandex · Ozon · Avito · VK' },
  { key: 'relocate', ru: 'Релокация' },
  { key: 'promotion', ru: 'Внутренний гроу' },
]

export default function OnboardingPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [state, setState] = useState<OnboardingState>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) return JSON.parse(raw) as OnboardingState
    } catch {
      // ignore
    }
    return {
      charClass: null,
      stage: null,
      goals: [],
      warmupDone: false,
      step: 0,
    }
  })

  const persist = (next: OnboardingState) => {
    setState(next)
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next))
    } catch {
      // STUB: localStorage could be disabled — silent for now
    }
  }

  const steps = [
    t('onboarding.step1_title'),
    t('onboarding.step2_title'),
    t('onboarding.step3_title'),
    t('onboarding.step4_title'),
    t('onboarding.step5_title'),
  ]
  const progress = ((state.step + 1) / steps.length) * 100

  return (
    <AppShell sidebars={false}>
      <div style={{ padding: 20, maxWidth: 780, margin: '0 auto' }}>
        <PageHeader
          title={t('onboarding.title')}
          subtitle={`${t('onboarding.step').toUpperCase()} ${state.step + 1} / ${steps.length}`}
        />
        <div style={{ marginBottom: 20 }}>
          <Bar value={progress} max={100} tone="ember" tall />
        </div>

        <Panel>
          <PanelHead subtitle={`STEP ${state.step + 1}`}>
            {steps[state.step]}
          </PanelHead>
          <div style={{ padding: 24 }}>
            {state.step === 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 10,
                }}
              >
                {CLASSES.map((c) => {
                  const active = state.charClass === c.key
                  return (
                    <button
                      key={c.key}
                      className="card tile-button"
                      onClick={() => persist({ ...state, charClass: c.key })}
                      style={{
                        textAlign: 'left',
                        padding: 14,
                        display: 'flex',
                        gap: 12,
                        alignItems: 'flex-start',
                        background: active
                          ? 'rgba(200,169,110,0.08)'
                          : 'var(--bg-inset)',
                        border: `1px solid ${
                          active ? 'var(--gold)' : 'var(--gold-dim)'
                        }`,
                        boxShadow: active
                          ? '0 0 10px rgba(200,169,110,0.15) inset'
                          : 'none',
                        transition:
                          'border-color 160ms, background 160ms, box-shadow 160ms',
                      }}
                    >
                      <svg
                        width={40}
                        height={40}
                        viewBox="0 0 40 40"
                        style={{
                          color: active ? c.color : 'var(--gold-dim)',
                          flexShrink: 0,
                          filter: active
                            ? `drop-shadow(0 0 6px ${c.color})`
                            : 'none',
                          transition: 'color 160ms, filter 160ms',
                        }}
                        aria-hidden
                      >
                        {c.sigil}
                      </svg>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          className="heraldic"
                          style={{
                            color: active
                              ? 'var(--gold-bright)'
                              : 'var(--text-bright)',
                            fontSize: 13,
                          }}
                        >
                          {c.ru}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: 'var(--text-mid)',
                            marginTop: 4,
                          }}
                        >
                          {c.en}
                        </div>
                        <div
                          className="mono"
                          style={{
                            fontSize: 10,
                            color: active
                              ? c.color
                              : 'var(--text-dim)',
                            marginTop: 6,
                          }}
                        >
                          {c.tagline}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {state.step === 1 && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {STAGES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => persist({ ...state, stage: s.key })}
                    className={`btn ${state.stage === s.key ? 'btn-primary' : ''}`}
                  >
                    {s.ru}
                  </button>
                ))}
              </div>
            )}

            {state.step === 2 && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {GOALS.map((g) => {
                  const active = state.goals.includes(g.key)
                  return (
                    <button
                      key={g.key}
                      className="card"
                      onClick={() => {
                        const goals = active
                          ? state.goals.filter((x) => x !== g.key)
                          : [...state.goals, g.key]
                        persist({ ...state, goals })
                      }}
                      style={{
                        textAlign: 'left',
                        padding: 12,
                        background: active
                          ? 'rgba(200,169,110,0.08)'
                          : 'var(--bg-inset)',
                        border: `1px solid ${active ? 'var(--gold)' : 'var(--gold-dim)'}`,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--font-display)',
                          letterSpacing: '0.12em',
                          color: active ? 'var(--gold-bright)' : 'var(--text-bright)',
                        }}
                      >
                        {g.ru}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {state.step === 3 && (
              <InsetGroove>
                <div style={{ fontSize: 13, marginBottom: 10 }}>
                  Мини-разминка: ответь на одно простое задание, чтобы
                  пройти посвящение.
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 12,
                    color: 'var(--ember-lit)',
                    marginBottom: 10,
                  }}
                >
                  {/* STUB: real kata content will come from /daily/kata on a future iteration */}
                  Что выведет: {`console.log(typeof NaN)`} ?
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['"number"', '"NaN"', '"undefined"'].map((opt) => (
                    <Button
                      key={opt}
                      size="sm"
                      tone={
                        state.warmupDone && opt === '"number"'
                          ? 'primary'
                          : 'default'
                      }
                      onClick={() =>
                        persist({
                          ...state,
                          warmupDone: opt === '"number"',
                        })
                      }
                    >
                      {opt}
                    </Button>
                  ))}
                </div>
                {state.warmupDone && (
                  <div
                    style={{
                      marginTop: 10,
                      color: 'var(--tier-normal)',
                      fontFamily: 'var(--font-display)',
                    }}
                  >
                    Готово. Можешь продолжать.
                  </div>
                )}
              </InsetGroove>
            )}

            {state.step === 4 && (
              <InsetGroove>
                <div
                  className="heraldic"
                  style={{ color: 'var(--gold-bright)', fontSize: 16 }}
                >
                  Готов войти в Святилище
                </div>
                <div
                  style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 6 }}
                >
                  Класс: {state.charClass ?? '—'} · уровень: {state.stage ?? '—'} ·
                  {' '}
                  цели: {state.goals.join(', ') || '—'} · разминка:
                  {state.warmupDone ? ' пройдена' : ' не пройдена'}
                </div>
              </InsetGroove>
            )}

            <div
              style={{
                marginTop: 22,
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <Button
                tone="ghost"
                onClick={() =>
                  persist({
                    ...state,
                    step: Math.max(0, state.step - 1),
                  })
                }
                disabled={state.step === 0}
              >
                {t('onboarding.prev')}
              </Button>
              {state.step < steps.length - 1 ? (
                <Button
                  tone="primary"
                  onClick={() =>
                    persist({
                      ...state,
                      step: Math.min(steps.length - 1, state.step + 1),
                    })
                  }
                >
                  {t('onboarding.next')}
                </Button>
              ) : (
                <Button
                  tone="blood"
                  onClick={() => {
                    try {
                      localStorage.setItem(
                        LS_KEY,
                        JSON.stringify({ ...state, completed: true }),
                      )
                    } catch {
                      // ignore
                    }
                    navigate('/sanctum')
                  }}
                >
                  {t('onboarding.finish')}
                </Button>
              )}
            </div>
          </div>
        </Panel>
      </div>
    </AppShell>
  )
}
