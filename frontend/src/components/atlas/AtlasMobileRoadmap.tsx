// AtlasMobileRoadmap — vertical roadmap fallback for ≤640px viewports
// (Wave-10, design-review v2 mobile-metaphor section).
//
// Background: a 1400×1400 PoE canvas does NOT work on a 320px screen.
// Pinch-zoom is brittle, labels collide, the cluster auras turn into
// muddy blobs. The design-review verdict: "не таскай канвас на mobile —
// замени метафорой". Vertical roadmap is that metaphor.
//
// Layout:
//   ┌─────────────────────────┐
//   │  HUB · Go-инженер       │   ← character class card
//   │  GOLD II · 2412         │
//   ├─────────────────────────┤
//   │  ▼ algorithms (3/8)     │   ← cluster section, accordion
//   │     ◇ algo_dp keystone  │     ↑ keystone first
//   │     ● algo_graphs       │     ↑ notable
//   │     · algo_basics       │     ↑ small (incremental)
//   ├─────────────────────────┤
//   │  ▼ system_design (1/4)  │
//   │     ...                 │
//   └─────────────────────────┘
//   ↗ полная карта (modal с обычным AtlasCanvas + native pinch-zoom)
//
// Each cluster section is collapsible; mastered count shows as "3/8".
// Tapping a node fires onSelectNode (parent opens the same drawer it
// would on desktop).

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Lock, Maximize2 } from 'lucide-react'
import type { AtlasNode } from '../../lib/queries/profile'
import { clusterColor, type AtlasNodeKind } from './atlasTokens'
import { cn } from '../../lib/cn'

export type AtlasMobileRoadmapProps = {
  nodes: AtlasNode[]
  centerNodeKey: string
  selectedKey?: string | null
  onSelectNode?: (key: string) => void
  /** Called when the user taps "↗ полная карта" — opens canvas modal. */
  onOpenFullMap?: () => void
  userClassName?: string
  userTier?: string
}

const CLUSTER_LABEL: Record<string, string> = {
  algorithms: 'Алгоритмы',
  algo: 'Алгоритмы',
  data_structures: 'Структуры данных',
  ds: 'Структуры данных',
  system_design: 'System Design',
  sysdes: 'System Design',
  sql: 'SQL',
  go: 'Go',
  backend: 'Backend',
  concurrency: 'Concurrency',
  behavioral: 'Behavioral',
}

function clusterLabel(c: string | undefined): string {
  if (!c) return 'Прочее'
  return CLUSTER_LABEL[c] ?? c
}

// Sort priority within a cluster: keystone first (signature), then notable,
// then small. PoE convention — the big stuff at the top of the section.
const KIND_PRIORITY: Record<string, number> = {
  keystone: 0,
  notable: 1,
  small: 2,
  hub: 3,
}

function normaliseKind(k: string): AtlasNodeKind {
  if (k === 'hub' || k === 'keystone' || k === 'notable' || k === 'small') return k
  if (k === 'center') return 'hub'
  if (k === 'ascendant') return 'keystone'
  if (k === 'normal') return 'small'
  return 'small'
}

// Glyph rendered to the LEFT of each row: diamond for keystone, sigil-circle
// for notable, dot for small. Locked → padlock (NEVER opacity-50).
function NodeGlyph({ kind, locked, color }: { kind: AtlasNodeKind; locked: boolean; color: string }) {
  if (locked) {
    return (
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-border bg-bg/60">
        <Lock className="h-3 w-3 text-text-muted" />
      </span>
    )
  }
  if (kind === 'keystone') {
    return (
      <svg width={20} height={20} viewBox="0 0 20 20" className="shrink-0">
        <path d="M10 2 L18 10 L10 18 L2 10 Z" fill={color} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
    )
  }
  if (kind === 'notable') {
    return (
      <svg width={20} height={20} viewBox="0 0 20 20" className="shrink-0">
        <circle cx={10} cy={10} r={8} fill={color} stroke={color} strokeWidth={1.5} />
        <circle cx={10} cy={10} r={5} fill="rgba(0,0,0,0.25)" />
      </svg>
    )
  }
  return (
    <span
      className="block h-3 w-3 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  )
}

export function AtlasMobileRoadmap({
  nodes,
  centerNodeKey,
  selectedKey,
  onSelectNode,
  onOpenFullMap,
  userClassName = 'Ядро класса',
  userTier = '',
}: AtlasMobileRoadmapProps) {
  // Group by cluster, hub goes into a header card not the list.
  const grouped = useMemo(() => {
    const buckets = new Map<string, AtlasNode[]>()
    for (const n of nodes) {
      if (n.key === centerNodeKey || n.kind === 'hub') continue
      const c = n.cluster ?? '__ungrouped__'
      const arr = buckets.get(c) ?? []
      arr.push(n)
      buckets.set(c, arr)
    }
    // Sort within each cluster by kind priority then title.
    const out: { cluster: string; nodes: AtlasNode[] }[] = []
    const sortedClusters = Array.from(buckets.keys()).sort()
    for (const c of sortedClusters) {
      const arr = buckets.get(c) ?? []
      arr.sort((a, b) => {
        const pa = KIND_PRIORITY[normaliseKind(a.kind)] ?? 99
        const pb = KIND_PRIORITY[normaliseKind(b.kind)] ?? 99
        if (pa !== pb) return pa - pb
        return a.title.localeCompare(b.title, 'ru')
      })
      out.push({ cluster: c, nodes: arr })
    }
    return out
  }, [nodes, centerNodeKey])

  // Open all clusters by default; user can collapse.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (c: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-4">
      {/* Hub card */}
      <div
        className="rounded-xl border border-accent/40 bg-gradient-to-br from-accent/15 via-surface-1 to-surface-1 p-4"
        role="region"
        aria-label="Класс"
      >
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-1">класс</div>
        <div className="font-display text-lg font-bold text-text-primary">{userClassName}</div>
        {userTier && (
          <div className="font-mono text-[11px] text-accent-hover mt-0.5">{userTier}</div>
        )}
      </div>

      {/* Open full map CTA */}
      {onOpenFullMap && (
        <button
          type="button"
          onClick={onOpenFullMap}
          className="flex items-center justify-center gap-2 rounded-md border border-border bg-surface-2 py-2.5 text-[12px] font-semibold text-text-secondary hover:bg-surface-3"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Полная карта
        </button>
      )}

      {/* Cluster sections */}
      {grouped.map(({ cluster, nodes: clusterNodes }) => {
        const isCollapsed = collapsed.has(cluster)
        const mastered = clusterNodes.filter((n) => (n.progress ?? 0) >= 100).length
        const c = clusterColor(cluster)
        return (
          <section key={cluster} className="rounded-xl border border-border bg-surface-1 overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(cluster)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-2"
              aria-expanded={!isCollapsed}
              aria-controls={`cluster-${cluster}`}
            >
              <div className="flex items-center gap-2">
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 text-text-muted" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-text-muted" />
                )}
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} />
                <span className="font-display text-[14px] font-bold text-text-primary">
                  {clusterLabel(cluster)}
                </span>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                {mastered}/{clusterNodes.length}
              </span>
            </button>
            {!isCollapsed && (
              <ul id={`cluster-${cluster}`} className="divide-y divide-border">
                {clusterNodes.map((n) => {
                  const kind = normaliseKind(n.kind)
                  const locked = n.reachable === false
                  const isSelected = selectedKey === n.key
                  const isMastered = (n.progress ?? 0) >= 100
                  return (
                    <li key={n.key}>
                      <button
                        type="button"
                        onClick={() => !locked && onSelectNode?.(n.key)}
                        disabled={locked}
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                          isSelected && 'bg-accent/10',
                          locked
                            ? 'cursor-not-allowed text-text-muted'
                            : 'hover:bg-surface-2',
                        )}
                        aria-current={isSelected ? 'true' : undefined}
                        aria-disabled={locked || undefined}
                      >
                        <NodeGlyph kind={kind} locked={locked} color={c} />
                        <span className="flex-1 truncate text-[13px] font-medium text-text-primary">
                          {n.title}
                        </span>
                        {!locked && (
                          <span
                            className={cn(
                              'font-mono text-[10px]',
                              isMastered ? 'text-success' : 'text-text-muted',
                            )}
                          >
                            {n.progress ?? 0}%
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
