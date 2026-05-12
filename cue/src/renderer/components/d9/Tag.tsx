// Tag — monospace small-caps chip used inside assistant bubbles to
// annotate things like complexity (O(n log n)). `warn` switches to
// amber tint for "O(n²) worst case"-style callouts.

import type { ReactNode } from 'react';

export type TagTone = 'neutral' | 'warn' | 'ok' | 'error' | 'accent';

// B/W rule: tones — только ink-ramp + signal-red для error/accent. Раньше
// warn/ok были amber/green oklch — нарушение. Семантика передаётся
// через label + текст, не через hue.
const tones: Record<TagTone, { fg: string; bg: string; border: string }> = {
  neutral: {
    fg: 'var(--d9-ink-dim)',
    bg: 'var(--d9-hairline)',
    border: 'var(--d9-hairline)',
  },
  warn: {
    fg: 'var(--d9-ink-dim)',
    bg: 'var(--d9-hairline-b)',
    border: 'rgba(255, 255, 255, 0.20)',
  },
  ok: {
    fg: 'var(--d9-ink-dim)',
    bg: 'var(--d9-hairline)',
    border: 'var(--d9-hairline-b)',
  },
  error: {
    fg: 'var(--d9-accent-hi)',
    bg: 'var(--d9-accent-glow)',
    border: 'var(--d9-accent)',
  },
  accent: {
    fg: 'var(--d9-accent-hi)',
    bg: 'var(--d9-accent-glow)',
    border: 'var(--d9-accent)',
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
        letterSpacing: '0.08em',
        color: t.fg,
        background: t.bg,
        border: `0.5px solid ${t.border}`,
      }}
    >
      {children}
    </span>
  );
}
