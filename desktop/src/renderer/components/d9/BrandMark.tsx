// BrandMark — gradient pill with the "C" glyph (Cue). Previously rendered
// "9" (when the product was Druz9 Copilot); post-rename the glyph is the
// product initial. Still Manrope 800 — matches the Cue wordmark in
// design/hone/landing/brand/cue-mark.svg.
//
// Accepts:
//   - `persona` id ("react" / "sysdesign" / "sre" / "behav" / "dsa")
//     which maps to a `.d9-grad-*` utility class in tokens.css.
//   - `background` — raw gradient string override (takes precedence;
//     lets the server-driven Persona table push arbitrary gradients).
//
// When the slug is unknown, falls back to the violet-plasma accent.

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
  /** Show the "C" glyph. Default true. Pass false for the bare square. */
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
  // Glyph scales with container; 54% feels balanced (roman digit has
  // less optical weight than the italic serif ran before).
  const fontSize = Math.round(size * 0.54);
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
        fontFamily: 'var(--d9-font-sans)',
        fontWeight: 800,
        fontSize,
        lineHeight: 1,
        letterSpacing: '-0.02em',
        color: 'rgba(255,255,255,0.97)',
        textShadow: '0 0.5px 0 rgba(0,0,0,0.25)',
        userSelect: 'none',
        flex: 'none',
        ...style,
      }}
    >
      {glyph && <span style={{ transform: 'translateY(0.5px)' }}>C</span>}
    </div>
  );
}
