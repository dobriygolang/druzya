// Icon — hand-rolled SVG sprites for the ~dozen glyphs Hone uses. Inline
// on purpose: ~400 bytes of SVG beats the runtime cost of a sprite sheet
// at this count, and the design language here is minimal enough that we
// rarely add new icons.
//
// New icons land by extending the switch. Size defaults to 14px to match
// the body font; callers pass explicit size only when breaking from that.

export type IconName =
  | 'menu'
  | 'play'
  | 'pause'
  | 'volume'
  | 'sparkle'
  | 'arrow'
  | 'x';

interface IconProps {
  name: IconName;
  size?: number;
  stroke?: string;
}

export function Icon({ name, size = 14, stroke = 'currentColor' }: IconProps) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke,
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'menu':
      return (
        <svg {...p}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
    case 'play':
      return (
        <svg {...p}>
          <path d="M7 5l13 7-13 7z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'pause':
      return (
        <svg {...p}>
          <rect x="7" y="5" width="3" height="14" fill="currentColor" stroke="none" />
          <rect x="14" y="5" width="3" height="14" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'volume':
      return (
        <svg {...p}>
          <path d="M4 9v6h4l5 4V5L8 9zM16 8a5 5 0 010 8M19 5a9 9 0 010 14" />
        </svg>
      );
    case 'sparkle':
      return (
        <svg {...p}>
          <path d="M12 3l1.7 5 5 1.7-5 1.7L12 17l-1.7-5.6L5 9.7l5-1.7z" />
        </svg>
      );
    case 'arrow':
      return (
        <svg {...p}>
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      );
    case 'x':
      return (
        <svg {...p}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
  }
}
