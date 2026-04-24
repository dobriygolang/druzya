import { Shield } from 'lucide-react'
import type { Cohort } from '../../lib/queries/cohort'
import { tierFor, tierLabel } from './helpers'

export function CohortBanner({ cohort, rank }: { cohort: Cohort; rank?: number }) {
  return (
    <div
      className="flex h-auto flex-col items-start justify-between gap-4 px-4 py-6 sm:px-8 lg:h-[200px] lg:flex-row lg:items-center lg:gap-0 lg:px-20 lg:py-0"
      style={{ background: 'linear-gradient(135deg, #2D1B4D 0%, #582CFF 100%)' }}
    >
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div
          className="grid h-24 w-24 place-items-center"
          style={{
            borderRadius: 18,
            background: 'linear-gradient(135deg, #22D3EE 0%, #582CFF 100%)',
          }}
        >
          <Shield className="h-12 w-12 text-text-primary" />
        </div>
        <div className="flex flex-col gap-1.5">
          {rank ? (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn">
              {tierLabel(tierFor(cohort.cohort_elo)).toUpperCase()} TIER · #{rank} GLOBAL
            </span>
          ) : null}
          <h1 className="font-display text-3xl font-extrabold leading-[1.05] text-text-primary sm:text-4xl lg:text-[36px]">
            {cohort.name}
          </h1>
          <p className="text-sm text-text-secondary">
            {(cohort.members?.length ?? 0)} участников · cohort ELO {cohort.cohort_elo}
          </p>
          <div className="mt-2 flex gap-6">
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold text-text-primary">{cohort.cohort_elo}</span>
              <span className="text-[11px] text-text-muted">cohort ELO</span>
            </div>
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold text-cyan">
                {cohort.members?.length ?? 0}
              </span>
              <span className="text-[11px] text-text-muted">участников</span>
            </div>
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold text-warn">
                {cohort.current_war_id ? '1' : '0'}
              </span>
              <span className="text-[11px] text-text-muted">активных войн</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
