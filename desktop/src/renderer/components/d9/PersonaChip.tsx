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
  background,
}: Props) {
  const grad = resolvePersonaGradient(personaId);
  const dotClass = background ? undefined : `d9-grad-${grad}`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: compact ? '2px 8px 2px 4px' : '4px 10px 4px 5px',
        height: compact ? 22 : 26,
        borderRadius: 999,
        background: 'oklch(1 0 0 / 0.06)',
        border: '0.5px solid var(--d9-hairline)',
        color: 'var(--d9-ink-dim)',
        fontSize: compact ? 11 : 12,
        fontWeight: 500,
        letterSpacing: '-0.005em',
        cursor: 'pointer',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
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
      <Caret />
    </button>
  );
}
