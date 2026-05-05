// WindowShell — heavy-glass container used for compact, expanded, and
// area-overlay surfaces. Layered gradient + backdrop-filter for the glass
// look, plus the d9-shadow-win drop shadow and an inner hairline highlight.
//
// Glass intensity comes from the user Appearance setting (see
// stores/appearance.ts). On Tahoe 26.x we skip `backdrop-filter` at the
// "opaque" setting because the regression makes glass panels visually
// noisy on dark backdrops; the opaque mode is the fallback.

import type { CSSProperties, ReactNode } from 'react';

export type GlassIntensity = 'heavy' | 'medium' | 'opaque';

interface Props {
  width?: number | string;
  height?: number | string;
  radius?: number;
  glass?: GlassIntensity;
  /** Window-drag region flag (Electron `-webkit-app-region: drag`).
   *  Compact window is fully drag-enabled by default; expanded has its
   *  own drag header. */
  draggable?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
}

export function WindowShell({
  width,
  height,
  radius = 18,
  glass = 'heavy',
  draggable = false,
  children,
  style,
  className,
}: Props) {
  // B/W rule: glass background — pure dark grayscale, no purple/indigo hue.
  // Earlier oklch(_ _ 278) переливал в фиолет — не identity-aligned.
  const bg =
    glass === 'heavy'
      ? 'linear-gradient(180deg, rgba(20,20,20,0.72), rgba(10,10,10,0.82))'
      : glass === 'medium'
      ? 'linear-gradient(180deg, rgba(20,20,20,0.88), rgba(10,10,10,0.94))'
      : 'linear-gradient(180deg, #1a1a1a, #0a0a0a)';

  return (
    <div
      className={`d9-root ${className ?? ''}`}
      style={{
        width,
        height,
        borderRadius: radius,
        background: bg,
        backdropFilter: glass !== 'opaque' ? 'var(--d9-glass-blur)' : undefined,
        WebkitBackdropFilter: glass !== 'opaque' ? ('var(--d9-glass-blur)' as unknown as string) : undefined,
        boxShadow: 'var(--d9-shadow-win)',
        color: 'var(--d9-ink)',
        fontFamily: 'var(--d9-font-sans)',
        position: 'relative',
        overflow: 'hidden',
        ...style,
        WebkitAppRegion: draggable ? 'drag' : 'no-drag',
      } as React.CSSProperties}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          border: '0.5px solid var(--d9-hairline-b)',
          pointerEvents: 'none',
        }}
      />
      {children}
    </div>
  );
}
