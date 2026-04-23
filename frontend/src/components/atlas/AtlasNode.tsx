// AtlasNode — renders ONE skill node inside the SVG canvas (Wave-10 PoE
// passive-tree, design-review v2 Snippet 1 + v3 PoE polish).
//
// Visual grammar by kind:
//   hub      — see <AtlasHub />, dispatched separately by AtlasCanvas
//   keystone — see <AtlasKeystone />, diamond shape, dispatched separately
//   notable  — sigil-framed circle, cluster-colour fill, white ✓ if mastered
//   small    — simple disk, cluster-coloured stroke, fill by state
//
// Visual grammar by state (orthogonal to kind):
//   mastered    — solid cluster-colour fill + white ✓
//   active      — solid fill at /85 alpha
//   decaying    — pulsing warn ring around the node (same kind glyph inside)
//   not_started — hollow with cluster-colour stroke
//   locked      — hollow with dashed bg-2 stroke + lock glyph (NEVER opacity-50)
//
// Hover/select are deliberately routed through DIFFERENT visual channels
// (per design-review v2 P0 #4): hover = transform scale; selected = ring.
// They don't fight each other at any state.

import { memo } from 'react'
import {
  type AtlasNodeKind,
  type AtlasNodeState,
  NODE_RADIUS,
  clusterColor,
} from './atlasTokens'

export type AtlasNodeProps = {
  x: number
  y: number
  kind: AtlasNodeKind
  state: AtlasNodeState
  cluster: string
  /** When true, draws the selection ring (channel = ring, not transform). */
  selected?: boolean
  /** Optional ARIA + click handler. Pass undefined for purely-decorative nodes. */
  onClick?: () => void
  /** Inline title for accessible tooltip (browser-native; we don't ship tooltips for SVG). */
  title?: string
}

export const AtlasNode = memo(function AtlasNode({
  x,
  y,
  kind,
  state,
  cluster,
  selected,
  onClick,
  title,
}: AtlasNodeProps) {
  // Hub & keystone have their own dispatchers — caller should route there.
  // We still render small/notable here.
  if (kind === 'hub' || kind === 'keystone') {
    return null
  }

  const c = clusterColor(cluster)
  const r = NODE_RADIUS[kind]

  // State → fill / stroke / dash. Locked uses dashes, not opacity-50.
  const fill = (() => {
    if (state === 'locked') return 'rgb(20,20,37)' // surface-1
    if (state === 'mastered') return c
    if (state === 'active') return `${c}D9` // ~85% alpha hex
    if (state === 'decaying') return `${c}99` // ~60%
    return 'rgb(20,20,37)' // not_started
  })()
  const stroke = state === 'locked' ? 'rgb(42,42,63)' : c
  const dash = state === 'locked' ? '3 3' : undefined

  const interactive = Boolean(onClick)

  return (
    <g
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      className={interactive ? 'atlas-node atlas-node--interactive' : 'atlas-node'}
      style={{ cursor: interactive ? 'pointer' : 'default' }}
    >
      {title && <title>{title}</title>}

      {/* Decay pulse — separate ring so it doesn't fight selection ring */}
      {state === 'decaying' && (
        <circle cx={x} cy={y} r={r + 4} fill="none" stroke="rgb(251,191,36)" strokeWidth={1.5} opacity={0.6}>
          <animate attributeName="r" values={`${r + 4};${r + 8};${r + 4}`} dur="1.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.6;0.1;0.6" dur="1.8s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Selection ring — accent, distinct channel from hover scale */}
      {selected && (
        <circle cx={x} cy={y} r={r + 6} fill="none" stroke="rgb(88,44,255)" strokeWidth={3} />
      )}

      {/* Notable kind: sigil-frame ring around the node so it reads as milestone */}
      {kind === 'notable' && (
        <circle cx={x} cy={y} r={r + 3} fill="none" stroke={c} strokeWidth={1} opacity={0.5} />
      )}

      {/* The body */}
      <circle
        cx={x}
        cy={y}
        r={r}
        fill={fill}
        stroke={stroke}
        strokeWidth={kind === 'notable' ? 2 : 1.5}
        strokeDasharray={dash}
      />

      {/* Mastered ✓ */}
      {state === 'mastered' && (
        <path
          d={`M${x - 5},${y} l3.5,3.5 l6.5,-7`}
          fill="none"
          stroke="white"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      )}

      {/* Locked padlock glyph — replaces "opacity-50 disabled" anti-pattern */}
      {state === 'locked' && (
        <g transform={`translate(${x - 4.5} ${y - 5.5})`}>
          <rect x={0} y={4} width={9} height={7} rx={1.2} fill="rgb(42,42,63)" />
          <path
            d="M1.5,4 V2.5 A3,3 0 0 1 7.5,2.5 V4"
            fill="none"
            stroke="rgb(42,42,63)"
            strokeWidth={1.4}
          />
        </g>
      )}
    </g>
  )
})
