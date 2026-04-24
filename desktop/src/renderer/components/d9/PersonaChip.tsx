// PersonaChip — compact pill with gradient dot + label + caret.
// Clicking toggles a dropdown; the parent manages open/close + selection.
// The gradient dot uses .d9-grad-* utility classes driven by persona id,
// falling back to --d9-accent when the persona isn't in the known set.

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
  const dotClass = background ? undefined : `d9-grad-${grad}`;
  return (
    <button
      type="button"
      onClick={onClick}
      // Stop document-level mousedown inside dropdowns from racing the
      // onClick toggle (same fix as ModelPill).
      onMouseDown={(e) => e.stopPropagation()}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        // Compact: ghost style, matches ModelPill's inline weight. The
        // expanded variant keeps the soft pill for sidebar/header contexts.
        padding: compact ? 0 : '4px 10px 4px 5px',
        height: compact ? 22 : 26,
        borderRadius: compact ? 0 : 999,
        background: compact ? 'transparent' : 'oklch(1 0 0 / 0.06)',
        border: compact ? 0 : '0.5px solid var(--d9-hairline)',
        color: 'var(--d9-ink-dim)',
        fontSize: compact ? 11 : 12,
        fontWeight: 500,
        letterSpacing: '-0.005em',
        cursor: 'pointer',
        transition: 'color 120ms var(--d9-ease)',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--d9-ink)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--d9-ink-dim)')}
    >
      <span
        className={dotClass}
        style={{
          width: compact ? 14 : 16,
          height: compact ? 14 : 16,
          borderRadius: '50%',
          background,
          boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.3), 0 0 8px -2px currentColor',
          flex: 'none',
        }}
      />
      <span style={{
        maxWidth: compact ? 120 : 160,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>{label}</span>
      <Caret open={open} />
    </button>
  );
}
