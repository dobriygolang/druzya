// Onboarding Step 3 — pick first core skill (Wave-10, design-review v3 A.5).
//
// Skip-able. If user clicks «подберите сами», we auto-select the middle
// skill so Atlas isn't empty when they arrive. The picked skill becomes
// the user's first allocated atlas node — the "starting point of gravity".
//
// 2026-05-12: v2 visual language — hairline cards, selection = white
// border + red signal stripe in corner, type tokens, motion-press.

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { OnboardingLayout } from './_shared/Layout'
import { readFocusClass, useOnboarding, type FocusClass } from './_shared/useOnboarding'

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

const captionMono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
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
    <OnboardingLayout step={3} onBack={() => nav('/onboarding/class')} onSkip={autopick} skipLabel="подберите сами">
      <div className="text-center" style={{ marginBottom: 28 }}>
        <div style={{ ...captionMono, marginBottom: 10 }}>шаг 3 · первая нода atlas</div>
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
          С чего начнём качать <span style={{ color: 'rgb(var(--ink))' }}>{block.label}</span>?
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-60)', lineHeight: 1.55 }}>
          Выбери одну core-ноду. Она станет активной точкой на Atlas.
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
                <span>≈{s.hours} ч.</span>
                <span>{s.tasks} задач</span>
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
          Выбрать и далее →
        </button>
      </div>
    </OnboardingLayout>
  )
}
