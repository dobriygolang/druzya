// IconButton — 28px ghost-hover affordance used across compact/expanded
// windows. `tone="accent"` turns it into the violet-plasma send CTA.

import { useState, type CSSProperties, type ReactNode, type MouseEvent } from 'react';

export type IconButtonTone = 'ghost' | 'accent' | 'danger';

interface Props {
  children: ReactNode;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  tone?: IconButtonTone;
  active?: boolean;
  disabled?: boolean;
  size?: number;
  style?: CSSProperties;
  /** Default icon color (replaces ink-dim for ghost tone). On hover still brightens to ink. */
  baseColor?: string;
  /** Optional hover icon color for prototype-matched controls. */
  hoverColor?: string;
  /** Keep mousedown from bubbling into window-drag regions. */
  stopDragOnPress?: boolean;
  /** ARIA: exposes pressed/toggled state to assistive tech. */
  ariaPressed?: boolean;
  /** ARIA: exposes disclosure (menu/dialog) open state to assistive tech. */
  ariaExpanded?: boolean;
  /** ARIA: hint for screen readers about what the button opens. */
  ariaHaspopup?: 'menu' | 'listbox' | 'dialog' | 'tree' | 'grid';
  /** ARIA: accessible label overriding the visible icon. */
  ariaLabel?: string;
}

export function IconButton({
  children,
  onClick,
  title,
  tone = 'ghost',
  active,
  disabled,
  size = 28,
  style,
  baseColor,
  hoverColor,
  stopDragOnPress = true,
  ariaPressed,
  ariaExpanded,
  ariaHaspopup,
  ariaLabel,
}: Props) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);

  const bg = (() => {
    if (disabled) return 'transparent';
    if (tone === 'accent') return pressed ? 'var(--d9-accent-lo)' : 'var(--d9-accent)';
    if (tone === 'danger') return hover ? 'oklch(0.68 0.22 25 / 0.18)' : 'transparent';
    if (active) return 'oklch(1 0 0 / 0.10)';
    return hover ? 'oklch(1 0 0 / 0.07)' : 'transparent';
  })();

  const color = (() => {
    if (disabled) return 'var(--d9-ink-ghost)';
    if (tone === 'accent') return 'white';
    if (tone === 'danger') return 'var(--d9-err)';
    if (active) return 'var(--d9-ink)';
    if (hover) return hoverColor ?? 'var(--d9-ink)';
    return baseColor ?? 'var(--d9-ink-dim)';
  })();

  const boxShadow = tone === 'accent' && !disabled
    ? pressed
      ? 'inset 0 0.5px 0 rgba(255,255,255,0.15)'
      : '0 0 14px -4px var(--d9-accent-glow), inset 0 0.5px 0 rgba(255,255,255,0.25)'
    : undefined;

  return (
    <button
      type="button"
      title={title}
      aria-pressed={ariaPressed}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHaspopup}
      aria-label={ariaLabel}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false); }}
      onMouseDown={(e) => {
        setPressed(true);
        if (stopDragOnPress) e.stopPropagation();
      }}
      onMouseUp={() => setPressed(false)}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        border: 0,
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: bg,
        color,
        boxShadow,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition:
          'background var(--d9-dur-hover) var(--d9-ease), ' +
          'color var(--d9-dur-hover) var(--d9-ease), ' +
          'box-shadow var(--d9-dur-hover) var(--d9-ease)',
        flex: 'none',
        ...style,
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      {children}
    </button>
  );
}
