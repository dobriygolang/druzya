/**
 * SkipToContent — keyboard-only "Skip to main content" link.
 *
 * Mount in AppShell as the very first focusable element. Visually hidden until
 * focused (via :focus or :focus-visible), then appears top-left to let keyboard
 * users jump past nav directly to <main>.
 *
 * Pair with <main id="main" tabIndex={-1}>...</main> inside the page outlet.
 */

import { type CSSProperties } from 'react'

const HIDDEN: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
}

const FOCUSED: CSSProperties = {
  position: 'fixed',
  top: 12,
  left: 12,
  zIndex: 1000,
  padding: '10px 16px',
  background: 'rgb(var(--color-bg))',
  color: 'rgb(var(--ink))',
  border: '1.5px solid rgb(var(--ink))',
  borderRadius: 'var(--radius-inner, 10px)',
  textDecoration: 'none',
  fontSize: 'var(--type-body-size)',
  fontWeight: 500,
  width: 'auto',
  height: 'auto',
  margin: 0,
  overflow: 'visible',
  clip: 'auto',
  whiteSpace: 'nowrap',
  boxShadow: 'var(--focus-ring)',
}

export function SkipToContent({ href = '#main', label = 'Skip to main content' }: { href?: string; label?: string }) {
  return (
    <a
      href={href}
      style={HIDDEN}
      onFocus={(e) => Object.assign(e.currentTarget.style, FOCUSED)}
      onBlur={(e) => Object.assign(e.currentTarget.style, HIDDEN)}
    >
      {label}
    </a>
  )
}
