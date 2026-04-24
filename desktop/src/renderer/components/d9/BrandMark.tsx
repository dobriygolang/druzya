// BrandMark — black pill with the Cue brand mark.
//
// Source of truth for the shape: [`design/hone/landing/brand/cue-mark.svg`].
// Three concentric radio-wave arcs (opacity ladder) + centre dot + a
// single red antenna stroke. The SVG is inlined here so:
//   1. it paints at any size without blur;
//   2. the antenna shares `--d9-accent` with the rest of the theme
//      (red today, whatever we choose tomorrow — zero edits here);
//   3. bundle size stays under the fetch cost of a separate asset.
//
// Background is always black. The persona jewel-tone gradients used
// to live here (d9-grad-react, etc.) but they drowned out the
// white-arc + red-antenna contrast — the whole point of the mark.
// Persona identity now lives exclusively in PersonaChip's
// `.d9-gradient-dot` (see components/d9/PersonaChip.tsx).
//
// History: was "9" glyph (Druz9 Copilot), then "C" glyph (rename),
// now the proper brand mark on solid black. `persona` / `background`
// props removed — any caller that wants a custom panel colour should
// wrap BrandMark in its own container instead of mutating the mark.

import type { CSSProperties } from 'react';

// resolvePersonaGradient is still exported because PersonaChip /
// PersonaDropdown consume it for their gradient dots. Keeping the
// resolver here avoids a second lookup table in the persona files.
export type BrandPersona = 'react' | 'sysdesign' | 'sre' | 'behav' | 'dsa' | 'accent';

const KNOWN: Record<string, BrandPersona> = {
  react: 'react',
  sysdesign: 'sysdesign',
  system: 'sysdesign',
  sre: 'sre',
  go: 'sre',
  behav: 'behav',
  behavioral: 'behav',
  dsa: 'dsa',
};

export function resolvePersonaGradient(slug: string | undefined): BrandPersona {
  if (!slug) return 'accent';
  const k = slug.toLowerCase();
  return KNOWN[k] ?? 'accent';
}

interface BrandMarkProps {
  size?: number;
  /** Show the brand mark (arcs + dot + antenna). Default true. Pass
   *  false for the bare black square — used in skeleton states. */
  glyph?: boolean;
  style?: CSSProperties;
}

export function BrandMark({ size = 28, glyph = true, style }: BrandMarkProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow:
          'inset 0 0.5px 0 rgba(255,255,255,0.10), ' +
          '0 1px 2px rgba(0,0,0,0.35)',
        userSelect: 'none',
        flex: 'none',
        overflow: 'hidden',
        ...style,
      }}
    >
      {glyph && <CueMark size={size} />}
    </div>
  );
}

// CueMark — inlined copy of design/hone/landing/brand/cue-mark.svg.
// Three concentric arcs (opacity ladder for "radio waves"), centre
// dot, and a red antenna stroke. Source SVG's black <rect> is omitted
// — the surrounding BrandMark div provides the pill + background.
//
// stroke-width 2 at viewBox 128 → ~0.44px at size=28 (crisp on
// retina), ~1.1px at size=76 (onboarding hero). No size-based
// stroke-tuning needed across the range we actually use (18-96px).
function CueMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <g fill="none" stroke="#fff" strokeLinecap="round" strokeWidth={2}>
        <path d="M44,64 a20,20 0 0 1 40,0" opacity={1} />
        <path d="M34,64 a30,30 0 0 1 60,0" opacity={0.55} />
        <path d="M24,64 a40,40 0 0 1 80,0" opacity={0.28} />
      </g>
      <circle cx={64} cy={64} r={4} fill="#fff" />
      {/* Antenna — red accent via CSS var so future token tweaks
          propagate without touching this file. */}
      <line
        x1={88}
        y1={40}
        x2={104}
        y2={24}
        stroke="var(--d9-accent)"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}
