// PersonalContextBanner — reusable state-aware hint banner. Reads F2 goal +
// F5 activity summary, render's persona-tailored message + CTA. Используется
// на surfaces которые не-Today (AtlasPage, CodexPage, etc.) чтобы дать
// контекст «где ты в trajectory» прямо на secondary pages.
//
// 4 состояния:
//   1. No goal              → «Курс пока не задан» + диагностика CTA
//   2. Goal + 0 activity    → «Активность пуста — coach без сигналов»
//   3. Goal + low activity  → «Goal: X · last activity N дней назад»
//   4. Goal + healthy       → «Goal: X · {count} активностей за 7 дней» (cruise)
//
// B/W rule: red — только если no-goal OR 0 activity (1.5px top stripe).

import { Link } from 'react-router-dom'

import { useGoal } from '../lib/useGoal'
import { useActivitySummary } from '../lib/useActivity'
import { formatGoal } from '../lib/goal'

export function PersonalContextBanner() {
  const goal = useGoal()
  const summary = useActivitySummary()

  let stripe: 'red' | 'none' = 'none'
  let label: string
  let detail: string | null = null
  let ctaHref: string | null = null
  let ctaLabel: string | null = null

  if (!goal) {
    stripe = 'red'
    label = 'Курс ещё не задан'
    detail = '8-минутная диагностика подберёт track, цель и 3 первых действия.'
    ctaHref = '/diagnostic'
    ctaLabel = 'Пройти диагностику'
  } else if (summary.last7d === 0) {
    stripe = 'red'
    label = `Goal: ${formatGoal(goal)}`
    detail = 'Активность пуста за 7 дней — coach без сигналов. Залогируй любое занятие чтобы запустить feedback loop.'
    ctaHref = '/today'
    ctaLabel = 'К плану'
  } else if (summary.last7d <= 2) {
    label = `Goal: ${formatGoal(goal)}`
    detail = `${summary.last7d} ${pluralActions(summary.last7d)} за неделю — coach видит, но темп слабый.`
    ctaHref = '/today'
    ctaLabel = 'К плану'
  } else {
    label = `Goal: ${formatGoal(goal)}`
    detail = `${summary.last7d} ${pluralActions(summary.last7d)} за 7 дней · темп ОК.`
    ctaHref = '/today'
    ctaLabel = 'К плану'
  }

  return (
    <section
      role="status"
      className="relative flex flex-col gap-1.5 rounded-xl border border-border bg-surface-1 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
    >
      {stripe === 'red' && (
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-xl"
          style={{ background: 'var(--red)' }}
        />
      )}
      <div className="flex flex-col gap-0.5 min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          Personal context
        </p>
        <p className="truncate text-[14px] font-semibold text-text-primary">{label}</p>
        {detail && <p className="text-[12px] text-text-muted">{detail}</p>}
      </div>
      {ctaHref && ctaLabel && (
        <Link
          to={ctaHref}
          className="shrink-0 self-start rounded-md border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:border-border-strong hover:text-text-primary sm:self-center"
        >
          {ctaLabel}
        </Link>
      )}
    </section>
  )
}

function pluralActions(n: number): string {
  if (n === 1) return 'занятие'
  if (n >= 2 && n <= 4) return 'занятия'
  return 'занятий'
}
