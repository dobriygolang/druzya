// NotificationsBell — header bell-icon with live badge + drawer trigger.
//
// State machine:
//   - `idle`  : badge sits quietly (red pill if unreadCount > 0, hidden if 0)
//   - `pulse` : briefly (3s) animates after the unread count INCREASES during
//               the current session — i.e. a new notification just arrived.
//
// Pulse detection: we hold prev-count in a ref and trigger only on
// `next > prev`. Initial mount (`prev === undefined`) does NOT pulse — it
// represents existing/unseen items, not "new arrival now".
//
// Display rules (matches MobileBottomNav badge):
//   0       → no badge (silent)
//   1..99   → red pill with number
//   100+    → "99+"
//
// Click opens <NotificationsDrawer />, which the parent owns; this component
// is purely presentational + state-trigger. Push-toast / browser-Notification
// API for tab-inactive case is OUT OF SCOPE — see TODO at bottom.

import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { cn } from '../../lib/cn'

export type NotificationsBellProps = {
  unreadCount: number
  onClick: () => void
  /** Optional aria override (i18n callsite). Defaults to a Russian fallback. */
  ariaLabel?: string
}

export function NotificationsBell({ unreadCount, onClick, ariaLabel }: NotificationsBellProps) {
  const prev = useRef<number | undefined>(undefined)
  const [pulse, setPulse] = useState(false)

  useEffect(() => {
    if (prev.current !== undefined && unreadCount > prev.current) {
      setPulse(true)
      const id = window.setTimeout(() => setPulse(false), 3000)
      prev.current = unreadCount
      return () => window.clearTimeout(id)
    }
    prev.current = unreadCount
  }, [unreadCount])

  const has = unreadCount > 0
  const label =
    ariaLabel ??
    (has ? `Уведомления, непрочитанных: ${unreadCount}` : 'Уведомления')

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'relative grid h-9 w-9 place-items-center rounded-md text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary',
      )}
    >
      <Bell className="h-5 w-5" strokeWidth={2} />
      {has && (
        <span
          className={cn(
            'absolute -top-0.5 -right-0.5 grid place-items-center rounded-full bg-danger',
            'font-mono font-bold text-white ring-2 ring-bg tabular-nums',
            'h-[15px] min-w-[15px] px-1 text-[8px]',
            // Pulse uses CSS box-shadow ripple; defined inline to avoid a global
            // keyframe collision (the wrapper HTML uses the same name).
            pulse && 'animate-[notif-pulse_1.4s_ease-out_3]',
          )}
          aria-hidden={false}
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
      {/* Inline keyframes — scoped via uniquely-named animation. */}
      <style>{`
        @keyframes notif-pulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.55); }
          50%     { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
        }
      `}</style>
    </button>
  )
}

// TODO(WAVE-12): when document.hidden is true and a new notification lands,
// fall back to the Notifications API (with permission) so the user gets a
// native banner instead of a silent badge bump. Out of scope for WAVE-11.
