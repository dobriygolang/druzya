/**
 * druz9 Drawer — web (Framer Motion + AnimatePresence).
 *
 * Slide-from-edge surface for navigation/context that's secondary to the main view:
 * mobile menu, notifications drawer, atlas node detail, AI-coach pill, contextual
 * inspectors. Different from Modal (centered, blocks all interaction) — Drawer is
 * a side surface that pairs with the underlying view.
 *
 * Contract:
 *  - Focus trap while open (via useFocusTrap)
 *  - Escape closes
 *  - Click on scrim closes (unless preventScrimClose)
 *  - Body scroll lock while open
 *  - aria-modal="true" role="dialog" with aria-labelledby/aria-label
 *  - Portal to document.body
 *  - Motion: scrim cross-fade + panel slide via motion-presets drawerIn*
 */

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useId, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { useFocusTrap } from '../../hooks/useFocusTrap'
import { drawerInBottom, drawerInLeft, drawerInRight, modalScrim } from '../../lib/motion-presets'

export type DrawerSide = 'right' | 'left' | 'bottom'
export type DrawerSize = 'sm' | 'md' | 'lg' | 'full'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  side?: DrawerSide
  size?: DrawerSize
  /** Accessible name. Either title or ariaLabel is required. */
  title?: string
  ariaLabel?: string
  initialFocusRef?: RefObject<HTMLElement>
  preventScrimClose?: boolean
  children: ReactNode
}

const SIZE_W: Record<DrawerSize, number | string> = {
  sm: 320,
  md: 420,
  lg: 560,
  full: '100%',
}

export function Drawer({
  open,
  onClose,
  side = 'right',
  size = 'md',
  title,
  ariaLabel,
  initialFocusRef,
  preventScrimClose = false,
  children,
}: DrawerProps) {
  const trapRef = useFocusTrap(open)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open || !initialFocusRef?.current) return
    const id = requestAnimationFrame(() => initialFocusRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open, initialFocusRef])

  if (typeof document === 'undefined') return null

  const motionPreset =
    side === 'left' ? drawerInLeft : side === 'bottom' ? drawerInBottom : drawerInRight

  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    background: 'rgb(var(--color-surface-1, 10 10 10))',
    boxShadow: '0 24px 64px -16px rgba(0, 0, 0, 0.85)',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  }
  if (side === 'right') {
    Object.assign(panelStyle, {
      top: 0,
      right: 0,
      bottom: 0,
      width: SIZE_W[size],
      maxWidth: '100%',
      borderLeft: '1px solid var(--hair-2)',
    })
  } else if (side === 'left') {
    Object.assign(panelStyle, {
      top: 0,
      left: 0,
      bottom: 0,
      width: SIZE_W[size],
      maxWidth: '100%',
      borderRight: '1px solid var(--hair-2)',
    })
  } else {
    Object.assign(panelStyle, {
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: size === 'full' ? '100%' : size === 'lg' ? '85vh' : size === 'md' ? '70vh' : '50vh',
      borderTop: '1px solid var(--hair-2)',
      borderTopLeftRadius: 14,
      borderTopRightRadius: 14,
    })
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
          <motion.div
            {...modalScrim}
            onClick={preventScrimClose ? undefined : onClose}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.62)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          />
          <motion.div
            {...motionPreset}
            ref={trapRef as React.RefCallback<HTMLDivElement>}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-label={!title ? ariaLabel : undefined}
            style={panelStyle}
          >
            {title && (
              <h2
                id={titleId}
                style={{
                  margin: 0,
                  padding: 'var(--pad-container, 24px)',
                  paddingBottom: 16,
                  fontSize: 'var(--type-h3-size)',
                  lineHeight: 'var(--type-h3-lh)',
                  letterSpacing: 'var(--type-h3-ls)',
                  fontWeight: 'var(--type-h3-weight)',
                  color: 'rgb(var(--ink))',
                  borderBottom: '1px solid var(--hair)',
                }}
              >
                {title}
              </h2>
            )}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
