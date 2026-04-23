// Low-level UI atoms shared by every screen. Styles use CSS variables from
// tokens.css — no component-local colour constants.

import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';

// ─────────────────────────────────────────────────────────────────────────
// Button — three variants: primary (gradient), secondary (outline), ghost.
// ─────────────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'pill';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  leading?: ReactNode;
  trailing?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', leading, trailing, children, style, ...rest },
  ref,
) {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: size === 'sm' ? 26 : 32,
    padding: size === 'sm' ? '0 10px' : '0 14px',
    fontSize: size === 'sm' ? 12 : 13,
    fontWeight: 500,
    borderRadius: variant === 'pill' ? 'var(--r-pill)' : 'var(--r-btn)',
    border: '1px solid transparent',
    cursor: 'pointer',
    transition: 'background 120ms, border-color 120ms, opacity 120ms',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  };
  const variants: Record<Variant, CSSProperties> = {
    primary: {
      background: 'var(--d-gradient-hero)',
      color: 'white',
      boxShadow: '0 1px 0 rgba(255,255,255,0.1) inset, 0 4px 12px rgba(124,92,255,0.28)',
    },
    secondary: {
      background: 'var(--d-bg-2)',
      color: 'var(--d-text)',
      borderColor: 'var(--d-line-strong)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--d-text-2)',
    },
    pill: {
      background: 'var(--d-bg-2)',
      color: 'var(--d-text-2)',
      borderColor: 'var(--d-line)',
    },
  };
  return (
    <button ref={ref} style={{ ...base, ...variants[variant], ...style }} {...rest}>
      {leading}
      {children}
      {trailing}
    </button>
  );
});

// ─────────────────────────────────────────────────────────────────────────
// IconButton — square, hover ring, for toolbar-style actions.
// ─────────────────────────────────────────────────────────────────────────

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 28, children, style, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        color: 'var(--d-text-2)',
        border: '1px solid transparent',
        borderRadius: 'var(--r-btn)',
        cursor: 'pointer',
        transition: 'background 120ms, color 120ms',
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
        e.currentTarget.style.color = 'var(--d-text)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--d-text-2)';
      }}
      {...rest}
    >
      {children}
    </button>
  );
});

// ─────────────────────────────────────────────────────────────────────────
// Kbd — renders a keyboard shortcut pill. Accepts accelerator strings
// like "CommandOrControl+Shift+S" and splits them into rendered chips.
// ─────────────────────────────────────────────────────────────────────────

const acceleratorGlyphs: Record<string, string> = {
  CommandOrControl: '⌘',
  Command: '⌘',
  Cmd: '⌘',
  Control: '⌃',
  Ctrl: '⌃',
  Shift: '⇧',
  Alt: '⌥',
  Option: '⌥',
  Enter: '↵',
  Escape: 'Esc',
  Space: '␣',
};

export function Kbd({ children, size = 'md' }: { children: ReactNode; size?: 'sm' | 'md' }) {
  const parts =
    typeof children === 'string'
      ? children.split('+').map((k) => acceleratorGlyphs[k] ?? k)
      : [children];
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {parts.map((p, i) => (
        <span
          key={i}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: size === 'sm' ? 14 : 18,
            height: size === 'sm' ? 16 : 20,
            padding: '0 4px',
            fontSize: size === 'sm' ? 10 : 11,
            fontFamily: 'var(--f-mono)',
            color: 'var(--d-text-3)',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid var(--d-line)',
            borderRadius: 4,
          }}
        >
          {p}
        </span>
      ))}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// StatusDot — tiny indicator used in the compact window's status bar.
// States map to colours; thinking pulses.
// ─────────────────────────────────────────────────────────────────────────

export type DotState = 'idle' | 'ready' | 'thinking' | 'recording' | 'error';

export function StatusDot({ state, size = 6 }: { state: DotState; size?: number }) {
  const colour: Record<DotState, string> = {
    idle: 'var(--d-text-4)',
    ready: 'var(--d-green)',
    thinking: 'var(--d-accent)',
    recording: 'var(--d-red)',
    error: 'var(--d-red)',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: size,
        background: colour[state],
        animation: state === 'thinking' || state === 'recording' ? 'druz9-pulse 1.2s ease-in-out infinite' : undefined,
        boxShadow:
          state === 'ready'
            ? `0 0 ${size}px rgba(52,199,89,0.6)`
            : state === 'thinking'
              ? `0 0 ${size}px rgba(124,92,255,0.6)`
              : undefined,
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Surface — the frosted rounded card used as every window's outer shell.
// ─────────────────────────────────────────────────────────────────────────

export function Surface({
  children,
  style,
  className,
}: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        background: 'var(--d-bg-1)',
        border: '1px solid var(--d-line)',
        borderRadius: 'var(--r-window)',
        boxShadow: 'var(--s-window)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
