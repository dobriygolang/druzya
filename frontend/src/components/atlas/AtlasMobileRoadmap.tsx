// AtlasMobileRoadmap — vertical roadmap fallback for ≤640px viewports
// (Wave-10, design-review v2 mobile-metaphor section; WAVE-11 polish per
// at-app.jsx — search bar + cluster ring + segment bar + tablet 2-col).
//
// Background: a 1400×1400 PoE canvas does NOT work on a 320px screen.
// Pinch-zoom is brittle, labels collide, the cluster auras turn into
// muddy blobs. The design-review verdict: "не таскай канвас на mobile —
// замени метафорой". Vertical roadmap is that metaphor.
//
// WAVE-11 additions per at-app.jsx:
//   - sticky topbar with search field (mobile) / right-aligned search (tablet);
//   - cluster headers carry a ProgressRing + segment-bar instead of "5/8" text;
//   - tablet (≥768px) uses a 2-col split (1.3fr list + 1fr canvas placeholder);
//   - locked = lock-icon + muted title (NEVER opacity-50 on the whole row).
//
// Layout:
//   ┌─────────────────────────┐
//   │  search · sticky        │
//   │  HUB · class · CTA      │
//   ├─────────────────────────┤
//   │  ◐ Algorithms · 5/8     │  ← ProgressRing + segment-bar
//   │     ◇ DFS / BFS         │
//   ├─────────────────────────┤
//
// Each cluster section is collapsible; tapping a node fires onSelectNode
// (parent opens the same drawer it would on desktop, or AtlasNodeBottomSheet
// on mobile).

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Lock, Maximize2, Search, X } from 'lucide-react'
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

// ProgressRing — used in cluster header. SVG ring + done/total in the
// middle. Matches at-app.jsx ProgressRing visually (tone-aware stroke).
function ProgressRing({
  done,
  total,
  size = 32,
  color,
}: {
  done: number
  total: number
  size?: number
  color: string
}) {
  const r = (size - 4) / 2
  const c = 2 * Math.PI * r
  const pct = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(42,42,63)" strokeWidth={2} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray={c}
          strokeDashoffset={c - c * pct}
          strokeLinecap="round"
        />
      </svg>
      <div
        className="absolute font-mono text-[9px] font-bold tabular-nums"
        style={{ color }}
      >
        {done}
        <span className="text-text-muted">/{total}</span>
      </div>
    </div>
  )
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

// Locked check — the AtlasNode type doesn't carry a `reachable` flag so we
// derive locked from `unlocked === false`. Matches the radial canvas
// `nodeState()` "locked" branch.
function isLocked(n: AtlasNode): boolean {
  return n.unlocked === false
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
  const [query, setQuery] = useState('')

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

  const totalNodes = useMemo(
    () => nodes.filter((n) => n.kind !== 'hub' && n.key !== centerNodeKey).length,
    [nodes, centerNodeKey],
  )
  const masteredNodes = useMemo(
    () => nodes.filter((n) => n.kind !== 'hub' && (n.progress ?? 0) >= 100).length,
    [nodes],
  )

  // Search filter — case-insensitive title contains. Empty query = no filter.
  const q = query.trim().toLowerCase()
  const filteredKeys = useMemo<Set<string> | null>(() => {
    if (!q) return null
    const s = new Set<string>()
    for (const n of nodes) if (n.title.toLowerCase().includes(q)) s.add(n.key)
    return s
  }, [nodes, q])

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
    <div className="flex flex-col">
      {/* Sticky topbar with search · per at-app.jsx · mobile-only */}
      <div className="sticky top-0 z-20 space-y-2 border-b border-border/60 bg-bg/90 px-3 py-2.5 backdrop-blur">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-[17px] font-extrabold text-text-primary">Atlas</h1>
          <span className="font-mono text-[10px] text-text-muted">
            {masteredNodes}/{totalNodes}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent font-mono text-[11px] text-text-primary outline-none placeholder:text-text-muted"
            placeholder="поиск по ноде…"
            aria-label="Поиск по ноде"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-text-muted hover:text-text-primary"
              aria-label="Очистить"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Tablet split: list (left) + canvas placeholder (right) per at-app.jsx 768.
          Mobile (<768): single column. We use Tailwind `md:` breakpoints. */}
      <div className="grid gap-3 px-3 py-3 md:grid-cols-[1.3fr_1fr]">
        <div className="flex flex-col gap-3">
          {/* Hub card */}
          <div
            className="relative overflow-hidden rounded-2xl border border-border-strong bg-gradient-to-br from-accent/15 via-accent/5 to-surface-1 p-4"
            role="region"
            aria-label="Класс"
          >
            <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-text-primary/10 blur-3xl pointer-events-none" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-primary">
                  ◆ твой atlas
                </span>
                {userTier && (
                  <span className="font-mono text-[10px] text-text-muted">{userTier}</span>
                )}
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div>
                  <h2 className="font-display text-[22px] font-extrabold leading-[0.95] text-text-primary">
                    {masteredNodes}
                    <span className="text-text-muted">/{totalNodes}</span>
                  </h2>
                  <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
                    {userClassName}
                  </div>
                </div>
                <ProgressRing
                  done={masteredNodes}
                  total={Math.max(1, totalNodes)}
                  size={48}
                  color="#FFFFFF"
                />
              </div>
              {onOpenFullMap && (
                <button
                  type="button"
                  onClick={onOpenFullMap}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-text-primary px-3 py-2.5 font-display text-[13px] font-extrabold text-bg hover:bg-text-primary-hover"
                >
                  <Maximize2 className="h-3.5 w-3.5" /> Полная карта
                </button>
              )}
              <div className="mt-1.5 text-center font-mono text-[9px] text-text-muted">
                pinch · drag · tap на ноду
              </div>
            </div>
          </div>

          {/* Cluster sections */}
          {grouped.map(({ cluster, nodes: clusterNodes }) => {
            const isCollapsed = collapsed.has(cluster)
            const mastered = clusterNodes.filter((n) => (n.progress ?? 0) >= 100).length
            const total = clusterNodes.length
            const c = clusterColor(cluster)
            // If user is searching, hide clusters with zero matches and
            // auto-expand those with matches so results aren't behind a
            // closed accordion.
            const visibleNodes = filteredKeys
              ? clusterNodes.filter((n) => filteredKeys.has(n.key))
              : clusterNodes
            if (filteredKeys && visibleNodes.length === 0) return null
            const effectivelyOpen = filteredKeys ? true : !isCollapsed
            return (
              <section
                key={cluster}
                className="overflow-hidden rounded-xl border border-border bg-surface-1"
              >
                <button
                  type="button"
                  onClick={() => toggle(cluster)}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-2"
                  aria-expanded={effectivelyOpen}
                  aria-controls={`cluster-${cluster}`}
                >
                  <ProgressRing done={mastered} total={Math.max(1, total)} size={32} color={c} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span
                        className="truncate font-display text-[13px] font-bold"
                        style={{ color: c }}
                      >
                        {clusterLabel(cluster)}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">
                        {mastered === total && total > 0
                          ? 'complete'
                          : mastered > 0
                            ? 'в процессе'
                            : 'старт'}
                      </span>
                    </div>
                    {/* Segment bar — one tick per node, filled = mastered.
                        Visual replacement for "5/8" text per at-app.jsx. */}
                    <div className="mt-1 flex h-[3px] items-center gap-1.5">
                      {Array.from({ length: total }).map((_, i) => (
                        <span
                          key={i}
                          className="h-full flex-1 rounded-full"
                          style={{ backgroundColor: i < mastered ? c : 'rgb(42,42,63)' }}
                        />
                      ))}
                    </div>
                  </div>
                  {isCollapsed && !filteredKeys ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />
                  )}
                </button>
                {effectivelyOpen && (
                  <ul id={`cluster-${cluster}`} className="divide-y divide-border border-t border-border">
                    {visibleNodes.map((n) => {
                      const kind = normaliseKind(n.kind)
                      const locked = isLocked(n)
                      const isSelected = selectedKey === n.key
                      const isMastered = (n.progress ?? 0) >= 100
                      return (
                        <li key={n.key}>
                          <button
                            type="button"
                            onClick={() => !locked && onSelectNode?.(n.key)}
                            disabled={locked}
                            className={cn(
                              'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                              isSelected && 'bg-text-primary/10',
                              locked
                                ? 'cursor-not-allowed'
                                : 'hover:bg-surface-2',
                            )}
                            aria-current={isSelected ? 'true' : undefined}
                            aria-disabled={locked || undefined}
                          >
                            <NodeGlyph kind={kind} locked={locked} color={c} />
                            <div className="min-w-0 flex-1">
                              <div
                                className={cn(
                                  'truncate font-display text-[12.5px] font-semibold',
                                  locked ? 'text-text-muted' : 'text-text-primary',
                                )}
                              >
                                {n.title}
                              </div>
                              <div className="truncate font-mono text-[10px] text-text-muted">
                                {locked
                                  ? 'требует prereq'
                                  : isMastered
                                    ? 'mastered'
                                    : (n.progress ?? 0) > 0
                                      ? `progress · ${n.progress ?? 0}%`
                                      : 'готово к прокачке'}
                              </div>
                            </div>
                            {!locked && (
                              <span
                                className={cn(
                                  'shrink-0 font-mono text-[10px]',
                                  isMastered ? 'text-success' : 'text-text-muted',
                                )}
                              >
                                {isMastered ? '✓' : `${n.progress ?? 0}%`}
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

        {/* Right column: tablet only — shown ≥768px. Hidden on phones.
            Renders a static SVG hint — full canvas lives in the fullscreen
            modal (mobile UX never embeds the 1400x1400 canvas inline). */}
        {onOpenFullMap && (
          <aside className="hidden md:flex md:flex-col md:rounded-xl md:border md:border-border md:bg-surface-1">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary">
                ◆ preview
              </span>
              <button
                type="button"
                onClick={onOpenFullMap}
                className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:text-text-secondary/80"
              >
                <Maximize2 className="h-3 w-3" /> fullscreen
              </button>
            </div>
            <div
              className="flex-1 min-h-[280px]"
              style={{
                background:
                  'radial-gradient(circle at 50% 50%, rgba(34,211,238,0.06) 0%, rgba(10,10,15,0) 60%)',
              }}
            >
              <div className="grid h-full place-items-center px-6 text-center">
                <div className="space-y-2">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                    карта
                  </div>
                  <p className="font-display text-[12.5px] text-text-secondary">
                    Tap «Полная карта» для интерактивного дерева с pinch-zoom.
                  </p>
                </div>
              </div>
            </div>
            <div className="border-t border-border px-4 py-2.5 font-mono text-[10px] text-text-muted">
              {totalNodes} нод · {grouped.length} кластеров
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
