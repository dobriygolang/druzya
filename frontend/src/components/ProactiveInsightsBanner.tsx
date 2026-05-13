// B/W rule: red `#FF3B30` only для critical 1.5px left stripe; warn/nudge/
// cruise — neutral на surface-1 background.
//
// Dismiss → стереть из view на 24h (persistence через
// lib/insights.ts → dismissInsight).

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, AlertTriangle, AlertCircle, Lightbulb, CheckCircle2 } from 'lucide-react'

import { dismissInsight, getActiveInsights, type CoachInsight, type InsightSeverity } from '../lib/insights'
import { subscribeActivities } from '../lib/activity'
import { subscribeGoal } from '../lib/goal'

const SEVERITY_ICON: Record<InsightSeverity, typeof AlertTriangle> = {
  critical: AlertTriangle,
  warn: AlertCircle,
  nudge: Lightbulb,
  cruise: CheckCircle2,
}

export function ProactiveInsightsBanner() {
  const [insights, setInsights] = useState<CoachInsight[]>(() => getActiveInsights())

  // Re-detect on any underlying signal change (activity / goal). Diagnostic
  // / readiness are derived → covered via these two.
  useEffect(() => {
    const refresh = () => setInsights(getActiveInsights())
    const unsubActivity = subscribeActivities(refresh)
    const unsubGoal = subscribeGoal(refresh)
    return () => {
      unsubActivity()
      unsubGoal()
    }
  }, [])

  if (insights.length === 0) return null

  const top = insights[0]
  const Icon = SEVERITY_ICON[top.severity]
  const isCritical = top.severity === 'critical'

  return (
    <section
      role="alert"
      className="relative flex items-start gap-3 rounded-xl border border-border bg-surface-1 p-4 sm:p-5"
    >
      {/* Critical severity → red 1.5px left stripe (B/W rule). Lower
        severities — нет color accent (relies на icon + copy tone). */}
      {isCritical && (
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-xl"
          style={{ background: 'var(--red)' }}
        />
      )}

      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${
          isCritical ? 'text-text-primary' : 'text-text-secondary'
        }`}
      />

      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <p
          className={`text-[13.5px] font-semibold leading-snug ${
            isCritical ? 'text-text-primary' : 'text-text-primary'
          }`}
        >
          {top.headline}
        </p>
        {top.detail && (
          <p className="text-[12px] leading-relaxed text-text-muted">{top.detail}</p>
        )}
        {top.action && (
          <Link
            to={top.action.href}
            className="mt-1 self-start font-mono text-[11px] uppercase tracking-[0.08em] text-text-secondary underline-offset-2 transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:text-text-primary hover:underline"
          >
            {top.action.label} →
          </Link>
        )}
        {insights.length > 1 && (
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            ещё {insights.length - 1}{' '}
            {pluralInsights(insights.length - 1)} в очереди
          </p>
        )}
      </div>

      {(top.dismissible ?? true) && (
        <button
          type="button"
          onClick={() => {
            dismissInsight(top.id)
            setInsights((prev) => prev.filter((i) => i.id !== top.id))
          }}
          aria-label="Скрыть на 24 часа"
          className="shrink-0 rounded-md text-text-muted transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)] hover:bg-surface-2 hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </section>
  )
}

function pluralInsights(n: number): string {
  if (n === 1) return 'инсайт'
  if (n >= 2 && n <= 4) return 'инсайта'
  return 'инсайтов'
}
