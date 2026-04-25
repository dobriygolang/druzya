// PipelineStepper — top-of-cockpit indicator showing the 5 stages and
// where the user currently is. Pure-presentation; no data fetching.
//
// Visual rules:
//   - completed stages   : tone-success, with checkmark glyph
//   - current stage      : tone-accent, animated pulse ring
//   - pending stages     : tone-muted, no decoration
//
// Mobile (<sm) collapses to "{currentLabel} · {idx+1}/{total}" text only —
// the dot row is hidden (would not fit).

import { Check } from 'lucide-react'
import { cn } from '../../lib/cn'
import { STAGE_LABEL, STAGE_ORDER, type StageKind } from '../../lib/queries/mockPipeline'

export type PipelineStepperProps = {
  currentStage: number
  /** Stage kinds in pipeline order. Defaults to STAGE_ORDER. */
  stages?: StageKind[]
  /** Per-stage status; len must match stages. Defaults to derive-from-current. */
  statuses?: ('pending' | 'in_progress' | 'done' | 'skipped')[]
}

export function PipelineStepper({ currentStage, stages = STAGE_ORDER, statuses }: PipelineStepperProps) {
  const total = stages.length
  const safeIdx = Math.max(0, Math.min(currentStage, total - 1))
  const currentLabel = STAGE_LABEL[stages[safeIdx]]

  const derivedStatus = (i: number): 'pending' | 'in_progress' | 'done' | 'skipped' => {
    if (statuses && statuses[i]) return statuses[i]
    if (i < safeIdx) return 'done'
    if (i === safeIdx) return 'in_progress'
    return 'pending'
  }

  return (
    <div className="w-full">
      <div className="hidden sm:flex items-center gap-2">
        {stages.map((kind, i) => {
          const st = derivedStatus(i)
          const isLast = i === total - 1
          return (
            <div key={kind} className="flex items-center gap-2 flex-1">
              <div
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 border text-xs font-medium flex-1 transition-colors',
                  st === 'done' && 'border-success/40 bg-success/10 text-success',
                  st === 'in_progress' && 'border-text-primary bg-text-primary/10 text-text-primary ring-2 ring-text-primary/40/30',
                  st === 'pending' && 'border-border bg-surface-1 text-text-muted',
                  st === 'skipped' && 'border-border bg-surface-1 text-text-muted opacity-60 line-through',
                )}
              >
                <span
                  className={cn(
                    'inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                    st === 'done' && 'bg-success text-white',
                    st === 'in_progress' && 'bg-text-primary text-bg',
                    (st === 'pending' || st === 'skipped') && 'bg-surface-2 text-text-muted',
                  )}
                >
                  {st === 'done' ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className="truncate">{STAGE_LABEL[kind]}</span>
              </div>
              {!isLast && <span className="h-px flex-shrink-0 w-3 bg-border" aria-hidden />}
            </div>
          )
        })}
      </div>
      <div className="sm:hidden text-sm font-medium text-text-secondary">
        <span className="text-text-primary">{currentLabel}</span>
        <span className="text-text-muted ml-2 font-mono text-xs">
          {safeIdx + 1}/{total}
        </span>
      </div>
    </div>
  )
}

export default PipelineStepper
