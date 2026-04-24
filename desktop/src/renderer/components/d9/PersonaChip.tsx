// PersonaChip — compact pill with gradient dot + label + caret. All
// visuals live in globals.css (.d9-pill + .d9-pill-ghost + .d9-gradient-dot).
// Edits there; this file owns structure + behaviour only.

import { type MouseEvent } from 'react';
import { Caret } from './Caret';
import { resolvePersonaGradient } from './BrandMark';

interface Props {
  personaId?: string;
  label: string;
  compact?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  /** Whether the controlled dropdown is open — rotates the caret. */
  open?: boolean;
  /** Raw gradient string override (used when persona table pushes
   *  a custom brand_gradient). */
  background?: string;
}

export function PersonaChip({
  personaId,
  label,
  compact = false,
  onClick,
  title,
  open,
  background,
}: Props) {
  const grad = resolvePersonaGradient(personaId);
  // d9-grad-* sets the background-image for the gradient dot. If the
  // server passed a raw `background`, we skip the class and apply the
  // inline gradient directly.
  const dotClass = background
    ? 'd9-gradient-dot'
    : `d9-gradient-dot d9-grad-${grad}`;
  return (
    <button
      type="button"
      // Compact uses ghost (flat, no bg) for header rows that already
      // frame the element. Non-compact gets the full pill with bg +
      // hairline — matches old inline variant.
      className={compact ? 'd9-pill d9-pill-ghost' : 'd9-pill'}
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      title={title}
      style={{
        fontFamily: 'var(--d9-font-sans)',
        letterSpacing: '-0.005em',
        fontSize: compact ? 11 : 12,
        fontWeight: 500,
      }}
    >
      <span
        className={dotClass}
        style={{
          // Round dot on chip (distinguishes from ModelDropdown's
          // square). Size tracks compact.
          width: compact ? 14 : 16,
          height: compact ? 14 : 16,
          borderRadius: '50%',
          background,
        }}
      />
      <span
        style={{
          maxWidth: compact ? 120 : 160,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <Caret open={open} />
    </button>
  );
}
