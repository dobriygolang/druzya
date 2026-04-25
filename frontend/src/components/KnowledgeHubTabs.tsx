// WAVE-13 IA refactor — shared segmented control rendered at the top of
// /codex and /podcasts. Header now exposes a single "Кодекс" entry; the
// tab strip below routes between two flavours of the same "knowledge
// content" surface:
//   - "Статьи"   → /codex     (curated articles / refs)
//   - "Подкасты" → /podcasts  (audio episodes)

import { Link } from 'react-router-dom'
import { cn } from '../lib/cn'

export type KnowledgeTab = 'articles' | 'podcasts'

export function KnowledgeHubTabs({ active }: { active: KnowledgeTab }) {
  const items: { key: KnowledgeTab; to: string; label: string }[] = [
    { key: 'articles', to: '/codex', label: 'Статьи' },
    { key: 'podcasts', to: '/podcasts', label: 'Подкасты' },
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
