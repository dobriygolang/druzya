// Onboarding Step 4 — first task in sandbox mode (Wave-10, design-review v3 A.5).
//
// Sandbox = NO side-effects: no submission to match-history, no ELO
// delta, no streak update. The user just sees the arena layout and how
// problem/editor/sample-IO compose. Skip-able («потом попробую»).
//
// We deliberately don't wire a real CodeEditor here — that's a heavy
// dependency and onboarding shouldn't pay the cost. A textarea-shaped
// preview (read-only) communicates the layout. The user lands on the
// real arena via Step 5's tour.

import { useNavigate } from 'react-router-dom'
import { OnboardingLayout } from './_shared/Layout'
import { useOnboarding } from './_shared/useOnboarding'

const SANDBOX_PROBLEM = {
  title: 'Longest substring without repeat',
  tag: 'sliding window · entry',
  body: 'Дана строка s. Найди длину самой длинной подстроки без повторов символов.',
  sample: { input: '"abcabcbb"', output: '3' },
}

export default function Step4Task() {
  const nav = useNavigate()
  const { setStep } = useOnboarding()

  const runAndGo = () => {
    // Sandbox: NO POST to match-history, NO ELO update.
    setStep(5)
    nav('/sanctum?tour=1')
  }
  const skip = () => {
    setStep(5)
    nav('/sanctum?tour=1&skipped=task')
  }

  return (
    <OnboardingLayout
      step={4}
      onBack={() => nav('/onboarding/skill')}
      onSkip={skip}
      skipLabel="потом попробую"
    >
      <div className="text-center mb-5">
        <div className="font-mono text-[11px] uppercase tracking-wider text-text-muted mb-2">
          шаг 4 · как выглядит арена
        </div>
        <h2 className="font-display text-2xl font-bold mb-1.5">Первая задача — без счёта</h2>
        <p className="text-[13px] text-text-secondary">Sandbox. Таймер остановлен, ELO не изменится.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-5">
        <aside className="md:col-span-5 rounded-xl border border-border bg-bg p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-accent-hover">
              {SANDBOX_PROBLEM.tag}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">sandbox</span>
          </div>
          <h3 className="font-display text-base font-bold mb-2">{SANDBOX_PROBLEM.title}</h3>
          <p className="text-[12px] text-text-secondary leading-relaxed mb-3">{SANDBOX_PROBLEM.body}</p>
          <pre className="rounded bg-surface-2 p-2.5 font-mono text-[11px] text-text-secondary whitespace-pre">
            {`Input:  ${SANDBOX_PROBLEM.sample.input}\nOutput: ${SANDBOX_PROBLEM.sample.output}`}
          </pre>
        </aside>
        <section className="md:col-span-7 rounded-xl border border-border bg-bg p-4">
          {/* Lightweight read-only editor preview (no Monaco — keeps the
              onboarding bundle small). The real editor lives behind the
              "Запустить и далее" button on the actual arena. */}
          <div className="rounded bg-surface-2 p-3 font-mono text-[12px] text-text-secondary leading-relaxed min-h-[180px]">
            {`def length_of_longest_substring(s: str) -> int:\n    seen = {}\n    left = best = 0\n    for right, ch in enumerate(s):\n        if ch in seen and seen[ch] >= left:\n            left = seen[ch] + 1\n        seen[ch] = right\n        best = max(best, right - left + 1)\n    return best`}
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={runAndGo}
              className="rounded-md border border-success/30 bg-success/15 px-2.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-success"
            >
              ▶ run
            </button>
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
              kbd ⏎ — то же самое в реальной арене
            </span>
          </div>
        </section>
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={runAndGo}
          className="rounded-md bg-accent hover:bg-accent/90 text-white font-semibold text-sm px-5 py-2.5"
        >
          Запустить и далее →
        </button>
      </div>
    </OnboardingLayout>
  )
}
