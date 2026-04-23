// AtlasHub — the character/focus-class center node (Wave-10 design-review
// v2 diff #3). Replaces the v1 "druz9 sigil" that looked orphaned — the
// hub now carries the class name + tier explicitly, making obvious that
// it is YOUR node, not product branding.
//
// Why a dedicated component instead of routing through <AtlasNode>:
//   - dimensionally bigger (88px vs 16/8)
//   - multi-layer (bevel + core + orbital-ring + label) — AtlasNode is a
//     single circle discipline
//   - purple-violet radial gradient fill is the product hero-moment; not
//     something we want to parameterise into AtlasNode's state switch.

import { memo } from 'react'
import { DEFS_IDS } from './atlasTokens'

export type AtlasHubProps = {
  cx: number
  cy: number
  /** Character class or focus name, e.g. "Go-инженер". */
  className: string
  /** Tier badge under the class name, e.g. "GOLD II · 2412". */
  tier: string
  onClick?: () => void
}

export const AtlasHub = memo(function AtlasHub({ cx, cy, className, tier, onClick }: AtlasHubProps) {
  const r = 32

  return (
    <g
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      <title>{`${className} · ${tier}`}</title>

      {/* Soft outer glow — signals "this is the center of gravity" */}
      <circle cx={cx} cy={cy} r={r + 16} fill="rgba(88,44,255,0.12)" />
      <circle cx={cx} cy={cy} r={r + 8} fill="rgba(88,44,255,0.2)" />

      {/* Orbital ring — 2px accent line evoking the PoE class-circle */}
      <circle
        cx={cx}
        cy={cy}
        r={r + 4}
        fill="none"
        stroke="rgb(88,44,255)"
        strokeWidth={2}
        opacity={0.7}
      />

      {/* Core circle — uses the hubCore radial gradient defined in <AtlasDefs /> */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${DEFS_IDS.hubCore})`} stroke="rgb(167,139,250)" strokeWidth={1.5} />

      {/* Subtle bevel highlight for depth — upper-left sheen */}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${DEFS_IDS.nodeBevel})`} />

      {/* Labels: class name + tier. We use SVG <text> so the label participates
          in pan/zoom transforms. The font comes from inherited body CSS. */}
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        fontFamily="Geist, Inter, sans-serif"
        fontSize={13}
        fontWeight={700}
        fill="white"
      >
        {className}
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        fontFamily="Geist Mono, monospace"
        fontSize={9}
        fill="rgba(255,255,255,0.75)"
      >
        {tier}
      </text>
    </g>
  )
})
