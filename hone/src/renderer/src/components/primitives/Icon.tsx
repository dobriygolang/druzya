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
  | 'x'
  | 'sun'
  | 'note'
  | 'grid'
  | 'calendar'
  | 'headphones'
  | 'bars'
  | 'standup'
  | 'search';

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
    case 'sun':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
        </svg>
      );
    case 'note':
      return (
        <svg {...p}>
          <path d="M5 4h11l3 3v13H5z" />
          <path d="M16 4v3h3" />
          <path d="M8 11h8M8 15h6" />
        </svg>
      );
    case 'grid':
      return (
        <svg {...p}>
          <rect x="4" y="4" width="7" height="7" rx="1" />
          <rect x="13" y="4" width="7" height="7" rx="1" />
          <rect x="4" y="13" width="7" height="7" rx="1" />
          <rect x="13" y="13" width="7" height="7" rx="1" />
        </svg>
      );
    case 'calendar':
      return (
        <svg {...p}>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M4 10h16M9 3v4M15 3v4" />
        </svg>
      );
    case 'headphones':
      return (
        <svg {...p}>
          <path d="M4 14a8 8 0 1116 0v3a2 2 0 01-2 2h-1v-7h3" />
          <path d="M4 14v3a2 2 0 002 2h1v-7H4" />
        </svg>
      );
    case 'bars':
      return (
        <svg {...p}>
          <path d="M5 20V11M12 20V4M19 20v-6" />
        </svg>
      );
    case 'standup':
      return (
        <svg {...p}>
          <circle cx="9" cy="7" r="3" />
          <circle cx="17" cy="9" r="2" />
          <path d="M3 21v-1a6 6 0 016-6h0a6 6 0 016 6v1" />
          <path d="M15 21v-.5a4 4 0 014-4" />
        </svg>
      );
    case 'search':
      return (
        <svg {...p}>
          <circle cx="11" cy="11" r="6" />
          <path d="M20 20l-4-4" />
        </svg>
      );
  }
}
