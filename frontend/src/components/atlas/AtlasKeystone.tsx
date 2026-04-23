// AtlasKeystone — cluster-signature node, rendered as a diamond (Wave-10).
//
// In PoE a keystone is the big centerpiece of a cluster — 1 per cluster,
// large impact. We render it as a rotated square (diamond) with the
// cluster colour fill. State (mastered / active / decaying / not_started /
// locked) maps to fill-saturation + glyph exactly like <AtlasNode>.
//
// Why a separate component: the diamond shape requires <path> + explicit
// geometry, vs AtlasNode's simple <circle>. Trying to fold both into
// AtlasNode would introduce a "shape" prop that fights the "kind" prop.

import { memo } from 'react'
import {
  type AtlasNodeState,
  clusterColor,
  NODE_RADIUS,
} from './atlasTokens'

export type AtlasKeystoneProps = {
  x: number
  y: number
  cluster: string
  state: AtlasNodeState
  selected?: boolean
  onClick?: () => void
  title?: string
}

export const AtlasKeystone = memo(function AtlasKeystone({
  x,
  y,
  cluster,
  state,
  selected,
  onClick,
  title,
}: AtlasKeystoneProps) {
  const c = clusterColor(cluster)
  const r = NODE_RADIUS.keystone
  // Diamond path: up, right, down, left, close.
  const d = `M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`

  const fill = (() => {
    if (state === 'locked') return 'rgb(20,20,37)'
    if (state === 'mastered') return c
    if (state === 'active') return `${c}D9`
    if (state === 'decaying') return `${c}99`
    return 'rgb(20,20,37)'
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
      className="atlas-keystone"
      style={{ cursor: interactive ? 'pointer' : 'default' }}
    >
      {title && <title>{title}</title>}

      {/* Decay pulse: outer diamond ring */}
      {state === 'decaying' && (
        <path
          d={`M ${x} ${y - r - 4} L ${x + r + 4} ${y} L ${x} ${y + r + 4} L ${x - r - 4} ${y} Z`}
          fill="none"
          stroke="rgb(251,191,36)"
          strokeWidth={1.5}
          opacity={0.6}
        >
          <animate
            attributeName="opacity"
            values="0.6;0.1;0.6"
            dur="1.8s"
            repeatCount="indefinite"
          />
        </path>
      )}

      {/* Selection ring — accent, bigger diamond outline */}
      {selected && (
        <path
          d={`M ${x} ${y - r - 6} L ${x + r + 6} ${y} L ${x} ${y + r + 6} L ${x - r - 6} ${y} Z`}
          fill="none"
          stroke="rgb(88,44,255)"
          strokeWidth={3}
        />
      )}

      <path d={d} fill={fill} stroke={stroke} strokeWidth={2} strokeDasharray={dash} strokeLinejoin="round" />

      {state === 'mastered' && (
        <path
          d={`M${x - 5},${y} l3.5,3.5 l6.5,-7`}
          fill="none"
          stroke="white"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      )}
      {state === 'locked' && (
        <g transform={`translate(${x - 4.5} ${y - 5.5})`}>
          <rect x={0} y={4} width={9} height={7} rx={1.2} fill="rgb(42,42,63)" />
          <path d="M1.5,4 V2.5 A3,3 0 0 1 7.5,2.5 V4" fill="none" stroke="rgb(42,42,63)" strokeWidth={1.4} />
        </g>
      )}
    </g>
  )
})
