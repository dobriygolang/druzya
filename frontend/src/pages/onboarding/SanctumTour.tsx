// Onboarding Step 5 — sanctum tour overlay (Wave-10, design-review v3 A.5).
//
// Renders OVER the actual <SanctumPage /> when URL contains ?tour=1.
// Reads `data-tour="..."` attributes placed on the real sanctum
// sections (DailyKata / Streak / MatchCTAs / AICoach) to position a
// radial spotlight + coach-mark card opposite to the highlighted region.
//
// Skip = «пропустить тур» = treats as completion (we don't want to keep
// re-showing). Finish hits the backend completion endpoint, removes the
// localStorage step counter, navigates to the clean /sanctum.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOnboarding } from './_shared/useOnboarding'

type CoachMark = { target: string; title: string; body: string }

const MARKS: CoachMark[] = [
  {
    target: '[data-tour="daily-kata"]',
    title: 'Daily kata',
    body: 'Одна задача каждый день из focus-class. +1 streak за решение, минимум +2 ELO.',
  },
  {
    target: '[data-tour="streak"]',
    title: 'Streak',
    body: 'Сохраняй цепочку дней — за каждые 7 подряд даём bonus-kata и ачивку.',
  },
  {
    target: '[data-tour="match-cta"]',
    title: 'Матчи',
    body: 'Три режима: play now (рейтинг), quick (без счёта), tournament (еженедельный).',
  },
  {
    target: '[data-tour="coach"]',
    title: 'AI coach',
    body: 'Прикрепи матч или kata — получи разбор: где просел, что читать, где похожие задачи.',
  },
]

export function SanctumTour() {
  const nav = useNavigate()
  const { completeOnboarding } = useOnboarding()
  const [idx, setIdx] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  // Re-measure on step change AND on window resize so coach card follows
  // a layout that may rebreak when the user resizes the window.
  useEffect(() => {
    const measure = () => {
      const el = document.querySelector(MARKS[idx].target)
      setRect(el ? el.getBoundingClientRect() : null)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [idx])

  const finish = async () => {
    await completeOnboarding.mutateAsync()
    nav('/sanctum', { replace: true })
  }
  const skip = finish
  const next = () => (idx < MARKS.length - 1 ? setIdx(idx + 1) : finish())

  const mark = MARKS[idx]

  return (
    <div className="fixed inset-0 z-50 pointer-events-none" role="dialog" aria-modal="true" aria-label={`Тур · ${mark.title}`}>
      {/* Radial spotlight cuts a hole over the target rect; everything
          else darkens to focus attention. */}
      {rect && (
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(ellipse ${rect.width * 0.7}px ${rect.height * 0.9}px at ${
              rect.left + rect.width / 2
            }px ${rect.top + rect.height / 2}px, transparent 0%, rgba(10,10,15,0.82) 70%)`,
          }}
        />
      )}
      {/* Coach card — positioned just below the highlighted rect. Edge
          clamping (Math.max with 20) keeps it inside the viewport even
          near the top/left. */}
      <div
        className="absolute pointer-events-auto rounded-xl border border-accent bg-bg p-4 max-w-[300px] shadow-glow"
        style={{
          top: Math.max(20, (rect?.bottom ?? 120) + 14),
          left: Math.max(20, rect?.left ?? 40),
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-accent-hover">
            шаг {idx + 1} из {MARKS.length}
          </span>
          <button
            type="button"
            onClick={skip}
            className="font-mono text-[10px] uppercase tracking-wider text-text-muted hover:text-text-primary"
          >
            пропустить тур ✕
          </button>
        </div>
        <div className="font-display text-sm font-bold mb-1">{mark.title}</div>
        <p className="text-[12px] text-text-secondary leading-relaxed mb-3">{mark.body}</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {MARKS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-5 rounded-full ${i <= idx ? 'bg-accent' : 'bg-surface-3'}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={next}
            className="rounded-md bg-accent hover:bg-accent/90 text-white text-[12px] font-semibold px-3 py-1.5"
          >
            {idx === MARKS.length - 1 ? 'Готово' : 'Дальше →'}
          </button>
        </div>
      </div>
    </div>
  )
}
