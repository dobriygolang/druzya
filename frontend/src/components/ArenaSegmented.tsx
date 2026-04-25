// WAVE-13 IA refactor — shared segmented control rendered at the top of
// /arena and /arena/kata. Lets the user toggle between two surfaces of
// the same "solve problems" namespace:
//   - "Поединки"  → /arena      (modes / matchmaking)
//   - "Daily kata" → /arena/kata (today's algorithmic problem; ex /daily)
//
// Plain link-based buttons (no client-side state) — react-router handles
// the active state via the `active` prop the parent passes in.

import { Link } from 'react-router-dom'
import { cn } from '../lib/cn'

export type ArenaSegment = 'modes' | 'kata'

export function ArenaSegmented({ active }: { active: ArenaSegment }) {
  const items: { key: ArenaSegment; to: string; label: string }[] = [
    { key: 'modes', to: '/arena', label: 'Поединки' },
    { key: 'kata', to: '/arena/kata', label: 'Daily kata' },
  ]
  return (
    <div className="flex h-[48px] items-center gap-1 overflow-x-auto border-b border-border bg-bg px-4 sm:px-8 lg:px-20">
      {items.map((it) => {
        const isActive = it.key === active
        return (
          <Link
            key={it.key}
            to={it.to}
            className={cn(
              'relative flex h-full items-center px-4 text-sm font-semibold transition-colors',
              isActive
                ? 'text-text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-text-primary'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {it.label}
          </Link>
        )
      })}
    </div>
  )
}
