// ModelPill — inline monospace label with accent square + caret. Used
// in compact/expanded headers; click opens a ModelDropdown.
//
// All visuals via the .d9-pill CSS class — update globals.css, not here.

import { type MouseEvent, type ReactNode } from 'react';
import { Caret } from './Caret';

interface Props {
  label: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  /** Show caret. Default true. Hide for read-only display contexts. */
  interactive?: boolean;
  /** Whether the controlled dropdown is open — rotates the caret. */
  open?: boolean;
  leading?: ReactNode;
}

export function ModelPill({ label, onClick, title, interactive = true, open, leading }: Props) {
  return (
    <button
      type="button"
      // Ghost variant — no bg/border; the header row already frames it.
      // Full pill styling kicks in when used outside a framed row.
      className={interactive ? 'd9-pill d9-pill-ghost' : 'd9-pill d9-pill-ghost'}
      onClick={onClick}
      // Stop the document-level mousedown listener inside
      // PersonaDropdown / ModelDropdown from closing the panel BEFORE
      // this button's click fires.
      onMouseDown={(e) => e.stopPropagation()}
      title={title}
      disabled={!interactive}
      style={{ cursor: interactive ? 'pointer' : 'default' }}
    >
      {leading ?? <span className="d9-accent-square" />}
      <span
        style={{
          maxWidth: 180,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {interactive && <Caret open={open} />}
    </button>
  );
}
