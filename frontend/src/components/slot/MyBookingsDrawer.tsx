// MyBookingsDrawer — slide-from-right panel listing the current user's
// active bookings. Backed by useMyBookingsQuery (GET /api/v1/slot/my/bookings).
//
// Behavior:
//   - Backdrop click + Escape → close
//   - body scroll-lock while open
//   - Empty / error / loading states use the EmptyState component for parity
//     with the rest of the app
//   - "Видеозвонок" opens meet_url in a new tab; "Отменить" hits CancelSlot
//     with inline confirm + error surface
import { useEffect, useState } from 'react'
import { Video, X } from 'lucide-react'
import { Button } from '../Button'
import { EmptyState } from '../EmptyState'
import { humanizeDifficulty, humanizeSection } from '../../lib/labels'
import { useCancelSlot, useMyBookingsQuery, type MyBookingItem } from '../../lib/queries/slot'

export type MyBookingsDrawerProps = {
  open: boolean
  onClose: () => void
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function MyBookingsDrawer({ open, onClose }: MyBookingsDrawerProps) {
  // Lazily fetch — only when drawer is open. Cuts unnecessary requests on /slots.
  const list = useMyBookingsQuery({ enabled: open })

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/60" />
      <aside
        className="flex w-full max-w-md flex-col gap-4 overflow-y-auto bg-surface-1 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-text-primary">Мои бронирования</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {list.isLoading && (
          <EmptyState variant="loading" skeletonLayout="single-card" />
        )}

        {list.isError && (
          <EmptyState
            variant="error"
            title="Не удалось загрузить бронирования"
            body="Попробуй обновить страницу или зайти позже."
          />
        )}

        {!list.isLoading && !list.isError && (list.data?.length ?? 0) === 0 && (
          <EmptyState
            variant="no-data"
            title="Ты ещё ничего не забронировал"
            body="Выбери слот в каталоге слева — он появится здесь."
          />
        )}

        <ul className="flex flex-col gap-3">
          {(list.data ?? []).map((b) => (
            <BookingRow key={b.id} item={b} />
          ))}
        </ul>
      </aside>
    </div>
  )
}

function BookingRow({ item }: { item: MyBookingItem }) {
  const cancel = useCancelSlot()
  const [confirming, setConfirming] = useState(false)
  const isPast = new Date(item.starts_at).getTime() < Date.now()
  const cancelled = item.slot_status === 'cancelled' || item.status === 'cancelled'
  const errMsg = cancel.isError ? (cancel.error instanceof Error ? cancel.error.message : 'Не удалось отменить') : null

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-text-primary">
          {humanizeSection(item.section)}
          {item.difficulty && (
            <span className="ml-1.5 text-xs font-normal text-text-secondary">· {humanizeDifficulty(item.difficulty)}</span>
          )}
        </span>
        <span className="font-mono text-[11px] text-cyan">{fmtTime(item.starts_at)}</span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-text-muted">
        <span>{item.duration_min} мин</span>
        <span>·</span>
        <span className="uppercase">{item.language}</span>
        {item.price_rub > 0 && <><span>·</span><span>{item.price_rub.toLocaleString('ru-RU')}₽</span></>}
        {cancelled && <><span>·</span><span className="text-danger">отменено</span></>}
      </div>

      {errMsg && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">
          {errMsg}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {item.meet_url && !cancelled && (
          <a
            href={item.meet_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success hover:bg-success/25"
          >
            <Video className="h-3 w-3" /> Видеозвонок
          </a>
        )}
        {!cancelled && !isPast && (
          confirming ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  cancel.mutate(item.slot_id, {
                    onSuccess: () => setConfirming(false),
                  })
                }}
                disabled={cancel.isPending}
              >
                {cancel.isPending ? 'Отменяем…' : 'Подтвердить'}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={cancel.isPending}>
                Назад
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              Отменить
            </Button>
          )
        )}
      </div>
    </li>
  )
}
