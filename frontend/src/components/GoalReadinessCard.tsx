// Three visible states:
//   1. No goal yet → CTA «Поставить цель» (open GoalWizardModal upstream) +
//      hint «Без цели coach плывёт».
//   2. Has goal but no F9 progress → showing low readiness + CTA «Пройти
//      диагностику» (links к /diagnostic).
//   3. Goal + F9 → full readiness widget с %, weeks, factors list.
//
// B/W rule: red — единственная decoration через 1.5px stripe сбоку progress
// bar когда readiness <30% (signals «много work ahead»).
import { Link } from 'react-router-dom'
import { Brain, Calendar, ChevronRight, Target } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { computeReadiness } from '../lib/readiness'
import { formatGoal, type UserGoal } from '../lib/goal'
import { loadResult, resultAgeDays } from '../lib/miniMock'

interface Props {
  goal: UserGoal | null
  onSetGoal?: () => void
}

export function GoalReadinessCard({ goal, onSetGoal }: Props) {
  const { t } = useTranslation('pages')
  if (!goal) {
    return (
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-1 p-5">
        <header className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-text-secondary" />
          <h2 className="font-display text-base font-bold leading-tight">{t('goal_readiness.title_goal')}</h2>
        </header>
        <p className="text-[13px] leading-relaxed text-text-secondary">
          {t('goal_readiness.no_goal_body')}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {onSetGoal && (
            <button
              type="button"
              onClick={onSetGoal}
              className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[13px] font-semibold text-text-primary transition-colors hover:border-border-strong"
            >
              {t('goal_readiness.set_goal')}
            </button>
          )}
          <Link
            to="/diagnostic"
            className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
          >
            {t('goal_readiness.diag_link')}
          </Link>
        </div>
      </section>
    )
  }

  const readiness = computeReadiness(goal)
  const low = readiness.readinessPct < 30
  const med = readiness.readinessPct >= 30 && readiness.readinessPct < 60

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {t('goal_readiness.header_readiness')}
          </span>
          <h2 className="font-display text-base font-bold leading-tight">
            {formatGoal(goal)}
          </h2>
        </div>
        <span className="font-display text-2xl font-bold tabular-nums text-text-primary">
          {readiness.readinessPct}%
        </span>
      </header>

      {/* Progress bar — B/W rule: red как 1.5px left stripe только когда low */}
      <div className="relative h-[6px] w-full overflow-hidden rounded-full bg-surface-2">
        {low && (
          <span
            aria-hidden
            className="absolute left-0 top-0 h-full w-[1.5px]"
            style={{ background: '#FF3B30' }}
          />
        )}
        <div
          className="h-full bg-text-primary transition-all duration-[var(--motion-dur-xlarge)] ease-[var(--motion-ease-emphasized)]"
          style={{ width: `${readiness.readinessPct}%` }}
        />
      </div>

      {readiness.weeksToTarget !== null && (
        <div className="flex items-center gap-2 font-mono text-[11px] text-text-muted">
          <Calendar className="h-3 w-3" />
          {readiness.weeksToTarget === 0
            ? t('goal_readiness.weeks_zero')
            : readiness.weeksToTarget === 1
              ? t('goal_readiness.weeks_one')
              : t('goal_readiness.weeks_many', { n: readiness.weeksToTarget })}
        </div>
      )}

      {/* Factors list — bullet rationale */}
      {readiness.factors.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted hover:text-text-primary">
            {t('goal_readiness.factors_summary')} <ChevronRight className="inline h-3 w-3 transition-transform group-open:rotate-90" />
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {readiness.factors.map((f, i) => (
              <li key={i} className="flex items-start justify-between gap-3 text-[12px]">
                <span className="text-text-secondary">{f.label}</span>
                <span
                  className={`shrink-0 font-mono tabular-nums ${
                    f.delta > 0
                      ? 'text-text-primary'
                      : f.delta < 0
                        ? 'text-text-muted'
                        : 'text-text-muted'
                  }`}
                >
                  {f.delta > 0 ? '+' : ''}
                  {f.delta}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* F8 mini-mock entry pill. Shown когда нет recent (≤14d) result, либо
          badge с оценкой если есть. Recent result → factor уже виден выше в
          factors breakdown; здесь — entry point чтобы перепройти / открыть. */}
      <MiniMockPill />

      {/* CTA bar — show diagnostic suggestion when readiness low/med + diagnostic
        не пройден (factors короткий = только base). Otherwise — link to Coach. */}
      {readiness.factors.length <= 1 ? (
        <Link
          to="/diagnostic"
          className="self-start font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
        >
          {t('goal_readiness.diag_more')}
        </Link>
      ) : (
        <Link
          to="/tutor/ai/algo-coach"
          className="self-start font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
        >
          {low
            ? t('goal_readiness.coach_low')
            : med
              ? t('goal_readiness.coach_med')
              : t('goal_readiness.coach_high')}
        </Link>
      )}
    </section>
  )
}

function MiniMockPill() {
  const { t } = useTranslation('pages')
  const result = loadResult()
  const age = resultAgeDays()
  // Recent (≤14d) — badge с score + relink.
  if (result && age !== null && age <= 14) {
    const fresh = age <= 3
    return (
      <Link
        to="/mock/diagnostic"
        className="inline-flex items-center gap-2 self-start rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-text-primary transition-colors hover:border-border-strong"
      >
        <Target className="h-3 w-3" />
        {t('goal_readiness.mini_mock_recent', { score: result.overallScore.toFixed(1), ago: fresh ? t('goal_readiness.mini_mock_fresh', { days: age }) : t('goal_readiness.mini_mock_stale', { days: age }) })}
      </Link>
    )
  }
  // No recent result — strong CTA pill.
  return (
    <Link
      to="/mock/diagnostic"
      className="inline-flex items-center gap-2 self-start rounded-md border border-border-strong bg-text-primary/5 px-3 py-1.5 text-[11px] font-semibold text-text-primary transition-colors hover:bg-text-primary/10"
    >
      <Target className="h-3 w-3" />
      {t('goal_readiness.mini_mock_cta')}
    </Link>
  )
}
