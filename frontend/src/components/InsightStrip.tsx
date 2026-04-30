// InsightStrip — atomic-coach cards rendered as a horizontal lane.
//
// Shape per card:
//   • severity dot (red/amber/grey) + anchor label (mono)
//   • headline (bold, 1 line)
//   • evidence + interpret + lever in a tight 3-line stack
//   • follow / dismiss icons + deep-link (if present)
//
// Empty stream renders nothing — the page above will show its own
// placeholder if needed.

import { ArrowRight, Check, X } from 'lucide-react'
import {
  severityLabel,
  useAckInsightMutation,
  useInsightsQuery,
  type Insight,
  type InsightSeverity,
} from '../lib/queries/insights'
import { Card } from './Card'

interface Props {
  surface?: string
  limit?: number
  /**
   * When true, the strip renders even when empty (with an inline empty
   * state); when false (default), we render nothing so the parent can
   * own the empty UX.
   */
  showEmpty?: boolean
}

const DOT_BY_SEVERITY: Record<InsightSeverity, string> = {
  INSIGHT_SEVERITY_CRITICAL: 'bg-danger',
  INSIGHT_SEVERITY_WARN: 'bg-warn',
  INSIGHT_SEVERITY_NUDGE: 'bg-text-muted',
  INSIGHT_SEVERITY_CRUISE: 'bg-text-muted/60',
}

const RING_BY_SEVERITY: Record<InsightSeverity, string> = {
  INSIGHT_SEVERITY_CRITICAL: 'border-danger/50 ring-1 ring-danger/15',
  INSIGHT_SEVERITY_WARN: 'border-warn/50 ring-1 ring-warn/10',
  INSIGHT_SEVERITY_NUDGE: 'border-border',
  INSIGHT_SEVERITY_CRUISE: 'border-border',
}

export function InsightStrip({ surface = 'today', limit = 6, showEmpty = false }: Props) {
  const q = useInsightsQuery(surface, limit)
  if (q.isPending) return null
  if (q.isError) return null
  const items = q.data?.items ?? []
  if (items.length === 0) {
    if (!showEmpty) return null
    return (
      <Card className="p-6 text-center text-sm text-text-muted">
        Пока нет insights — данные подтянутся, когда появится первая активность.
      </Card>
    )
  }
  return (
    <section className="flex flex-col gap-3" aria-label="AI insights">
      <header className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold text-text-primary">AI Insights</h2>
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          {items.length} live
        </span>
      </header>
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {items.map((ins) => (
          <li key={ins.id}>
            <InsightCard insight={ins} surface={surface} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function InsightCard({ insight, surface }: { insight: Insight; surface: string }) {
  const ack = useAckInsightMutation(surface)
  const dot = DOT_BY_SEVERITY[insight.severity] ?? DOT_BY_SEVERITY.INSIGHT_SEVERITY_NUDGE
  const ring = RING_BY_SEVERITY[insight.severity] ?? RING_BY_SEVERITY.INSIGHT_SEVERITY_NUDGE
  const onAct = (action: 'follow' | 'dismiss') => {
    ack.mutate({ id: insight.id, action })
  }
  return (
    <Card className={['flex flex-col gap-2 p-4 transition', ring].join(' ')}>
      <div className="flex items-center gap-2">
        <span aria-hidden className={['inline-block h-2 w-2 rounded-full', dot].join(' ')} />
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          {severityLabel(insight.severity)} · {insight.anchor}
        </span>
      </div>
      <h3 className="font-display text-base font-bold text-text-primary">{insight.headline}</h3>
      {insight.evidence && (
        <p className="text-xs text-text-secondary">{insight.evidence}</p>
      )}
      {insight.interpret && (
        <p className="text-xs text-text-muted">{insight.interpret}</p>
      )}
      {insight.lever && (
        <p className="text-sm text-text-primary">{insight.lever}</p>
      )}
      <footer className="mt-1 flex items-center justify-between gap-2">
        {insight.deep_link ? (
          <a
            href={insight.deep_link}
            className="inline-flex items-center gap-1 font-mono text-[11px] text-text-primary underline-offset-4 hover:underline"
          >
            Open
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        ) : (
          <span aria-hidden />
        )}
        <div className="flex gap-1">
          <button
            type="button"
            title="Followed"
            aria-label="Followed"
            onClick={() => onAct('follow')}
            className="rounded-md border border-border bg-surface-2 px-2 py-1 text-text-secondary hover:border-success/40 hover:text-success"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Dismiss"
            aria-label="Dismiss"
            onClick={() => onAct('dismiss')}
            className="rounded-md border border-border bg-surface-2 px-2 py-1 text-text-secondary hover:border-danger/40 hover:text-danger"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </footer>
    </Card>
  )
}
