// WAVE-13 IA refactor — segmented control at the top of /codex.
// Podcasts moved to Hone (P hotkey, bible §2.1), so the strip currently
// only shows "Статьи". Kept as a component so additional knowledge
// surfaces can re-join later without re-introducing the dead /podcasts
// link.

import { Link } from 'react-router-dom'
import { cn } from '../lib/cn'

export type KnowledgeTab = 'articles'

export function KnowledgeHubTabs({ active }: { active: KnowledgeTab }) {
  const items: { key: KnowledgeTab; to: string; label: string }[] = [
    { key: 'articles', to: '/codex', label: 'Статьи' },
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
