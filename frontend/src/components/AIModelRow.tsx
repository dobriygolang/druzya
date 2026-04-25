// AIModelRow — radio-row pattern for the AI Coach model picker
// (Wave-9 design-review P2 #1 + #2).
//
// Three states a row can be in:
//
//   1. unselected, available — empty radio circle on the left, name + meta
//      in the middle, "free" / "💎 premium" chip on the right.
//   2. selected — accent radio dot, accent border, accent/10 fill.
//   3. locked — lock-icon replaces the radio circle, opacity-70 on the
//      label, hover tints the row warn (premium teaser), click is a
//      no-op handled by the parent (which can open an upgrade sheet).
//
// Why a dedicated component: previously every row was rendered inline in
// SettingsPage with `disabled={locked}` + `opacity-50`. The lock state
// looked like a half-rendered row, not a deliberate "you need to upgrade"
// affordance. This is the deliberate version.

import { Check, Lock, Zap } from 'lucide-react'
import { cn } from '../lib/cn'

export type AIModelTier = 'free' | 'premium'

export type AIModelRowProps = {
  /** OpenRouter model id, e.g. "openai/gpt-4o-mini". Pass "" for the
   *  "default" sentinel row that maps to server-default. */
  id: string
  label: string
  /** Provider + sub-id rendered in the meta line. */
  meta: string
  tier: AIModelTier
  selected: boolean
  /** When true, the row renders the locked state and onSelect is suppressed. */
  locked?: boolean
  /** Virtual (chain-level pseudo) model — today only "druz9/turbo".
   *  Rendered with an accent border + ⚡ badge regardless of tier, so
   *  users immediately see it as "the smart default" rather than "just
   *  another free model". Wired from the backend's is_virtual column
   *  on llm_models (migration 00045). */
  isVirtual?: boolean
  onSelect: (id: string) => void
}

export function AIModelRow({ id, label, meta, tier, selected, locked, isVirtual, onSelect }: AIModelRowProps) {
  return (
    <button
      type="button"
      onClick={() => {
        if (locked) return
        onSelect(id)
      }}
      aria-pressed={selected}
      aria-disabled={locked || undefined}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
        selected
          ? 'border-text-primary bg-text-primary/10'
          : 'border-border bg-bg/40 hover:border-border-strong',
        isVirtual && !selected && 'border-border-strong bg-text-primary/[0.04] hover:border-text-primary',
        locked && 'cursor-not-allowed hover:border-warn/40 hover:bg-warn/[0.04]',
      )}
      title={locked ? 'Доступно на Premium подписке' : undefined}
    >
      {/* Radio / lock indicator */}
      <span
        className={cn(
          'grid h-4 w-4 shrink-0 place-items-center rounded-full border-2',
          selected ? 'border-text-primary' : 'border-border-strong',
          locked && 'border-border-strong opacity-40 group-hover:opacity-60',
        )}
      >
        {locked ? (
          <Lock className="h-2.5 w-2.5 text-text-muted" />
        ) : selected ? (
          <span className="h-2 w-2 rounded-full bg-text-primary" />
        ) : null}
      </span>

      {/* Label + meta */}
      <div className={cn('flex min-w-0 flex-1 flex-col', locked && 'opacity-70')}>
        <span className="truncate text-[13px] font-semibold text-text-primary">{label}</span>
        <span className="truncate font-mono text-[10px] text-text-muted">{meta}</span>
      </div>

      {/* Right-side chip */}
      <RightChip tier={tier} selected={selected} locked={locked} isVirtual={isVirtual} />
    </button>
  )
}

function RightChip({
  tier,
  selected,
  locked,
  isVirtual,
}: {
  tier: AIModelTier
  selected: boolean
  locked?: boolean
  isVirtual?: boolean
}) {
  // Virtual rows (Turbo) win the chip slot regardless of tier/selected
  // state — the ⚡ badge is the whole point of the row.
  if (isVirtual) {
    return (
      <span className="flex items-center gap-1 rounded-md bg-text-primary/20 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-text-primary">
        <Zap className="h-3 w-3" strokeWidth={3} />
        турбо
      </span>
    )
  }
  if (tier === 'premium') {
    return (
      <span
        className={cn(
          'rounded-md px-2 py-0.5 font-mono text-[10px] font-bold uppercase',
          locked ? 'bg-warn/15 text-warn' : 'bg-warn/20 text-warn',
        )}
      >
        💎 premium
      </span>
    )
  }
  if (selected) {
    return <Check className="h-4 w-4 text-text-primary" strokeWidth={3} />
  }
  return <span className="font-mono text-[10px] text-text-muted">free</span>
}

// PremiumUpgradeHint — companion banner shown once below the locked rows
// when the user is on free tier. Single inline upgrade affordance (per
// design-review #2): "all locked rows act as previews; upgrade lives here".
//
// Wave-11: «Подключить →» теперь ведёт на /pricing (раньше был no-op /
// optional-callback, что нарушало anti-fallback rule «не запирай фичу без
// показа цены»). Если parent передаст onUpgrade — он вызовется ДО
// навигации (полезно, например, чтобы залогировать impression).
export function PremiumUpgradeHint({ onUpgrade }: { onUpgrade?: () => void }) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-md border border-warn/25 bg-warn/[0.04] px-4 py-2.5">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-warn">
        💎 premium-модели
      </span>
      <span className="text-[12px] text-text-secondary">
        GPT-4o, Claude Sonnet 4, Gemini Pro
      </span>
      <a
        href="/pricing"
        onClick={() => {
          if (onUpgrade) onUpgrade()
        }}
        className="ml-auto text-[12px] font-semibold text-warn hover:underline"
      >
        Подключить →
      </a>
    </div>
  )
}
