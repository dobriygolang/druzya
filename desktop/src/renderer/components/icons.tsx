// Icon primitives. Lucide-style thin stroke (1.5px), 16px default canvas.
// We inline SVG rather than pulling lucide-react to keep the bundle small —
// this many icons don't justify a dependency.

import type { SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: Props) {
  return {
    ...rest,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}

export function IconCamera(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

export function IconMic(p: Props) {
  return (
    <svg {...base(p)}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 19v3" />
    </svg>
  );
}

export function IconSettings(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.7 1 1.2 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}

export function IconClose(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function IconMinimize(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M6 12h12" />
    </svg>
  );
}

export function IconExpand(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  );
}

export function IconSend(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
    </svg>
  );
}

export function IconSparkles(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
    </svg>
  );
}

export function IconHistory(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M3 3v5h5M3.05 13a9 9 0 1 0 2.12-6.36L3 8" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

export function IconCheck(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

export function IconChevronDown(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconCopy(p: Props) {
  return (
    <svg {...base(p)}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function IconShield(p: Props) {
  return (
    <svg {...base(p)}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </svg>
  );
}

export function IconKey(p: Props) {
  return (
    <svg {...base(p)}>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m21 2-9.6 9.6M15 7l4 4-3 3" />
    </svg>
  );
}

/** Brand mark — gradient square with a subtle shine. Used in onboarding and compact. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 3.5,
        background: 'var(--d-gradient-hero)',
        boxShadow: '0 2px 8px rgba(124, 92, 255, 0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
        flexShrink: 0,
      }}
    />
  );
}
