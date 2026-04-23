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
import { cn } from '../../lib/cn'

const CLASSES: {
  id: FocusClass
  title: string
  skills: string
  elo: string
  typical: string
}[] = [
  { id: 'algo', title: 'Алгоритмы', skills: 'two pointers · sliding window · binary search · graphs', elo: '1200–2400', typical: 'Яндекс, Meta' },
  { id: 'backend', title: 'Бекенд', skills: 'http · caching · db · queues · api design', elo: '1000–2200', typical: 'Авито, Ozon' },
  { id: 'system', title: 'System Design', skills: 'scalability · cap · sharding · load balancer', elo: '1400–2600', typical: 'Meta, Google' },
  { id: 'concurrency', title: 'Concurrency', skills: 'locks · channels · async · race conditions', elo: '1200–2400', typical: 'Go, Rust ролы' },
  { id: 'ds', title: 'Data Science', skills: 'sql · ab test · probability · ml basics', elo: '1000–2200', typical: 'Яндекс, Tinkoff' },
]

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
      <div className="text-center mb-7">
        <div className="font-mono text-[11px] uppercase tracking-wider text-text-muted mb-2">шаг 2 · focus-class</div>
        <h2 className="font-display text-2xl font-bold mb-1.5">Что ты готовишь к собесам?</h2>
        <p className="text-[13px] text-text-secondary">Один класс станет центром твоего Atlas. Можно поменять позже.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-7">
        {CLASSES.map((c) => {
          const selected = picked === c.id
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setPicked(c.id)}
              aria-pressed={selected}
              className={cn(
                'text-left rounded-xl border p-4 transition-colors',
                selected
                  ? 'border-accent bg-accent/5 shadow-glow'
                  : 'border-border hover:border-border-strong',
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <span
                  className={cn(
                    'font-mono text-[10px] uppercase tracking-wider',
                    selected ? 'text-accent-hover' : 'text-text-muted',
                  )}
                >
                  {c.id}
                </span>
                {selected && (
                  <span className="grid h-4 w-4 place-items-center rounded-full bg-accent text-[10px] font-bold text-white">
                    ✓
                  </span>
                )}
              </div>
              <div className="font-display text-[15px] font-bold mb-2">{c.title}</div>
              <div className="text-[11px] text-text-muted leading-relaxed mb-3">{c.skills}</div>
              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-text-muted">ELO band</span>
                  <span className="font-mono text-text-secondary">{c.elo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">типичный</span>
                  <span className="font-mono text-text-secondary">{c.typical}</span>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="text-[12px] text-text-secondary">
          выбрано: <strong className="text-accent-hover font-mono">{picked}</strong> · 3 core-скилла в следующем шаге
        </div>
        <button
          type="button"
          onClick={next}
          disabled={setFocusClass.isPending}
          className="rounded-md bg-accent hover:bg-accent/90 text-white font-semibold text-sm px-5 py-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          Далее →
        </button>
      </div>
    </OnboardingLayout>
  )
}
