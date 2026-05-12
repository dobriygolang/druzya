/**
 * druz9 Modal — web (Framer Motion + AnimatePresence).
 *
 * One blessed Modal primitive for the web frontend. Replaces ad-hoc
 * `<div role="dialog">` overlays scattered across pages (TutorOnboardingModal,
 * LLMModelModal, AtlasNodeModal, PersonaModal, PodcastCategoryModal, …).
 *
 * Contract:
 *  - Focus trap while open (via useFocusTrap)
 *  - Escape key closes
 *  - Click outside (scrim) closes
 *  - Body scroll locked while open
 *  - Focus restored to triggering element on close
 *  - aria-modal="true" role="dialog" aria-labelledby aria-describedby
 *  - Portal to document.body
 *  - Motion: scrim cross-fade + card scale/translateY (v2 spec, motion-presets.ts)
 */

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useId, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { useFocusTrap } from '../../hooks/useFocusTrap'
import { modalIn, modalScrim } from '../../lib/motion-presets'

export type ModalSize = 'sm' | 'md' | 'lg' | 'full'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  size?: ModalSize
  initialFocusRef?: RefObject<HTMLElement>
  /**
   * If true, clicks on the scrim do NOT close the modal (use for destructive
   * confirms where accidental dismissal would lose work). Default false.
   */
  preventScrimClose?: boolean
  children: ReactNode
}

const SIZE_MAX_W: Record<ModalSize, number> = {
  sm: 480,
  md: 560,
  lg: 720,
  full: 960,
}

export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  initialFocusRef,
  preventScrimClose = false,
  children,
}: ModalProps) {
  const trapRef = useFocusTrap(open)
  const titleId = useId()
  const descId = useId()

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
    // Defer one frame so focus-trap doesn't fight us.
    const id = requestAnimationFrame(() => {
      initialFocusRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [open, initialFocusRef])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
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
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'center',
              padding: '64px 16px',
              pointerEvents: 'none',
              overflowY: 'auto',
            }}
          >
            <motion.div
              {...modalIn}
              ref={trapRef as React.RefCallback<HTMLDivElement>}
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? titleId : undefined}
              aria-describedby={description ? descId : undefined}
              style={{
                position: 'relative',
                maxWidth: SIZE_MAX_W[size],
                width: '100%',
                background: 'rgb(var(--color-surface-1, 10 10 10))',
                border: '1px solid var(--hair-2)',
                borderRadius: 'var(--radius-outer, 14px)',
                padding: 'var(--pad-container, 32px)',
                pointerEvents: 'auto',
                boxShadow: '0 24px 64px -16px rgba(0, 0, 0, 0.85)',
              }}
            >
              {title && (
                <h2
                  id={titleId}
                  style={{
                    margin: 0,
                    marginBottom: description ? 8 : 16,
                    fontSize: 'var(--type-h2-size)',
                    lineHeight: 'var(--type-h2-lh)',
                    letterSpacing: 'var(--type-h2-ls)',
                    fontWeight: 'var(--type-h2-weight)',
                    color: 'rgb(var(--ink))',
                  }}
                >
                  {title}
                </h2>
              )}
              {description && (
                <p
                  id={descId}
                  style={{
                    margin: 0,
                    marginBottom: 24,
                    fontSize: 'var(--type-body-size)',
                    lineHeight: 'var(--type-body-lh)',
                    color: 'var(--ink-60)',
                  }}
                >
                  {description}
                </p>
              )}
              {children}
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
