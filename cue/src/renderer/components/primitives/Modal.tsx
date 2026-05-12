/**
 * Cue Modal — CSS-class motion (mirrors Hone's implementation).
 *
 * Drop-in replacement for ad-hoc CommandPalette / PaywallModal / ProviderPicker
 * overlays. Same contract as Hone Modal — only palette tokens differ (--d9-*).
 *
 * If you edit Hone Modal, edit this one too (or refactor to a shared generator).
 */

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { useFocusTrap } from '../../hooks/useFocusTrap';
import { motion } from '../../lib/design-tokens';

export type ModalSize = 'sm' | 'md' | 'lg' | 'full';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: ModalSize;
  initialFocusRef?: RefObject<HTMLElement>;
  preventScrimClose?: boolean;
  children: ReactNode;
}

const SIZE_MAX_W: Record<ModalSize, number> = {
  sm: 480,
  md: 560,
  lg: 720,
  full: 960,
};

type Phase = 'closed' | 'open' | 'closing';

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
  const [phase, setPhase] = useState<Phase>('closed');
  const titleId = useId();
  const descId = useId();
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setPhase('open');
      return;
    }
    if (phase === 'open') {
      setPhase('closing');
      closeTimerRef.current = window.setTimeout(() => {
        setPhase('closed');
        closeTimerRef.current = null;
      }, motion.dur.medium);
    }
  }, [open, phase]);

  const visible = phase !== 'closed';
  const trapRef = useFocusTrap(visible && phase === 'open');

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, onClose]);

  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [visible]);

  useEffect(() => {
    if (phase !== 'open' || !initialFocusRef?.current) return;
    const id = requestAnimationFrame(() => {
      initialFocusRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [phase, initialFocusRef]);

  if (!visible || typeof document === 'undefined') return null;

  const exiting = phase === 'closing';

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
      <div
        className={exiting ? 'motion-scrim-out' : 'motion-scrim-in'}
        onClick={preventScrimClose ? undefined : onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--d9-scrim)',
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
        <div
          ref={trapRef as React.RefCallback<HTMLDivElement>}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descId : undefined}
          className={exiting ? 'motion-modal-out' : 'motion-modal-in'}
          style={{
            position: 'relative',
            maxWidth: SIZE_MAX_W[size],
            width: '100%',
            background: 'var(--d9-obsidian)',
            border: '1px solid var(--d9-hairline-b)',
            borderRadius: 'var(--radius-outer, 14px)',
            padding: 'var(--pad-container, 32px)',
            pointerEvents: 'auto',
            boxShadow: '0 24px 64px -16px rgba(0, 0, 0, 0.85)',
            color: 'var(--d9-ink)',
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
                color: 'var(--d9-ink)',
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
                color: 'var(--d9-ink-mute)',
              }}
            >
              {description}
            </p>
          )}
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
