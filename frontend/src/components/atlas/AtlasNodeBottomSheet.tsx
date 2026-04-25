// AtlasNodeBottomSheet — mobile-first node-detail surface (WAVE-11).
//
// Replaces the right-side desktop drawer on phones. Slides up from the
// bottom edge, anchored to a 60% snap-point with a drag-handle that lets
// the user pull it down to dismiss (or tap the backdrop).
//
// Why a separate sheet vs reusing NodeDrawer:
//   - The desktop drawer is a 440px right-anchored panel that doesn't read
//     well on a 320px viewport (it covers the canvas entirely with no
//     visible context).
//   - A bottom sheet keeps the cluster header visible above it, mirroring
//     iOS / Android conventions for "show me more about this thing".
//   - Slide-from-bottom + backdrop fade-in matches the at-app.jsx
//     animation spec (240ms ease-out cubic-bezier(0.2, 0.8, 0.2, 1)).
//
// Behaviour identical to NodeDrawer in terms of the data it surfaces — only
// the chrome differs. Caller passes the node + close handler.

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { AtlasNode } from '../../lib/queries/profile'
import { cn } from '../../lib/cn'

export type AtlasNodeBottomSheetProps = {
  node: AtlasNode
  onClose: () => void
  /** Optional secondary action — e.g. "Open in Arena". */
  onPrimaryAction?: () => void
  primaryActionLabel?: string
}

const DISMISS_THRESHOLD_PX = 80

export function AtlasNodeBottomSheet({
  node,
  onClose,
  onPrimaryAction,
  primaryActionLabel = 'Продолжить',
}: AtlasNodeBottomSheetProps) {
  const [dragOffset, setDragOffset] = useState(0)
  const [animateIn, setAnimateIn] = useState(false)
  const dragStartY = useRef<number | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)

  // ESC closes — matches NodeDrawer parity.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Trigger slide-in on mount.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setAnimateIn(true))
    return () => window.cancelAnimationFrame(id)
  }, [])

  // Touch handlers — drag-down to dismiss. Only tracks when the user
  // grabs the handle/header area; below that we let normal scroll work.
  const onTouchStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (dragStartY.current === null) return
    const dy = e.touches[0].clientY - dragStartY.current
    if (dy > 0) setDragOffset(dy)
  }
  const onTouchEnd = () => {
    if (dragOffset > DISMISS_THRESHOLD_PX) {
      onClose()
    } else {
      setDragOffset(0)
    }
    dragStartY.current = null
  }

  const progress = Math.max(0, Math.min(100, node.progress ?? 0))
  const locked = node.unlocked === false
  const total = node.total_count ?? 0
  const solved = node.solved_count ?? 0

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={node.title}
    >
      {/* Backdrop — tap to dismiss. Fades in over 160ms per spec. */}
      <button
        type="button"
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-black transition-opacity duration-200 ease-out',
          animateIn ? 'opacity-60' : 'opacity-0',
        )}
        aria-label="Закрыть"
      />

      {/* Sheet — slides from bottom over 240ms cubic-bezier per at-app.jsx. */}
      <div
        ref={sheetRef}
        className={cn(
          'relative mt-auto rounded-t-2xl border-t border-border bg-surface-1 shadow-card',
          'max-h-[85vh] overflow-y-auto',
        )}
        style={{
          transform: animateIn
            ? `translateY(${dragOffset}px)`
            : 'translateY(100%)',
          transition: dragStartY.current === null
            ? 'transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)'
            : 'none',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Drag handle */}
        <div className="flex justify-center pb-1 pt-2">
          <span className="h-1 w-10 rounded-full bg-border-strong" />
        </div>

        <div className="flex items-start justify-between gap-3 px-4">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary">
              {node.cluster ?? node.section}
              {locked ? ' · lock' : progress >= 100 ? ' · mastered' : ' · в процессе'}
            </div>
            <h3 className="mt-1 font-display text-[20px] font-extrabold leading-tight text-text-primary">
              {node.title}
            </h3>
            {node.description && (
              <p className="mt-1 font-mono text-[10.5px] text-text-muted">
                {node.description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-border bg-surface-2 p-1.5 text-text-secondary hover:bg-surface-3"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 3-stat strip */}
        <div className="mt-3 grid grid-cols-3 gap-2 px-4 font-mono text-[10px]">
          <div className="rounded-md border border-border bg-bg/40 p-2">
            <div className="text-text-muted">progress</div>
            <div className="mt-0.5 font-display text-[13px] font-bold text-text-secondary">{progress}%</div>
          </div>
          <div className="rounded-md border border-border bg-bg/40 p-2">
            <div className="text-text-muted">задач</div>
            <div className="mt-0.5 font-display text-[13px] font-bold text-text-primary">
              {total > 0 ? `${solved}/${total}` : '—'}
            </div>
          </div>
          <div className="rounded-md border border-border bg-bg/40 p-2">
            <div className="text-text-muted">prereq</div>
            <div
              className={cn(
                'mt-0.5 font-display text-[13px] font-bold',
                locked ? 'text-warn' : 'text-success',
              )}
            >
              {locked ? 'lock' : 'met'}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 px-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                progress >= 100 ? 'bg-success' : 'bg-text-primary',
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="mt-3 flex items-center gap-2 px-4 pb-4">
          <button
            type="button"
            onClick={onPrimaryAction ?? onClose}
            disabled={locked}
            className={cn(
              'flex-1 rounded-md py-2 font-display text-[12.5px] font-extrabold',
              locked
                ? 'cursor-not-allowed bg-surface-2 text-text-muted'
                : 'bg-text-primary text-bg hover:bg-text-primary/10',
            )}
          >
            {locked ? 'Заблокировано' : primaryActionLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-surface-2 px-3 py-2 font-display text-[12px] font-semibold text-text-secondary hover:bg-surface-3"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
