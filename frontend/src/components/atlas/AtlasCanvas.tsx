// AtlasCanvas — the new PoE-passive-tree SVG canvas (Wave-10, design-review
// v2 v3). Composes <AtlasHub /> + <AtlasKeystone /> + <AtlasNode /> +
// <AtlasEdge /> + <AtlasClusterAura /> + labels + onboarding-beacon.
//
// Replaces the inline <svg> block in AtlasPage.tsx while keeping the
// surrounding page chrome (drawer, pan/zoom, list mode, mobile fallback)
// untouched. Wired via a feature-flag inside AtlasPage so the old render
// remains available during the transition.
//
// API:
//   <AtlasCanvas
//     nodes={atlas.nodes}
//     edges={atlas.edges}
//     centerNodeKey={atlas.center_node}
//     selectedKey={...}
//     onSelectNode={...}
//     userClassName?: string   // shown inside hub; "Ядро класса" fallback
//     userTier?: string        // "GOLD II · 2412"
//   />
//
// The component is "read-only": pan/zoom + selection come from the parent
// so the outside world still owns the interaction state.

import { useMemo } from 'react'
import type { AtlasNode as AtlasNodeData } from '../../lib/queries/profile'
import { AtlasDefs } from './AtlasDefs'
import { AtlasHub } from './AtlasHub'
import { AtlasKeystone } from './AtlasKeystone'
import { AtlasNode } from './AtlasNode'
import { AtlasEdge } from './AtlasEdge'
import { clusterColor, type AtlasNodeKind, type AtlasNodeState, type AtlasEdgeKind } from './atlasTokens'
import { ATLAS_VIEWBOX, labelFor, layoutAtlas, type LaidNode } from './layout'

export type AtlasCanvasProps = {
  nodes: AtlasNodeData[]
  edges: { from: string; to: string; kind?: string }[]
  centerNodeKey: string
  selectedKey?: string | null
  onSelectNode?: (key: string) => void
  /** Shown inside the hub; product default is the owner's focus-class. */
  userClassName?: string
  userTier?: string
}

// Normalises the backend kind — migration grace period accepts legacy
// values from v1 deployments until they're backfilled.
function normaliseKind(kind: string): AtlasNodeKind {
  switch (kind) {
    case 'hub':
    case 'keystone':
    case 'notable':
    case 'small':
      return kind
    // Legacy (pre-00034) → best-effort mapping
    case 'center':
      return 'hub'
    case 'ascendant':
      return 'keystone'
    case 'normal':
      return 'small'
    default:
      return 'small'
  }
}

function normaliseEdgeKind(kind: string | undefined): AtlasEdgeKind {
  if (kind === 'suggested' || kind === 'crosslink') return kind
  return 'prereq'
}

// Derive the visual state from backend fields. PoE allocation: a node is
// "reachable" if there's a path of mastered nodes from the hub. Unreachable
// nodes render as `locked` (with a padlock glyph, not opacity-50).
function deriveState(n: AtlasNodeData): AtlasNodeState {
  if (n.reachable === false) return 'locked'
  if (n.decaying) return 'decaying'
  if ((n.progress ?? 0) >= 100) return 'mastered'
  if (n.unlocked || (n.progress ?? 0) > 0) return 'active'
  return 'not_started'
}

// Cluster auras — one soft radial glow per cluster, placed at the cluster
// centroid. Rendered before nodes/edges so they sit at the bottom of the
// z-order. Gives the PoE "region" feeling.
function ClusterAura({ cx, cy, radius, color }: { cx: number; cy: number; radius: number; color: string }) {
  // Pure inline gradient — avoids collision with dynamically-generated
  // <defs> ids when a parent already declares its own gradient set.
  return (
    <circle
      cx={cx}
      cy={cy}
      r={radius}
      fill={color}
      opacity={0.12}
      style={{ filter: 'blur(40px)' }}
    />
  )
}

export function AtlasCanvas({
  nodes,
  edges,
  centerNodeKey,
  selectedKey,
  onSelectNode,
  userClassName = 'Ядро класса',
  userTier = '',
}: AtlasCanvasProps) {
  // Layout pass — puts (x, y) on every node. Pinned coords from admin CMS
  // win; otherwise ring-fallback. Deterministic, same input → same output.
  const laid = useMemo(() => layoutAtlas(nodes), [nodes])
  const byKey = useMemo(() => {
    const m = new Map<string, LaidNode>()
    for (const n of laid) m.set(n.key, n)
    return m
  }, [laid])

  // Cluster centroids for aura placement.
  const clusterCentroids = useMemo(() => {
    const bucket = new Map<string, { sumX: number; sumY: number; count: number }>()
    for (const n of laid) {
      if (n.kind === 'hub' || !n.cluster) continue
      const b = bucket.get(n.cluster) ?? { sumX: 0, sumY: 0, count: 0 }
      b.sumX += n.x
      b.sumY += n.y
      b.count += 1
      bucket.set(n.cluster, b)
    }
    const out: { cluster: string; x: number; y: number }[] = []
    for (const [cluster, b] of bucket) {
      if (b.count === 0) continue
      out.push({ cluster, x: b.sumX / b.count, y: b.sumY / b.count })
    }
    return out
  }, [laid])

  // Onboarding beacon: highlight the 3 small nodes adjacent to the hub
  // when the user hasn't mastered anything yet. Pulses them (accent ring
  // + animate-pulse on CSS) without using opacity-50 on the rest.
  const masteredCount = useMemo(
    () => laid.filter((n) => (n.progress ?? 0) >= 100).length,
    [laid],
  )
  const beaconKeys = useMemo(() => {
    if (masteredCount > 0) return new Set<string>()
    // Nodes directly connected to hub by prereq edges.
    const set = new Set<string>()
    for (const e of edges) {
      const kind = normaliseEdgeKind(e.kind)
      if (kind !== 'prereq') continue
      if (e.from === centerNodeKey) set.add(e.to)
      if (e.to === centerNodeKey) set.add(e.from)
    }
    return set
  }, [edges, centerNodeKey, masteredCount])

  const hub = byKey.get(centerNodeKey)

  return (
    <svg viewBox={`0 0 ${ATLAS_VIEWBOX} ${ATLAS_VIEWBOX}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <AtlasDefs />

      {/* 1. Cluster auras at the bottom of the z-stack */}
      {clusterCentroids.map((c) => (
        <ClusterAura
          key={`aura-${c.cluster}`}
          cx={c.x}
          cy={c.y}
          radius={180}
          color={clusterColor(c.cluster)}
        />
      ))}

      {/* 2. Edges */}
      {edges.map((e, i) => {
        const from = byKey.get(e.from)
        const to = byKey.get(e.to)
        if (!from || !to) return null
        return (
          <AtlasEdge
            key={`edge-${e.from}-${e.to}-${i}`}
            from={{ x: from.x, y: from.y, kind: normaliseKind(from.kind), state: deriveState(from) }}
            to={{ x: to.x, y: to.y, kind: normaliseKind(to.kind), state: deriveState(to) }}
            kind={normaliseEdgeKind(e.kind)}
          />
        )
      })}

      {/* 3. Nodes — dispatched by kind to the right visual component */}
      {laid.map((n) => {
        const kind = normaliseKind(n.kind)
        const state = deriveState(n)
        const selected = selectedKey === n.key

        if (kind === 'hub') {
          // Hub is rendered separately below from the authoritative reference.
          return null
        }

        // Onboarding beacon ring (pulse) when user has 0 mastered and this
        // node is one of the 3 hub-adjacent starters. Separate visual
        // channel from selection — both can coexist.
        const isBeacon = beaconKeys.has(n.key)

        const body =
          kind === 'keystone' ? (
            <AtlasKeystone
              key={n.key}
              x={n.x}
              y={n.y}
              cluster={n.cluster ?? ''}
              state={state}
              selected={selected}
              onClick={onSelectNode ? () => onSelectNode(n.key) : undefined}
              title={n.title}
            />
          ) : (
            <AtlasNode
              key={n.key}
              x={n.x}
              y={n.y}
              kind={kind}
              state={state}
              cluster={n.cluster ?? ''}
              selected={selected}
              onClick={onSelectNode ? () => onSelectNode(n.key) : undefined}
              title={n.title}
            />
          )

        if (!isBeacon) return body

        return (
          <g key={`${n.key}-beacon`}>
            <circle cx={n.x} cy={n.y} r={22} fill="none" stroke="rgb(88,44,255)" strokeWidth={2} opacity={0.7}>
              <animate attributeName="r" values="22;30;22" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.7;0.2;0.7" dur="2s" repeatCount="indefinite" />
            </circle>
            {body}
          </g>
        )
      })}

      {/* 4. Labels — radially outward from centre so they never overlap edges */}
      {laid.map((n) => {
        if (n.kind === 'hub') return null
        const l = labelFor(n.x, n.y, n.kind === 'keystone' ? 28 : 22)
        return (
          <text
            key={`${n.key}-label`}
            x={l.x}
            y={l.y}
            textAnchor={l.anchor}
            fontFamily="Geist, Inter, sans-serif"
            fontSize={11}
            fontWeight={600}
            fill="rgb(192,192,192)"
            style={{ pointerEvents: 'none' }}
          >
            {n.title}
          </text>
        )
      })}

      {/* 5. Hub last — always on top of everything else */}
      {hub && (
        <AtlasHub
          cx={hub.x}
          cy={hub.y}
          className={hub.title || userClassName}
          tier={userTier}
          onClick={onSelectNode ? () => onSelectNode(hub.key) : undefined}
        />
      )}

      {/* 6. Onboarding copy near the hub — only when user has 0 mastered */}
      {masteredCount === 0 && hub && (
        <text
          x={hub.x}
          y={hub.y + 80}
          textAnchor="middle"
          fontFamily="Geist Mono, monospace"
          fontSize={12}
          fontWeight={600}
          fill="rgb(88,44,255)"
          style={{ pointerEvents: 'none' }}
        >
          Начни здесь ↓
        </text>
      )}
    </svg>
  )
}
