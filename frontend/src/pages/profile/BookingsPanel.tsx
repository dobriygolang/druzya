// ── Bookings panel ─────────────────────────────────────────────────────────
//
// Renders the list returned by useMyBookingsQuery (chi-direct
// GET /api/v1/slot/my/bookings). Each card reflects a (booking, slot) pair —
// derived UI state combines booking.status + slot.status + starts_at:
//   - cancelled: booking was cancelled (terminal)
//   - completed: slot status === 'completed' or 'no_show'
//   - active:    starts in the next 30 минут OR already started but
//                duration window not over
//   - upcoming:  starts later than now
// The "Подключиться" CTA is shown only for active/upcoming с meet_url.
// "Отменить" — only for upcoming (active = слишком поздно).

import { Link } from 'react-router-dom'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { cn } from '../../lib/cn'
import { useMyBookingsQuery, useCancelSlot, type MyBookingItem } from '../../lib/queries/slot'
import { humanizeDifficulty } from '../../lib/labels'

const SECTION_RU: Record<string, string> = {
  algorithms: 'Алгоритмы',
  sql: 'SQL',
  go: 'Go',
  system_design: 'System Design',
  behavioral: 'Behavioral',
}

type BookingState = 'upcoming' | 'active' | 'completed' | 'cancelled'

function deriveBookingState(b: MyBookingItem, now: Date = new Date()): BookingState {
  if (b.status === 'cancelled' || b.slot_status === 'cancelled') return 'cancelled'
  if (b.slot_status === 'completed' || b.slot_status === 'no_show') return 'completed'
  const startMs = new Date(b.starts_at).getTime()
  if (Number.isNaN(startMs)) return 'upcoming'
  const endMs = startMs + b.duration_min * 60_000
  const nowMs = now.getTime()
  if (nowMs >= startMs && nowMs <= endMs) return 'active'
  if (nowMs > endMs) return 'completed'
  // активный, если до старта меньше 30 минут
  if (startMs - nowMs <= 30 * 60_000) return 'active'
  return 'upcoming'
}

function bookingStateLabel(s: BookingState): string {
  switch (s) {
    case 'upcoming': return 'Скоро'
    case 'active': return 'Сейчас'
    case 'completed': return 'Завершено'
    case 'cancelled': return 'Отменено'
  }
}

function bookingStateColor(s: BookingState): string {
  switch (s) {
    case 'upcoming': return 'bg-cyan/15 text-cyan'
    case 'active': return 'bg-success/20 text-success'
    case 'completed': return 'bg-surface-3 text-text-muted'
    case 'cancelled': return 'bg-danger/15 text-danger'
  }
}

function BookingCard({ b }: { b: MyBookingItem }) {
  const cancel = useCancelSlot()
  const state = deriveBookingState(b)
  const sectionLabel = SECTION_RU[b.section] ?? b.section
  const startsDate = new Date(b.starts_at)
  const dateStr = isNaN(startsDate.getTime()) ? b.starts_at : startsDate.toLocaleString('ru-RU', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
  const canJoin = (state === 'upcoming' || state === 'active') && !!b.meet_url
  const canCancel = state === 'upcoming'
  const onCancel = () => {
    if (!confirm('Отменить бронь? Слот вернётся в каталог.')) return
    cancel.mutate(b.slot_id)
  }
  return (
    <Card className="flex-col gap-3 p-4" interactive={false}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-display text-sm font-bold text-text-primary">
            Mock · {sectionLabel}
          </span>
          <span className="font-mono text-[11px] text-text-muted">
            {dateStr} · {b.duration_min} мин
          </span>
        </div>
        <span className={cn('rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase', bookingStateColor(state))}>
          {bookingStateLabel(state)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[12px] text-text-secondary">
        <span>Роль: <span className="text-text-primary">кандидат</span></span>
        {b.difficulty && <span>· Уровень: {humanizeDifficulty(b.difficulty)}</span>}
        <span>· {b.language}</span>
        <span>· {b.price_rub}₽</span>
      </div>
      {(canJoin || canCancel) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {canJoin && b.meet_url && (
            <a
              href={b.meet_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-2 rounded-md bg-accent px-3 text-[12px] font-semibold text-text-primary shadow-glow hover:bg-accent/90"
            >
              Подключиться
            </a>
          )}
          {canCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={cancel.isPending}
            >
              {cancel.isPending ? 'Отменяю…' : 'Отменить'}
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}

export function BookingsPanel() {
  const { data, isLoading, isError, refetch } = useMyBookingsQuery()
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-20 animate-pulse rounded-xl bg-surface-2" />
        <div className="h-20 animate-pulse rounded-xl bg-surface-2" />
      </div>
    )
  }
  if (isError) {
    return (
      <Card className="flex-col items-start gap-3 p-5" interactive={false}>
        <p className="text-sm text-danger">Не удалось загрузить брони.</p>
        <Button size="sm" onClick={() => refetch()}>Повторить</Button>
      </Card>
    )
  }
  const items = data ?? []
  if (items.length === 0) {
    return (
      <Card className="flex-col items-start gap-3 p-5" interactive={false}>
        <p className="text-sm text-text-secondary">
          Нет броней. Запиши слот через{' '}
          <Link to="/slots" className="text-cyan hover:underline">/slots →</Link>
        </p>
      </Card>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {items.map((b) => <BookingCard key={b.id} b={b} />)}
    </div>
  )
}
