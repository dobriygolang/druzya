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

const CLASSES: { key: CharClass; ru: string; en: string }[] = [
  { key: 'alg', ru: 'Алгоритмист', en: 'Algorithmist' },
  { key: 'dba', ru: 'Жрец DBA', en: 'DBA Priest' },
  { key: 'back', ru: 'Бэкенд-воин', en: 'Backend Warrior' },
  { key: 'arch', ru: 'Архитектор', en: 'Architect' },
  { key: 'comm', ru: 'Беhav-маг', en: 'Behavioral Mage' },
  { key: 'ai', ru: 'AI-апостат', en: 'AI Apostate' },
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
                {CLASSES.map((c) => (
                  <button
                    key={c.key}
                    className="card"
                    onClick={() => persist({ ...state, charClass: c.key })}
                    style={{
                      textAlign: 'left',
                      padding: 14,
                      background:
                        state.charClass === c.key
                          ? 'rgba(200,169,110,0.08)'
                          : 'var(--bg-inset)',
                      border: `1px solid ${
                        state.charClass === c.key ? 'var(--gold)' : 'var(--gold-dim)'
                      }`,
                    }}
                  >
                    <div
                      className="heraldic"
                      style={{ color: 'var(--gold-bright)', fontSize: 13 }}
                    >
                      {c.ru}
                    </div>
                    <div
                      style={{ fontSize: 10, color: 'var(--text-mid)', marginTop: 4 }}
                    >
                      {c.en}
                    </div>
                  </button>
                ))}
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
