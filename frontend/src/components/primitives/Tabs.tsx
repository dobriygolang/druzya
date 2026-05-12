/**
 * druz9 Tabs — web (Framer Motion `layoutId` underline glide).
 *
 * Foundation Tabs primitive. NEW building block — does NOT replace existing
 * tab implementations (BoardsTabsChrome, EnglishTabsChrome, components/Tabs.tsx,
 * etc.). Those migrate in a follow-up task.
 *
 * Contract (visual-language v2):
 *  - role=tablist + role=tab + aria-selected/aria-controls + roving tabindex
 *  - ArrowLeft/ArrowRight move focus AND selection
 *  - Home / End jump to first / last enabled tab
 *  - Enter / Space activate focused tab
 *  - `underline` variant: 1.5px white underline glides between active tabs
 *    via Framer `layoutId` shared element. Inactive: transparent underline,
 *    color var(--ink-60). Hover inactive: color rgb(var(--ink)).
 *  - `segmented` variant: bordered container, active tab gets bg
 *    rgba(255,255,255,0.08) and border var(--hair-2) — compact density.
 *  - Optional count badge: small pill right of label (fontSize 10, opacity 0.6).
 */

import { motion } from 'framer-motion'
import { useCallback, useId, useRef, type KeyboardEvent } from 'react'

export interface TabItem {
  id: string
  label: string
  count?: number
  disabled?: boolean
}

export interface TabsProps {
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  variant?: 'underline' | 'segmented'
  size?: 'sm' | 'md'
  ariaLabel?: string
}

const SIZE_PAD: Record<NonNullable<TabsProps['size']>, { px: number; py: number; fontSize: number }> = {
  sm: { px: 10, py: 6, fontSize: 12 },
  md: { px: 14, py: 8, fontSize: 13 },
}

export function Tabs({
  items,
  value,
  onChange,
  variant = 'underline',
  size = 'md',
  ariaLabel,
}: TabsProps) {
  const listId = useId()
  const layoutId = `tabs-underline-${listId}`
  const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const pad = SIZE_PAD[size]

  const setBtnRef = useCallback(
    (id: string) => (el: HTMLButtonElement | null) => {
      if (el) btnRefs.current.set(id, el)
      else btnRefs.current.delete(id)
    },
    [],
  )

  const focusAndActivate = useCallback(
    (id: string) => {
      onChange(id)
      const el = btnRefs.current.get(id)
      el?.focus()
    },
    [onChange],
  )

  const moveFocus = useCallback(
    (delta: 1 | -1) => {
      const enabled = items.filter((it) => !it.disabled)
      if (enabled.length === 0) return
      const idx = enabled.findIndex((it) => it.id === value)
      const nextIdx = (idx + delta + enabled.length) % enabled.length
      focusAndActivate(enabled[nextIdx].id)
    },
    [items, value, focusAndActivate],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        moveFocus(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        moveFocus(-1)
      } else if (e.key === 'Home') {
        const first = items.find((it) => !it.disabled)
        if (first) {
          e.preventDefault()
          focusAndActivate(first.id)
        }
      } else if (e.key === 'End') {
        const enabled = items.filter((it) => !it.disabled)
        const last = enabled[enabled.length - 1]
        if (last) {
          e.preventDefault()
          focusAndActivate(last.id)
        }
      }
    },
    [items, moveFocus, focusAndActivate],
  )

  if (variant === 'segmented') {
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        style={{
          display: 'inline-flex',
          gap: 2,
          padding: 2,
          border: '1px solid var(--hair)',
          borderRadius: 8,
          background: 'transparent',
        }}
      >
        {items.map((it) => {
          const active = it.id === value
          return (
            <button
              key={it.id}
              ref={setBtnRef(it.id)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${listId}-panel-${it.id}`}
              id={`${listId}-tab-${it.id}`}
              tabIndex={active ? 0 : -1}
              disabled={it.disabled}
              onClick={() => !it.disabled && onChange(it.id)}
              style={{
                appearance: 'none',
                border: active ? '1px solid var(--hair-2)' : '1px solid transparent',
                background: active ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                color: active ? 'rgb(var(--ink))' : 'var(--ink-60)',
                padding: `${pad.py}px ${pad.px}px`,
                borderRadius: 6,
                fontSize: pad.fontSize,
                lineHeight: 1.2,
                cursor: it.disabled ? 'not-allowed' : 'pointer',
                opacity: it.disabled ? 0.4 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                transition: `background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard)`,
              }}
            >
              <span>{it.label}</span>
              {typeof it.count === 'number' && (
                <span style={{ fontSize: 10, opacity: 0.6 }}>{it.count}</span>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  // underline variant
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      style={{
        display: 'inline-flex',
        gap: 4,
        borderBottom: '1px solid var(--hair)',
      }}
    >
      {items.map((it) => {
        const active = it.id === value
        return (
          <button
            key={it.id}
            ref={setBtnRef(it.id)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`${listId}-panel-${it.id}`}
            id={`${listId}-tab-${it.id}`}
            tabIndex={active ? 0 : -1}
            disabled={it.disabled}
            onClick={() => !it.disabled && onChange(it.id)}
            onMouseEnter={(e) => {
              if (!active && !it.disabled) {
                e.currentTarget.style.color = 'rgb(var(--ink))'
              }
            }}
            onMouseLeave={(e) => {
              if (!active && !it.disabled) {
                e.currentTarget.style.color = 'var(--ink-60)'
              }
            }}
            style={{
              position: 'relative',
              appearance: 'none',
              border: 'none',
              background: 'transparent',
              color: active ? 'rgb(var(--ink))' : 'var(--ink-60)',
              padding: `${pad.py}px ${pad.px}px`,
              fontSize: pad.fontSize,
              lineHeight: 1.2,
              cursor: it.disabled ? 'not-allowed' : 'pointer',
              opacity: it.disabled ? 0.4 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition: `color var(--motion-dur-small) var(--motion-ease-standard)`,
            }}
          >
            <span>{it.label}</span>
            {typeof it.count === 'number' && (
              <span style={{ fontSize: 10, opacity: 0.6 }}>{it.count}</span>
            )}
            {active && (
              <motion.span
                layoutId={layoutId}
                aria-hidden
                transition={{
                  type: 'tween',
                  duration: 0.16,
                  ease: [0.2, 0.7, 0.2, 1],
                }}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: -1,
                  height: 1.5,
                  background: 'rgb(var(--ink))',
                }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
