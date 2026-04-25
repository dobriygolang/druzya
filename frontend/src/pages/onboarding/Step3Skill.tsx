// Onboarding Step 3 — pick first core skill (Wave-10, design-review v3 A.5).
//
// Skip-able. If user clicks «подберите сами», we auto-select the middle
// skill so Atlas isn't empty when they arrive. The picked skill becomes
// the user's first allocated atlas node — the "starting point of gravity".

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { OnboardingLayout } from './_shared/Layout'
import { useOnboarding } from './_shared/useOnboarding'
import { cn } from '../../lib/cn'

// Hard-coded for now — the production GET /atlas/core endpoint isn't
// shipped yet. Anti-fallback note: when the endpoint exists, switch to
// useQuery and render <EmptyState variant="loading" /> while fetching.
const CORE_SKILLS: { id: string; title: string; blurb: string; hours: number; tasks: number }[] = [
  {
    id: 'two-pointers',
    title: 'Two pointers',
    blurb: 'Самый простой способ почувствовать массив. 80% sliding-window задач после.',
    hours: 4,
    tasks: 12,
  },
  {
    id: 'sliding-window',
    title: 'Sliding window',
    blurb: 'Базовый паттерн для подстрок и подмассивов с динамическими границами.',
    hours: 6,
    tasks: 14,
  },
  {
    id: 'binary-search',
    title: 'Binary search',
    blurb: 'Не только в массивах — в ответах, на функциях, в boundary-задачах.',
    hours: 5,
    tasks: 10,
  },
]

export default function Step3Skill() {
  const nav = useNavigate()
  const { setStep, allocateFirstSkill } = useOnboarding()
  const [picked, setPicked] = useState<string | null>(null)

  const go = async (skillId: string) => {
    await allocateFirstSkill.mutateAsync(skillId)
    setStep(4)
    nav('/onboarding/task')
  }

  // «подберите сами» = pick the middle option deterministically so the
  // Atlas isn't blank but we don't push a recommendation.
  const autopick = () => go(CORE_SKILLS[Math.floor(CORE_SKILLS.length / 2)].id)

  return (
    <OnboardingLayout
      step={3}
      onBack={() => nav('/onboarding/class')}
      onSkip={autopick}
      skipLabel="подберите сами"
    >
      <div className="text-center mb-7">
        <div className="font-mono text-[11px] uppercase tracking-wider text-text-muted mb-2">
          шаг 3 · первая нода atlas
        </div>
        <h2 className="font-display text-2xl font-bold mb-1.5">
          С чего начнём качать <span className="text-text-primary">Алгоритмы</span>?
        </h2>
        <p className="text-[13px] text-text-secondary">
          Выбери одну core-ноду. Она станет активной точкой на Atlas.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {CORE_SKILLS.map((s) => {
          const sel = picked === s.id
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setPicked(s.id)}
              aria-pressed={sel}
              className={cn(
                'text-left rounded-lg border p-4 transition-colors',
                sel ? 'border-text-primary bg-text-primary/5' : 'border-border hover:border-border-strong',
              )}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className={cn(
                    'font-mono text-[10px] uppercase tracking-wider',
                    sel ? 'text-text-primary' : 'text-text-muted',
                  )}
                >
                  core · entry
                </span>
                {sel && (
                  <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-text-primary text-[8px] font-bold text-bg">
                    ✓
                  </span>
                )}
              </div>
              <div className="font-display text-sm font-bold mb-1">{s.title}</div>
              <p className="text-[11px] text-text-secondary leading-relaxed mb-2.5">{s.blurb}</p>
              <div className="flex items-center justify-between text-[10px] font-mono text-text-muted">
                <span>≈{s.hours} ч.</span>
                <span>{s.tasks} задач</span>
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => picked && go(picked)}
          disabled={!picked || allocateFirstSkill.isPending}
          className="rounded-md bg-text-primary hover:bg-text-primary/90 text-bg font-medium text-sm px-5 py-2.5 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          Выбрать и далее →
        </button>
      </div>
    </OnboardingLayout>
  )
}
