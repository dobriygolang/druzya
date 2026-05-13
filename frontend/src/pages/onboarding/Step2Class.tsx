// Onboarding Step 2 — pick focus class (Wave-10, design-review v3 A.1/A.5).
//
// 5 cards, single-select. The chosen class becomes the centre of the
// Atlas. The mutation tolerates backend 404 (endpoint may not be
// deployed yet); on success, profile cache is invalidated so /sanctum
// reflects the new focus class.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { OnboardingLayout } from './_shared/Layout'
import { useOnboarding, type FocusClass } from './_shared/useOnboarding'

const CLASSES: {
  id: FocusClass
  title: string
  skills: string
  hours: string
  typical: string
}[] = [
  { id: 'algo', title: 'Алгоритмы', skills: 'two pointers · sliding window · binary search · graphs', hours: '40–80 ч', typical: 'Яндекс, Meta' },
  { id: 'backend', title: 'Бекенд', skills: 'http · caching · db · queues · api design', hours: '30–60 ч', typical: 'Авито, Ozon' },
  { id: 'system', title: 'System Design', skills: 'scalability · cap · sharding · load balancer', hours: '50–100 ч', typical: 'Meta, Google' },
  { id: 'concurrency', title: 'Concurrency', skills: 'locks · channels · async · race conditions', hours: '40–80 ч', typical: 'Go, Rust ролы' },
  { id: 'ds', title: 'Data Science', skills: 'sql · ab test · probability · ml basics', hours: '30–60 ч', typical: 'Яндекс, Tinkoff' },
]

const captionMono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
}

export default function Step2Class() {
  const nav = useNavigate()
  const { setStep, setFocusClass } = useOnboarding()
  const [picked, setPicked] = useState<FocusClass>('algo')

  const next = async () => {
    await setFocusClass.mutateAsync(picked)
    setStep(3)
    nav('/onboarding/skill')
  }

  return (
    <OnboardingLayout step={2} onBack={() => nav('/onboarding/welcome')}>
      <div className="text-center" style={{ marginBottom: 28 }}>
        <div style={{ ...captionMono, marginBottom: 10 }}>шаг 2 · focus-class</div>
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
          Что ты готовишь к собесам?
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-60)', lineHeight: 1.55 }}>
          Один класс станет центром твоего Atlas. Можно поменять позже.
        </p>
      </div>

      <div
        className="auto-fit-grid"
        style={{ ['--auto-fit-min' as string]: '180px', ['--gap' as string]: '10px', marginBottom: 28 }}
      >
        {CLASSES.map((c) => {
          const selected = picked === c.id
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setPicked(c.id)}
              aria-pressed={selected}
              className="focus-ring motion-press"
              style={{
                position: 'relative',
                textAlign: 'left',
                padding: '14px 16px',
                background: selected ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
                border: selected ? '1.5px solid rgb(var(--ink))' : '1px solid var(--hair-2)',
                borderRadius: 'var(--radius-outer)',
                cursor: 'pointer',
                color: 'rgb(var(--ink))',
                transition:
                  'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
              }}
            >
              {selected && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: 14,
                    right: 14,
                    width: 24,
                    height: 1.5,
                    background: 'var(--red)',
                  }}
                />
              )}
              <div style={{ ...captionMono, marginBottom: 10, color: selected ? 'rgb(var(--ink))' : 'var(--ink-40)' }}>{c.id}</div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  letterSpacing: '-0.005em',
                  marginBottom: 8,
                  color: 'rgb(var(--ink))',
                }}
              >
                {c.title}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-40)', lineHeight: 1.5, marginBottom: 12 }}>{c.skills}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: 'var(--ink-40)' }}>подготовка</span>
                  <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: 'var(--ink-60)' }}>{c.hours}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: 'var(--ink-40)' }}>типичный</span>
                  <span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", color: 'var(--ink-60)' }}>{c.typical}</span>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex-wrap-row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--ink-60)' }}>
          выбрано:{' '}
          <strong style={{ color: 'rgb(var(--ink))', fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontWeight: 600 }}>
            {picked}
          </strong>{' '}
          · 3 core-скилла в следующем шаге
        </div>
        <button
          type="button"
          onClick={next}
          disabled={setFocusClass.isPending}
          className="focus-ring motion-press"
          style={{
            padding: '10px 22px',
            background: 'rgb(var(--ink))',
            color: 'rgb(var(--color-bg))',
            border: 0,
            borderRadius: 'var(--radius-inner)',
            fontSize: 14,
            fontWeight: 500,
            cursor: setFocusClass.isPending ? 'progress' : 'pointer',
            opacity: setFocusClass.isPending ? 0.6 : 1,
            transition:
              'background-color var(--motion-dur-small) var(--motion-ease-standard), opacity var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
          }}
        >
          Далее →
        </button>
      </div>
    </OnboardingLayout>
  )
}
