// NotificationsDrawer — slide-from-right panel (desktop, 400px) and
// bottom-sheet (mobile, max-h 85vh). Owns its data via the existing
// useNotificationsQuery / useMarkRead / useMarkAllRead hooks; the parent
// only controls open/close.
//
// Tabs:           Все · Непрочитанные · Упоминания
// Filter chips:   Match · Achievement · Coach · Friend · System (channel sub-filter)
// Footer:         "Прочитать все" + "Открыть все →" → /notifications
//
// Behavior:
//   - Backdrop click closes
//   - Escape key closes
//   - body scroll-lock while open (preserves visual stability)
//   - Empty list → <EmptyState variant="no-data" /> (anti-fallback)
//   - Backend error → <EmptyState variant="error" />
//
// Animation: framer-motion AnimatePresence; honors prefers-reduced-motion.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { EmptyState } from '../EmptyState'
import {
  useNotificationsQuery,
  useMarkRead,
  useMarkAllRead,
  type NotificationFilter,
  type NotificationItem,
} from '../../lib/queries/notifications'
import { NotificationCard, kindFromType, type CardKind } from './NotificationCard'

export type NotificationsDrawerProps = {
  open: boolean
  onClose: () => void
}

type Tab = 'all' | 'unread' | 'mentions'

type ChipKind = 'all' | CardKind

const CHIPS: { id: ChipKind; label: string }[] = [
  { id: 'all', label: 'Всё' },
  { id: 'match-invite', label: 'Match' },
  { id: 'achievement-unlocked', label: 'Achievement' },
  { id: 'coach-insight-ready', label: 'Coach' },
  { id: 'system-alert', label: 'System' },
]

export function NotificationsDrawer({ open, onClose }: NotificationsDrawerProps) {
  const navigate = useNavigate()
  const reduced = useReducedMotion()
  const [tab, setTab] = useState<Tab>('all')
  const [chip, setChip] = useState<ChipKind>('all')

  // Tab → backend filter. The "mentions" tab is a client-side derived view
  // (we don't have a `mention=1` flag on the API yet) — see filtered useMemo.
  const filter: NotificationFilter = tab === 'unread' ? { unread: true } : {}

  const list = useNotificationsQuery(filter)
  const markRead = useMarkRead()
  const markAll = useMarkAllRead()

  // Client-side compose: tab=mentions → keep items with payload.mention=true OR
  // type explicitly tagged "*_mention". Prevents lying about a backend
  // capability that doesn't exist; if no items match it just shows empty
  // state honestly.
  const items = useMemo(() => {
    const raw = list.data?.items ?? []
    let filtered = raw
    if (tab === 'mentions') {
      filtered = filtered.filter(
        (n) => n.payload?.mention === true || n.type.includes('mention'),
      )
    }
    if (chip !== 'all') {
      filtered = filtered.filter((n) => kindFromType(n.type) === chip)
    }
    return filtered
  }, [list.data?.items, tab, chip])

  const unreadCount = useMemo(
    () => (list.data?.items ?? []).filter((n) => n.read_at == null).length,
    [list.data?.items],
  )

  // Escape key + body scroll lock while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  const navigateAndClose = (path: string) => {
    onClose()
    navigate(path)
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Уведомления">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* Panel — bottom-sheet on mobile, side-drawer on sm+ */}
          <motion.aside
            initial={reduced ? { opacity: 0 } : { x: '100%', y: 0 }}
            animate={reduced ? { opacity: 1 } : { x: 0, y: 0 }}
            exit={reduced ? { opacity: 0 } : { x: '100%', y: 0 }}
            transition={{ duration: reduced ? 0 : 0.25, ease: 'easeOut' }}
            className={cn(
              // Mobile: bottom-sheet
              'absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-border bg-surface-1 shadow-card',
              // Desktop: right-edge drawer
              'sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:h-full sm:w-[400px] sm:rounded-none sm:border-l sm:border-t-0',
            )}
          >
            <Header onClose={onClose} />

            <div className="border-b border-border px-4">
              <div className="flex gap-1 pt-1">
                {(['all', 'unread', 'mentions'] as Tab[]).map((t) => (
                  <TabButton key={t} active={tab === t} onClick={() => setTab(t)}>
                    {t === 'all' ? 'Все' : t === 'unread' ? 'Непрочитанные' : 'Упоминания'}
                  </TabButton>
                ))}
              </div>
              <div className="flex gap-2 overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {CHIPS.map((c) => (
                  <ChipButton key={c.id} active={chip === c.id} onClick={() => setChip(c.id)}>
                    {c.label}
                  </ChipButton>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {list.isLoading ? (
                <div className="flex flex-col gap-2 p-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-16 animate-pulse rounded bg-surface-2" />
                  ))}
                </div>
              ) : list.isError ? (
                <EmptyState
                  variant="error"
                  title="Не удалось загрузить уведомления"
                  body="Сервис недоступен. Попробуй ещё раз через минуту."
                  cta={{ label: 'Повторить', onClick: () => list.refetch() }}
                  compact
                />
              ) : items.length === 0 ? (
                <EmptyState variant="no-data" title="Нет уведомлений · отдыхай" body={null} compact />
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {items.map((n: NotificationItem) => (
                    <li key={n.id}>
                      <NotificationCard
                        item={n}
                        onMarkRead={(id) => markRead.mutate(id)}
                        onAcceptMatch={(mid) => navigateAndClose(`/arena/match/${mid}`)}
                        onDeclineMatch={(mid) => navigateAndClose(`/arena/match/${mid}?decline=1`)}
                        onOpenInsight={() => navigateAndClose('/weekly')}
                        onOpenAchievement={() => navigateAndClose('/profile?tab=achievements')}
                        onOpenSystem={(href) => navigateAndClose(href)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Footer */}
            <div
              className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-surface-1 px-4 py-3"
              style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
            >
              <button
                type="button"
                onClick={() => unreadCount > 0 && markAll.mutate()}
                disabled={unreadCount === 0 || markAll.isPending}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold text-text-secondary hover:bg-surface-2 hover:text-text-primary disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" /> Прочитать все
              </button>
              <button
                type="button"
                onClick={() => navigateAndClose('/notifications')}
                className="inline-flex items-center gap-1.5 rounded-md bg-text-primary px-3 py-1.5 text-[12px] font-semibold text-bg hover:bg-text-primary-hover"
              >
                Открыть все <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  )
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">Notifications</span>
        <span
          className="font-display text-lg font-bold"
          style={{
            background: 'linear-gradient(90deg, rgb(244,114,182), rgb(34,211,238))',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          Уведомления
        </span>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Закрыть"
        className="grid h-8 w-8 place-items-center rounded-md text-text-secondary hover:bg-surface-2 hover:text-text-primary"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition-colors',
        active ? 'bg-surface-2 text-text-primary' : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
      )}
    >
      {children}
    </button>
  )
}

function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors',
        active
          ? 'border-text-primary bg-text-primary/15 text-text-primary'
          : 'border-border bg-surface-2 text-text-muted hover:text-text-primary',
      )}
    >
      {children}
    </button>
  )
}
