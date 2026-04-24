// ModelPill — monospace label with a violet accent square and a caret,
// used inline in compact/expanded status rows. The whole thing is a
// button so the user can cycle model / open a picker.

import { type MouseEvent, type ReactNode } from 'react';
import { Caret } from './Caret';

interface Props {
  label: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  /** Show caret. Default true. Hide for read-only display contexts. */
  interactive?: boolean;
  leading?: ReactNode;
}

export function ModelPill({ label, onClick, title, interactive = true, leading }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: 0,
        fontSize: 11,
        color: 'var(--d9-ink-dim)',
        fontFamily: 'var(--d9-font-mono)',
        letterSpacing: '-0.01em',
        cursor: interactive ? 'pointer' : 'default',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      {leading ?? (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 1,
            background: 'var(--d9-accent)',
            boxShadow: '0 0 6px var(--d9-accent-glow)',
          }}
        />
      )}
      <span style={{
        maxWidth: 180,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>{label}</span>
      {interactive && <Caret />}
    </button>
  );
}
