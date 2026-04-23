// EmptyIllustration — geometric inline-SVG per EmptyState variant.
// Wave-10 (design-review v3 B.1/B.2). Anti-pattern recap: NO cute SaaS
// characters — only geometric shapes + cluster colour.
//
// Why inline SVG vs sprite/atlas: each illustration is ~10 lines, no
// network round-trip, easy to swap colour via CSS vars. The `<svg>`s use
// `currentColor`-friendly hex from our tokens — they don't theme-flip
// because we don't ship a light theme for these surfaces (yet).

import type { JSX } from 'react'
import type { EmptyVariant } from './EmptyState'

const SVGS: Record<Exclude<EmptyVariant, 'loading'>, JSX.Element> = {
  'no-data': (
    <svg viewBox="0 0 120 80" width="120" height="80" aria-hidden="true">
      <rect x="10" y="18" width="26" height="44" fill="none" stroke="rgb(124,92,255)" strokeWidth="1.5" opacity=".5" />
      <rect x="47" y="18" width="26" height="44" fill="none" stroke="rgb(124,92,255)" strokeWidth="1.5" opacity=".5" />
      <rect x="84" y="18" width="26" height="44" fill="none" stroke="rgb(124,92,255)" strokeWidth="1.5" opacity=".5" />
      <line x1="14" y1="42" x2="32" y2="42" stroke="rgb(124,92,255)" strokeWidth="1" strokeDasharray="2 2" opacity=".6" />
      <line x1="51" y1="38" x2="69" y2="38" stroke="rgb(124,92,255)" strokeWidth="1" strokeDasharray="2 2" opacity=".6" />
      <line x1="88" y1="46" x2="106" y2="46" stroke="rgb(124,92,255)" strokeWidth="1" strokeDasharray="2 2" opacity=".6" />
    </svg>
  ),
  'first-time': (
    <svg viewBox="0 0 120 80" width="120" height="80" aria-hidden="true">
      <circle cx="40" cy="30" r="12" fill="none" stroke="rgb(34,211,238)" strokeWidth="1.5" />
      <circle cx="80" cy="30" r="12" fill="none" stroke="rgb(34,211,238)" strokeWidth="1.5" />
      <circle cx="60" cy="56" r="12" fill="none" stroke="rgb(34,211,238)" strokeWidth="1.5" />
      <line x1="52" y1="30" x2="68" y2="30" stroke="rgb(34,211,238)" strokeWidth="1" strokeDasharray="2 2" />
      <line x1="46" y1="40" x2="56" y2="47" stroke="rgb(34,211,238)" strokeWidth="1" strokeDasharray="2 2" />
      <line x1="74" y1="40" x2="64" y2="47" stroke="rgb(34,211,238)" strokeWidth="1" strokeDasharray="2 2" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 120 80" width="120" height="80" aria-hidden="true">
      <rect x="25" y="22" width="70" height="36" fill="none" stroke="rgb(239,68,68)" strokeWidth="1.5" />
      <line x1="32" y1="30" x2="88" y2="30" stroke="rgb(239,68,68)" strokeWidth="1" opacity=".5" />
      <line x1="45" y1="40" x2="55" y2="50" stroke="rgb(239,68,68)" strokeWidth="2" />
      <line x1="55" y1="40" x2="45" y2="50" stroke="rgb(239,68,68)" strokeWidth="2" />
      <line x1="65" y1="40" x2="75" y2="50" stroke="rgb(239,68,68)" strokeWidth="2" />
      <line x1="75" y1="40" x2="65" y2="50" stroke="rgb(239,68,68)" strokeWidth="2" />
    </svg>
  ),
  'coming-soon': (
    <svg viewBox="0 0 120 80" width="120" height="80" aria-hidden="true">
      <rect x="20" y="22" width="80" height="36" fill="none" stroke="rgb(244,114,182)" strokeWidth="1.5" strokeDasharray="3 2" />
      <line x1="30" y1="32" x2="90" y2="32" stroke="rgb(244,114,182)" strokeWidth="1" opacity=".3" />
      <line x1="30" y1="40" x2="70" y2="40" stroke="rgb(244,114,182)" strokeWidth="1" opacity=".3" />
      <line x1="30" y1="48" x2="80" y2="48" stroke="rgb(244,114,182)" strokeWidth="1" opacity=".3" />
    </svg>
  ),
  '404-not-found': (
    <svg viewBox="0 0 120 80" width="120" height="80" aria-hidden="true">
      <rect x="15" y="20" width="90" height="40" fill="none" stroke="rgb(251,191,36)" strokeWidth="1.5" />
      <line x1="15" y1="20" x2="105" y2="60" stroke="rgb(251,191,36)" strokeWidth="1" opacity=".5" />
      <line x1="105" y1="20" x2="15" y2="60" stroke="rgb(251,191,36)" strokeWidth="1" opacity=".5" />
      <text x="60" y="46" fontFamily="Geist Mono, monospace" fontSize="14" fontWeight="700" fill="rgb(251,191,36)" textAnchor="middle">
        404
      </text>
    </svg>
  ),
  throttled: (
    <svg viewBox="0 0 120 80" width="120" height="80" aria-hidden="true">
      <circle cx="60" cy="40" r="24" fill="none" stroke="rgb(251,191,36)" strokeWidth="1.5" />
      <line x1="60" y1="24" x2="60" y2="40" stroke="rgb(251,191,36)" strokeWidth="2" />
      <line x1="60" y1="40" x2="74" y2="48" stroke="rgb(251,191,36)" strokeWidth="2" />
      <circle cx="60" cy="40" r="1.5" fill="rgb(251,191,36)" />
    </svg>
  ),
}

export function EmptyIllustration({ variant }: { variant: Exclude<EmptyVariant, 'loading'> }) {
  return <div className="mx-auto mb-4 text-text-muted">{SVGS[variant]}</div>
}
