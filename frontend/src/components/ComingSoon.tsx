// ComingSoon — honest placeholder used when a gamification surface has no
// backend yet. Used for /tournament/:id and /cards while the real services
// (tournament + hero_cards) are out of scope for the MVP.
//
// We intentionally render zero hard-coded sample data — the goal of this
// component is to delete every "demo" scaffolding from the page above it, not
// to disguise it.
import { Sparkles } from 'lucide-react'

export type ComingSoonProps = {
  title: string
  description: string
  // Optional CTA pair for sending the user somewhere actionable.
  primaryCta?: { label: string; onClick: () => void }
  secondaryCta?: { label: string; onClick: () => void }
}

export function ComingSoon({ title, description, primaryCta, secondaryCta }: ComingSoonProps) {
  return (
    <div className="flex w-full items-center justify-center px-4 py-12 sm:px-8 lg:px-20">
      <div className="flex w-full max-w-[640px] flex-col items-center gap-5 rounded-2xl border border-border bg-surface-1 p-8 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-accent/30 to-pink/30">
          <Sparkles className="h-6 w-6 text-accent-hover" />
        </div>
        <h2 className="font-display text-2xl font-bold text-text-primary">{title}</h2>
        <p className="max-w-[480px] text-sm text-text-secondary">{description}</p>
        {(primaryCta || secondaryCta) && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {primaryCta && (
              <button
                type="button"
                onClick={primaryCta.onClick}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-text-primary shadow-glow hover:bg-accent/90"
              >
                {primaryCta.label}
              </button>
            )}
            {secondaryCta && (
              <button
                type="button"
                onClick={secondaryCta.onClick}
                className="rounded-md border border-border bg-surface-2 px-4 py-2 text-sm text-text-secondary hover:border-border-strong hover:text-text-primary"
              >
                {secondaryCta.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
