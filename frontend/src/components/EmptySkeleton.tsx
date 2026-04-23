// EmptySkeleton — layout-aware loading skeletons (Wave-10, design-review v3 B.3).
//
// Why layout-aware vs generic spinner: generic spinner causes a layout
// shift the moment data lands ("CLS" in web-vitals). Skeleton mimics the
// page's actual structure so when data appears, nothing jumps.
//
// 4 layouts cover ~95% of our pages — see B.4 cheat-sheet for which
// route uses which:
//   card-grid   → /cohorts /podcasts /achievements (3-col grid of cards)
//   table       → /matches /leaderboard /history (rows w/ avatar + label)
//   split-view  → /arena/match (problem on left, editor on right)
//   single-card → /settings /profile (form-shaped centered card)
//
// Shimmer animation is defined in tailwind.config.ts via keyframes; the
// fallback gradient still reads as "loading" if shimmer is disabled
// (prefers-reduced-motion friendly — animation is purely cosmetic).

import { cn } from '../lib/cn'

export type SkeletonLayout = 'card-grid' | 'table' | 'split-view' | 'single-card'

function Bar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded bg-gradient-to-r from-surface-1 via-surface-2 to-surface-1 bg-[length:800px_100%] animate-[shimmer_1.6s_linear_infinite] motion-reduce:animate-none',
        className,
      )}
    />
  )
}

export function EmptySkeleton({ layout }: { layout: SkeletonLayout }) {
  if (layout === 'card-grid') {
    return (
      <div className="p-5" role="status" aria-busy="true" aria-label="Загрузка">
        <Bar className="h-7 w-48 mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <Bar className="h-24 mb-2" />
              <Bar className="h-3 w-3/4 mb-1" />
              <Bar className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (layout === 'table') {
    return (
      <div className="p-5" role="status" aria-busy="true" aria-label="Загрузка">
        <Bar className="h-5 w-40 mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Bar className="h-8 w-8 rounded-full" />
              <Bar className="h-4 flex-1" />
              <Bar className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (layout === 'split-view') {
    return (
      <div className="p-5 grid grid-cols-5 gap-3" role="status" aria-busy="true" aria-label="Загрузка">
        <div className="col-span-5 md:col-span-2">
          <Bar className="h-5 w-24 mb-2" />
          <Bar className="h-64" />
        </div>
        <div className="col-span-5 md:col-span-3">
          <Bar className="h-5 w-32 mb-2" />
          <Bar className="h-64" />
        </div>
      </div>
    )
  }
  // single-card
  return (
    <div className="p-5 max-w-[520px] mx-auto" role="status" aria-busy="true" aria-label="Загрузка">
      <Bar className="h-7 w-36 mb-4" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <Bar className="h-3 w-20 mb-1.5" />
            <Bar className="h-9" />
          </div>
        ))}
      </div>
    </div>
  )
}
