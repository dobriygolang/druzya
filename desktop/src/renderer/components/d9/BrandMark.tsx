// BrandMark — gradient pill with the Cue brand mark. Source of truth
// for the shape is [`design/hone/landing/brand/cue-mark.svg`]: three
// concentric radio-wave arcs + centre dot + a single red antenna
// stroke. We inline the SVG (not <img>) so it paints at any size
// without blur and so the red stroke can share `--d9-accent` with
// the rest of the theme.
//
// The gradient background comes from the persona (`.d9-grad-*`);
// the SVG overlays. This lets persona chips keep their jewel-tone
// identity while the mark stays the same across personas.
//
// History: was "9" when the product was Druz9 Copilot, then "C"
// during the rename. Both text glyphs are deprecated in favour of
// the proper brand mark.
//
// Accepts:
//   - `persona` id ("react" / "sysdesign" / "sre" / "behav" / "dsa")
//     which maps to a `.d9-grad-*` utility class in tokens.css.
//   - `background` — raw gradient string override (takes precedence;
//     lets the server-driven Persona table push arbitrary gradients).
//
// When the slug is unknown, falls back to the accent gradient.

import type { CSSProperties } from 'react';

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
  persona?: string;
  /** Raw gradient string. Takes precedence over `persona` when provided. */
  background?: string;
  size?: number;
  /** Show the brand mark (arcs + dot + antenna). Default true. Pass
   *  false for the bare gradient square — used in skeleton states. */
  glyph?: boolean;
  style?: CSSProperties;
}

export function BrandMark({
  persona,
  background,
  size = 28,
  glyph = true,
  style,
}: BrandMarkProps) {
  const resolved = resolvePersonaGradient(persona);
  const className = background ? undefined : `d9-grad-${resolved}`;
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow:
          'inset 0 0.5px 0 rgba(255,255,255,0.28), ' +
          'inset 0 -0.5px 0 rgba(0,0,0,0.18), ' +
          '0 1px 2px rgba(0,0,0,0.35), ' +
          '0 0 14px -4px currentColor',
        color: 'rgba(255,255,255,0.97)',
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
// dot, and a red antenna stroke. The SVG's own black background rect
// from the source file is omitted — the surrounding BrandMark div
// already provides the pill shape + the persona gradient behind the
// strokes, so drawing a black rect here would hide the gradient.
//
// stroke-width 2 in the 128-viewBox translates to ~0.44px at size=28
// which is crisp on retina; at size=72 (Onboarding hero) it's
// ~1.1px — still hairline. No size-based tuning needed across the
// range we actually use (18-96px).
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
      {/* Antenna — red accent. Uses the CSS variable so any future
          tokens.css tweak propagates without touching this file. */}
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
