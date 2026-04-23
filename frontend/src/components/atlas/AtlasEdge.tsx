// AtlasEdge — renders ONE skill-tree connection inside the SVG canvas
// (Wave-10 design-review v2 Snippet 2).
//
// 3 canonical kinds — never more (per _rules.md "3 pill / 3 edge / 3 X"
// canon). Adding a 4th means you're sneaking semantics in through the
// stroke; flag it in review instead.
//
//   prereq    — solid thick + arrow. Gates allocation.
//                When BOTH endpoints mastered → bright success-green
//                (visual "paid path"). Otherwise neutral grey.
//   suggested — solid thin cyan. "Logical next step", non-blocking.
//   crosslink — dashed faded grey. "Related from another cluster".
//
// Allocated-path glow: when both endpoints are mastered AND kind=prereq,
// stroke is brightened to convey "you walked this path". This is the PoE
// allocation-thread.

import { memo } from 'react'
import {
  type AtlasEdgeKind,
  type AtlasNodeKind,
  type AtlasNodeState,
  DEFS_IDS,
  NODE_RADIUS,
  shortenedSegment,
} from './atlasTokens'

export type AtlasEdgeProps = {
  from: { x: number; y: number; kind: AtlasNodeKind; state: AtlasNodeState }
  to: { x: number; y: number; kind: AtlasNodeKind; state: AtlasNodeState }
  kind: AtlasEdgeKind
}

export const AtlasEdge = memo(function AtlasEdge({ from, to, kind }: AtlasEdgeProps) {
  const seg = shortenedSegment(
    from,
    to,
    NODE_RADIUS[from.kind] + 2,
    NODE_RADIUS[to.kind] + 2,
  )
  if (!seg) return null

  const bothMastered = from.state === 'mastered' && to.state === 'mastered'
  const withArrow = kind === 'prereq'

  let stroke: string
  let width: number
  let dash: string | undefined
  let opacity: number

  switch (kind) {
    case 'prereq':
      stroke = bothMastered ? 'rgb(16,185,129)' : 'rgb(192,192,192)'
      width = 2
      dash = undefined
      opacity = bothMastered ? 0.95 : 0.55
      break
    case 'suggested':
      stroke = 'rgb(34,211,238)'
      width = 1
      dash = undefined
      opacity = 0.5
      break
    case 'crosslink':
    default:
      stroke = 'rgb(138,138,158)'
      width = 1
      dash = '2 4'
      opacity = 0.35
      break
  }

  return (
    <line
      x1={seg.x1}
      y1={seg.y1}
      x2={seg.x2}
      y2={seg.y2}
      stroke={stroke}
      strokeWidth={width}
      strokeDasharray={dash}
      opacity={opacity}
      markerEnd={withArrow ? `url(#${DEFS_IDS.arrowMarker})` : undefined}
    />
  )
})
