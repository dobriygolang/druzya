// BrandMark — gradient pill with the editorial "9" glyph. Accepts
// a persona slug ("react", "sysdesign", "sre", "behav", "dsa") which
// sets the gradient via the .d9-grad-* utility classes in tokens.css.
// The `accent` fallback is used when the persona id is not one of the
// known gradients (e.g. server-driven personas with a custom gradient
// string in their `brand_gradient` column — we fall back to accent).

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
  /** Raw gradient string. Takes precedence over `persona` when provided
   *  (lets the server-driven Persona table push arbitrary gradients). */
  background?: string;
  size?: number;
  /** Show the "9" glyph. Default true. Pass false for the bare square. */
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
        borderRadius: size * 0.32,
        background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow:
          'inset 0 0.5px 0 rgba(255,255,255,0.3), ' +
          'inset 0 -0.5px 0 rgba(0,0,0,0.15), ' +
          '0 1px 2px rgba(0,0,0,0.35), ' +
          '0 0 14px -4px currentColor',
        fontFamily: 'var(--d9-font-display)',
        fontStyle: 'italic',
        fontSize: size * 0.6,
        fontWeight: 500,
        lineHeight: 1,
        letterSpacing: '-0.04em',
        color: 'rgba(255,255,255,0.97)',
        textShadow: '0 0.5px 0 rgba(0,0,0,0.25)',
        userSelect: 'none',
        flex: 'none',
        ...style,
      }}
    >
      {glyph && <span style={{ transform: 'translateY(1px)' }}>9</span>}
    </div>
  );
}
