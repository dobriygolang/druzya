// Kbd / Kbds — keyboard chip + stacked row. Used in hotkey hints.
// Monospace, pressed-down inset via --d9-shadow-key. Small size is for
// compact footers; medium for EmptyState and dropdown affordances.

import type { ReactNode } from 'react';

export interface KbdProps {
  children: ReactNode;
  size?: 'sm' | 'md';
}

export function Kbd({ children, size = 'md' }: KbdProps) {
  const h = size === 'sm' ? 18 : 22;
  const px = size === 'sm' ? 5 : 7;
  const fs = size === 'sm' ? 10 : 11;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: h,
        height: h,
        padding: `0 ${px}px`,
        borderRadius: 5,
        background: 'linear-gradient(180deg, oklch(1 0 0 / 0.09), oklch(1 0 0 / 0.04))',
        boxShadow: 'var(--d9-shadow-key)',
        color: 'var(--d9-ink-dim)',
        fontFamily: 'var(--d9-font-mono)',
        fontSize: fs,
        fontWeight: 500,
        lineHeight: 1,
        letterSpacing: '0.02em',
      }}
    >
      {children}
    </span>
  );
}

interface KbdsProps {
  keys: string[];
  size?: 'sm' | 'md';
  /** Separator between keys. Defaults to "+"; pass "" for Mac-chord
   *  style (⌘⏎). */
  sep?: string;
}

export function Kbds({ keys, size = 'md', sep = '+' }: KbdsProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {keys.map((k, i) => (
        <span key={`${k}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          {i > 0 && sep && (
            <span
              style={{
                color: 'var(--d9-ink-ghost)',
                fontSize: size === 'sm' ? 9 : 10,
                margin: '0 1px',
              }}
            >
              {sep}
            </span>
          )}
          <Kbd size={size}>{k}</Kbd>
        </span>
      ))}
    </span>
  );
}
