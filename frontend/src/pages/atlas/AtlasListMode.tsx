// AtlasListMode — flat list rendering of the atlas (WAVE-11).
//
// An accessibility / quick-scan alternate to the radial canvas, primarily
// for keyboard users and small screens where the SVG tree is unwieldy.
// Reuses the same `nodeState`/`stateBadgeClass` helpers as the canvas so
// the badge palette stays consistent.
//
// Owner toggles between this and GraphCanvas via a "list/graph" button on
// the filter bar. Selecting a row emits the same onSelect event the canvas
// would on click → the same drawer opens.

import { useMemo } from 'react'
import type { Atlas, AtlasNode } from '../../lib/queries/profile'
import { cn } from '../../lib/cn'
import {
  STATE_LABEL,
  computePct,
  nodeState,
  sectionLabel,
  stateBadgeClass,
} from './AtlasCanvasLegacy'

export function AtlasListMode({
  atlas,
  selectedKey,
  onSelect,
  highlightKeys,
}: {
  atlas: Atlas
  selectedKey: string | null
  onSelect: (k: string) => void
  highlightKeys: Set<string> | null
}) {
  // Group by section then sort by state (mastered → in-progress → available
  // → decaying → locked) so the most relevant rows surface first.
  const grouped = useMemo(() => {
    const buckets = new Map<string, AtlasNode[]>()
    for (const n of atlas.nodes) {
      if (highlightKeys !== null && !highlightKeys.has(n.key)) continue
      const arr = buckets.get(n.section) ?? []
      arr.push(n)
      buckets.set(n.section, arr)
    }
    const stateOrder: Record<string, number> = {
      mastered: 0,
      in_progress: 1,
      available: 2,
      decaying: 3,
      locked: 4,
    }
    const sections = Array.from(buckets.keys()).sort()
    return sections.map((s) => {
      const arr = buckets.get(s) ?? []
      arr.sort((a, b) => {
        const sa = stateOrder[nodeState(a)] ?? 9
        const sb = stateOrder[nodeState(b)] ?? 9
        if (sa !== sb) return sa - sb
        return a.title.localeCompare(b.title, 'ru')
      })
      return { section: s, nodes: arr }
    })
  }, [atlas, highlightKeys])

  if (grouped.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg p-8">
        <p className="text-sm text-text-muted">Ничего не найдено по фильтрам.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-bg px-4 py-4 sm:px-8 lg:px-20">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {grouped.map(({ section, nodes }) => (
          <section
            key={section}
            className="overflow-hidden rounded-xl border border-border bg-surface-1"
          >
            <header className="border-b border-border px-4 py-2.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted">
                {sectionLabel(section)}
              </span>
              <span className="ml-2 font-mono text-[11px] text-text-muted">
                · {nodes.length}
              </span>
            </header>
            <ul className="divide-y divide-border">
              {nodes.map((n) => {
                const state = nodeState(n)
                const pct = computePct(n)
                const isSelected = selectedKey === n.key
                const isLocked = state === 'locked'
                return (
                  <li key={n.key}>
                    <button
                      type="button"
                      onClick={() => !isLocked && onSelect(n.key)}
                      disabled={isLocked}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                        isSelected && 'bg-text-primary/5',
                        isLocked ? 'cursor-not-allowed' : 'hover:bg-surface-2',
                      )}
                      aria-current={isSelected ? 'true' : undefined}
                      aria-disabled={isLocked || undefined}
                    >
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            'truncate font-display text-[13.5px] font-semibold',
                            isLocked ? 'text-text-muted' : 'text-text-primary',
                          )}
                        >
                          {n.title}
                        </div>
                        {n.description && (
                          <div className="mt-0.5 line-clamp-1 font-mono text-[11px] text-text-muted">
                            {n.description}
                          </div>
                        )}
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase',
                          stateBadgeClass(state),
                        )}
                      >
                        {STATE_LABEL[state]}
                      </span>
                      <span className="w-12 shrink-0 text-right font-mono text-[11px] text-text-secondary">
                        {pct === null ? '—' : `${pct}%`}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
