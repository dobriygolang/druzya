// AtlasDefs — all SVG <defs> needed by the atlas canvas in one place.
// Rendered once at the top of the <svg> by AtlasCanvas; every child
// component references by url(#id). Changing a gradient or filter is
// localised here.
//
// Gradients:
//   hubCore   — the character-class violet radial fill (bright centre,
//               dark rim) that sells the hub as a "core of gravity".
//   nodeBevel — upper-left sheen overlay applied on top of hub fills to
//               evoke 3D depth without actually being 3D.
//
// Filter:
//   pathGlow — subtle white-bloom for the allocated-path stroke. Only
//               attached to edges when both endpoints are mastered.
//
// Marker:
//   atlas-arrow — arrowhead for prereq edges. Other kinds go arrow-less.

import { memo } from 'react'
import { DEFS_IDS } from './atlasTokens'

export const AtlasDefs = memo(function AtlasDefs() {
  return (
    <defs>
      {/* Hub core gradient — violet from centre, deep purple at rim */}
      <radialGradient id={DEFS_IDS.hubCore} cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#E9D5FF" />
        <stop offset="40%" stopColor="#FFFFFF" />
        <stop offset="100%" stopColor="#3B0764" />
      </radialGradient>

      {/* Upper-left sheen for depth — works on any fill underneath */}
      <radialGradient id={DEFS_IDS.nodeBevel} cx="30%" cy="30%" r="70%">
        <stop offset="0%" stopColor="rgba(255,255,255,0.25)" />
        <stop offset="60%" stopColor="rgba(255,255,255,0)" />
      </radialGradient>

      {/* Allocated-path glow — soft blur halo */}
      <filter id={DEFS_IDS.pathGlow} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      {/* Arrow marker — used only for prereq edges */}
      <marker
        id={DEFS_IDS.arrowMarker}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="5"
        markerHeight="5"
        orient="auto-start-reverse"
      >
        <path d="M0,0 L10,5 L0,10 Z" fill="rgb(192,192,192)" />
      </marker>
    </defs>
  )
})
