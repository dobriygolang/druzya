// Onboarding Step 4 — first task in sandbox mode.
//
// Sandbox = NO side-effects: no submission to history, no streak update.
// The user just sees mock-session layout (problem / editor / sample-IO).
// Skip-able («потом попробую»). После Step5 ведёт на /atlas с tour.
//
// Deliberately нет real CodeEditor — heavy dependency, onboarding не
// должен платить bundle cost. Read-only preview даёт ощущение layout'а.
//
// 2026-05-12: v2 visual language — hairline panels, mono code blocks
// on transparent bg, ghost run button (no green tint per b/w + red rule).

import { useNavigate } from 'react-router-dom'

import { OnboardingLayout } from './_shared/Layout'
import { useOnboarding } from './_shared/useOnboarding'

const SANDBOX_PROBLEM = {
  title: 'Longest substring without repeat',
  tag: 'sliding window · entry',
  body: 'Дана строка s. Найди длину самой длинной подстроки без повторов символов.',
  sample: { input: '"abcabcbb"', output: '3' },
}

const captionMono: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
}

const monoChip: React.CSSProperties = {
  display: 'inline-block',
  padding: '3px 8px',
  border: '1px solid var(--hair-2)',
  borderRadius: 999,
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-60)',
}

export default function Step4Task() {
  const nav = useNavigate()
  const { setStep } = useOnboarding()

  const runAndGo = () => {
    // Sandbox: no side-effects in storage. Just navigate to Atlas tour.
    setStep(5)
    nav('/atlas?tour=1')
  }
  const skip = () => {
    setStep(5)
    nav('/atlas?tour=1&skipped=task')
  }

  return (
    <OnboardingLayout step={4} onBack={() => nav('/onboarding/skill')} onSkip={skip} skipLabel="потом попробую">
      <div className="text-center" style={{ marginBottom: 24 }}>
        <div style={{ ...captionMono, fontSize: 11, marginBottom: 10 }}>шаг 4 · как выглядит mock</div>
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
          Первая задача — sandbox
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-60)', lineHeight: 1.55 }}>
          Без таймера и без записи в историю — посмотри, как устроена сессия.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12" style={{ gap: 12, marginBottom: 20 }}>
        <aside className="md:col-span-5" style={panelStyle}>
          <div className="flex-wrap-row" style={{ justifyContent: 'space-between', marginBottom: 12, gap: 8 }}>
            <span style={monoChip}>{SANDBOX_PROBLEM.tag}</span>
            <span style={captionMono}>sandbox</span>
          </div>
          <h3
            style={{
              margin: 0,
              marginBottom: 8,
              fontSize: 'var(--type-h3-size)',
              lineHeight: 'var(--type-h3-lh)',
              letterSpacing: 'var(--type-h3-ls)',
              fontWeight: 'var(--type-h3-weight)',
              color: 'rgb(var(--ink))',
            }}
          >
            {SANDBOX_PROBLEM.title}
          </h3>
          <p style={{ margin: 0, marginBottom: 12, fontSize: 12, color: 'var(--ink-60)', lineHeight: 1.55 }}>
            {SANDBOX_PROBLEM.body}
          </p>
          <pre
            style={{
              margin: 0,
              padding: '10px 12px',
              border: '1px solid var(--hair)',
              borderRadius: 'var(--radius-inner)',
              background: 'rgba(255, 255, 255, 0.02)',
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 11,
              color: 'var(--ink-60)',
              whiteSpace: 'pre',
              overflowX: 'auto',
            }}
          >
            {`Input:  ${SANDBOX_PROBLEM.sample.input}\nOutput: ${SANDBOX_PROBLEM.sample.output}`}
          </pre>
        </aside>
        <section className="md:col-span-7" style={panelStyle}>
          {/* Lightweight read-only editor preview (no Monaco — keeps the
              onboarding bundle small). */}
          <pre
            style={{
              margin: 0,
              padding: '12px 14px',
              border: '1px solid var(--hair)',
              borderRadius: 'var(--radius-inner)',
              background: 'rgba(255, 255, 255, 0.02)',
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 12,
              color: 'var(--ink-60)',
              lineHeight: 1.6,
              minHeight: 180,
              overflowX: 'auto',
              whiteSpace: 'pre',
            }}
          >
            {`def length_of_longest_substring(s: str) -> int:\n    seen = {}\n    left = best = 0\n    for right, ch in enumerate(s):\n        if ch in seen and seen[ch] >= left:\n            left = seen[ch] + 1\n        seen[ch] = right\n        best = max(best, right - left + 1)\n    return best`}
          </pre>
          <div className="flex-wrap-row" style={{ marginTop: 12, alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={runAndGo}
              className="focus-ring motion-press"
              style={{
                padding: '6px 12px',
                border: '1px solid var(--hair-2)',
                borderRadius: 'var(--radius-inner)',
                background: 'transparent',
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'rgb(var(--ink))',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                transition:
                  'background-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 1.5, background: 'var(--red)' }} />
              ▶ run
            </button>
            <span style={captionMono}>kbd ⏎ — то же самое в реальной арене</span>
          </div>
        </section>
      </div>

      <div className="flex" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={runAndGo}
          className="focus-ring motion-press"
          style={{
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
          }}
        >
          Запустить и далее →
        </button>
      </div>
    </OnboardingLayout>
  )
}

const panelStyle: React.CSSProperties = {
  padding: 16,
  border: '1px solid var(--hair-2)',
  borderRadius: 'var(--radius-outer)',
  background: 'transparent',
}
