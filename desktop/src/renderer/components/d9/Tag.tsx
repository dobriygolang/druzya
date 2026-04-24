// Tag — monospace small-caps chip used inside assistant bubbles to
// annotate things like complexity (O(n log n)). `warn` switches to
// amber tint for "O(n²) worst case"-style callouts.

import type { ReactNode } from 'react';

export type TagTone = 'neutral' | 'warn' | 'ok' | 'error' | 'accent';

// Tone → color triple. `accent` and `error` share the red palette by
// design (the new Hone theme folded status-red into the primary accent).
// Keeping them as separate keys preserves the semantic vocabulary —
// callers saying `tone="error"` still read correctly even if visually
// identical to `tone="accent"`.
const tones: Record<TagTone, { fg: string; bg: string; border: string }> = {
  neutral: {
    fg: 'var(--d9-ink-dim)',
    bg: 'rgba(255, 255, 255, 0.06)',
    border: 'var(--d9-hairline)',
  },
  warn: {
    fg: 'var(--d9-warn)',
    bg: 'oklch(0.6 0.15 70 / 0.12)',
    border: 'oklch(0.6 0.15 70 / 0.3)',
  },
  ok: {
    fg: 'var(--d9-ok)',
    bg: 'oklch(0.6 0.15 150 / 0.12)',
    border: 'oklch(0.6 0.15 150 / 0.3)',
  },
  error: {
    fg: 'var(--d9-accent-hi)',
    bg: 'var(--d9-accent-glow)',
    border: 'rgba(255, 59, 48, 0.4)',
  },
  accent: {
    fg: 'var(--d9-accent-hi)',
    bg: 'var(--d9-accent-glow)',
    border: 'rgba(255, 59, 48, 0.4)',
  },
};

interface Props {
  children: ReactNode;
  tone?: TagTone;
  /** Shortcut for tone='warn' (to mirror the design-package `warn` prop). */
  warn?: boolean;
}

export function Tag({ children, tone, warn }: Props) {
  const effective = warn ? 'warn' : tone ?? 'neutral';
  const t = tones[effective];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 8px',
        borderRadius: 999,
        fontSize: 10.5,
        fontFamily: 'var(--d9-font-mono)',
        letterSpacing: '0.02em',
        color: t.fg,
        background: t.bg,
        border: `0.5px solid ${t.border}`,
      }}
    >
      {children}
    </span>
  );
}
