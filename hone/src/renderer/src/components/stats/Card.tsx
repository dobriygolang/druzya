// Card / Label — shared chrome for Stats widgets. Both are thin wrappers
// to keep the three widgets visually aligned without each re-declaring
// paddings and border tokens. If widgets ever diverge visually, inline
// and delete these.
import type { ReactNode } from 'react';

export function Card({ children }: { children: ReactNode }) {
  return (
    <section
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 16,
        padding: 22,
      }}
    >
      {children}
    </section>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <div
      className="mono"
      style={{
        fontSize: 10,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: 'var(--ink-40)',
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}
