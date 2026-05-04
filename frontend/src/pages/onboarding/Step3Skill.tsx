// Onboarding Step 3 — pick first core skill (Wave-10, design-review v3 A.5).
//
// Skip-able. If user clicks «подберите сами», we auto-select the middle
// skill so Atlas isn't empty when they arrive. The picked skill becomes
// the user's first allocated atlas node — the "starting point of gravity".

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { OnboardingLayout } from './_shared/Layout'
import { readFocusClass, useOnboarding, type FocusClass } from './_shared/useOnboarding'
import { cn } from '../../lib/cn'

type CoreSkill = { id: string; title: string; blurb: string; hours: number; tasks: number }

// Hard-coded per focus-class until GET /atlas/core lands. Each block has
// 3 entry-level core nodes that map onto real atlas_nodes ids the
// allocator can claim. Keep title/blurb in Russian to match the rest of
// the onboarding copy.
const CORE_SKILLS_BY_CLASS: Record<FocusClass, { label: string; skills: CoreSkill[] }> = {
  algo: {
    label: 'Алгоритмы',
    skills: [
      { id: 'two-pointers', title: 'Two pointers', blurb: 'Самый простой способ почувствовать массив. 80% sliding-window задач после.', hours: 4, tasks: 12 },
      { id: 'sliding-window', title: 'Sliding window', blurb: 'Базовый паттерн для подстрок и подмассивов с динамическими границами.', hours: 6, tasks: 14 },
      { id: 'binary-search', title: 'Binary search', blurb: 'Не только в массивах — в ответах, на функциях, в boundary-задачах.', hours: 5, tasks: 10 },
    ],
  },
  backend: {
    label: 'Бекенд',
    skills: [
      { id: 'http-deep', title: 'HTTP deep', blurb: 'Statuses, headers, idempotency, redirects, caching — то, что собес-инженер должен бросить с любой стороны.', hours: 5, tasks: 12 },
      { id: 'caching-strategies', title: 'Cache strategies', blurb: 'read-through / write-back / write-around — где какая стратегия и чем платишь за выбор.', hours: 6, tasks: 10 },
      { id: 'api-design', title: 'API design', blurb: 'Версионирование, contract evolution, REST vs gRPC trade-offs.', hours: 5, tasks: 12 },
    ],
  },
  system: {
    label: 'System Design',
    skills: [
      { id: 'cap-theorem', title: 'CAP & consistency', blurb: 'Консистентность ↔ доступность под partition. Почему single-master не магия.', hours: 6, tasks: 10 },
      { id: 'load-balancing', title: 'Load balancing', blurb: 'L4 vs L7, sticky sessions, health-checks, hashing strategies.', hours: 5, tasks: 12 },
      { id: 'sharding', title: 'Sharding & partitioning', blurb: 'Range / hash / directory — когда какое и как мигрировать.', hours: 7, tasks: 14 },
    ],
  },
  concurrency: {
    label: 'Concurrency',
    skills: [
      { id: 'locks-mutex', title: 'Locks & mutex', blurb: 'Mutex vs RWLock, deadlock, lock ordering, lock-free hints.', hours: 5, tasks: 12 },
      { id: 'channels-csp', title: 'Channels / CSP', blurb: 'Go-style: share by communicating, fan-in/fan-out, cancellation.', hours: 6, tasks: 14 },
      { id: 'race-conditions', title: 'Race conditions', blurb: 'race detector, memory barriers, happens-before — чтобы не врать на собесе.', hours: 5, tasks: 10 },
    ],
  },
  ds: {
    label: 'Data Science',
    skills: [
      { id: 'sql-windows', title: 'SQL window functions', blurb: 'ROW_NUMBER / LAG / LEAD / partitioned aggregates — must для аналитика.', hours: 5, tasks: 12 },
      { id: 'ab-testing', title: 'A/B testing', blurb: 'CUPED, SRM, multiple comparisons — что спросят на product analyst.', hours: 6, tasks: 10 },
      { id: 'probability', title: 'Probability basics', blurb: 'Bayes, conditional, expectation — гигиена для DS-собесов.', hours: 5, tasks: 12 },
    ],
  },
}

export default function Step3Skill() {
  const nav = useNavigate()
  const { setStep, allocateFirstSkill } = useOnboarding()
  const [picked, setPicked] = useState<string | null>(null)
  // Read class once on mount — Step 2 persists it to localStorage before
  // routing here, so a re-render can't lose it. Falls back to 'algo' if
  // user reached this URL directly without going through Step 2.
  const focusClass = useMemo(() => readFocusClass(), [])
  const block = CORE_SKILLS_BY_CLASS[focusClass]

  const go = async (skillId: string) => {
    await allocateFirstSkill.mutateAsync(skillId)
    setStep(4)
    nav('/onboarding/task')
  }

  // «подберите сами» = pick the middle option deterministically so the
  // Atlas isn't blank but we don't push a recommendation.
  const autopick = () => go(block.skills[Math.floor(block.skills.length / 2)].id)

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
          С чего начнём качать <span className="text-text-primary">{block.label}</span>?
        </h2>
        <p className="text-[13px] text-text-secondary">
          Выбери одну core-ноду. Она станет активной точкой на Atlas.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {block.skills.map((s) => {
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
