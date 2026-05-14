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
import { useTranslation } from 'react-i18next'

import { useGoal } from '../lib/useGoal'
import { useActivitySummary } from '../lib/useActivity'
import { formatGoal } from '../lib/goal'
import i18n from '../lib/i18n'

export function PersonalContextBanner() {
  const { t } = useTranslation('wave14')
  const goal = useGoal()
  const summary = useActivitySummary()

  let stripe: 'red' | 'none' = 'none'
  let label: string
  let detail: string | null = null
  let ctaHref: string | null = null
  let ctaLabel: string | null = null

  if (!goal) {
    stripe = 'red'
    label = t('personal_context.course_not_set')
    detail = t('personal_context.diagnostic_intro')
    ctaHref = '/diagnostic'
    ctaLabel = t('personal_context.take_diagnostic')
  } else if (summary.last7d === 0) {
    stripe = 'red'
    label = `Goal: ${formatGoal(goal)}`
    detail = t('personal_context.activity_empty')
    ctaHref = '/today'
    ctaLabel = t('personal_context.to_plan')
  } else if (summary.last7d <= 2) {
    label = `Goal: ${formatGoal(goal)}`
    detail = `${summary.last7d} ${pluralActions(summary.last7d)} ${t('personal_context.week_low_pace')}`
    ctaHref = '/today'
    ctaLabel = t('personal_context.to_plan')
  } else {
    label = `Goal: ${formatGoal(goal)}`
    detail = `${summary.last7d} ${pluralActions(summary.last7d)} ${t('personal_context.week_ok_pace')}`
    ctaHref = '/today'
    ctaLabel = t('personal_context.to_plan')
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
  if (n === 1) return i18n.t('personal_context.session', { ns: 'wave14' })
  if (n >= 2 && n <= 4) return i18n.t('personal_context.sessions_few', { ns: 'wave14' })
  return i18n.t('personal_context.sessions_many', { ns: 'wave14' })
}
