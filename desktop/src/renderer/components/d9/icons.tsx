// Design-package icons. Flat 16px viewBox, 1.2 stroke weight — feather-ish
// without being feather. These match the line weight of BrandMark glyph and
// the surrounding micro-UI; when you need a thicker lucide-style icon use
// `../icons.tsx` instead.

import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

export function D9IconCamera({ size = 14, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" {...rest}>
      <rect x="1.5" y="4" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8.5" r="2.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 4L6.5 2.5H9.5L10.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function D9IconSettings({ size = 14, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" {...rest}>
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 1.5v1.7M8 12.8v1.7M14.5 8h-1.7M3.2 8H1.5M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2M12.6 12.6l-1.2-1.2M4.6 4.6L3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function D9IconArrow({ size = 14, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" {...rest}>
      <path
        d="M8 2.5V13.5M8 2.5L4 6.5M8 2.5L12 6.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function D9IconClose({ size = 12, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" {...rest}>
      <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function D9IconExpand({ size = 14, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" {...rest}>
      <path
        d="M3 10V13H6M13 6V3H10M13 3L9 7M3 13L7 9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function D9IconCollapse({ size = 14, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" {...rest}>
      <path
        d="M6 3V6H3M10 13V10H13M10 10L13 13M6 6L3 3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function D9IconCopy({ size = 12, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" {...rest}>
      <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M10 3.5V2.5C10 2 9.5 1.5 9 1.5H3C2.5 1.5 2 2 2 2.5V8.5C2 9 2.5 9.5 3 9.5H4"
        stroke="currentColor"
        strokeWidth="1.1"
      />
    </svg>
  );
}

export function D9IconSparkle({ size = 12, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" {...rest}>
      <path
        d="M6 1L7 5L11 6L7 7L6 11L5 7L1 6L5 5L6 1Z"
        stroke="currentColor"
        strokeWidth="1"
        fill="currentColor"
        fillOpacity="0.15"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function D9IconMic({ size = 14, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" {...rest}>
      <rect x="6" y="2" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M3.5 8C3.5 10.5 5.5 12 8 12M8 12C10.5 12 12.5 10.5 12.5 8M8 12V14.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function D9IconCheck({ size = 12, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" {...rest}>
      <path
        d="M2.5 6L5 8.5L9.5 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
