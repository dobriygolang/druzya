// SlotsPage renders the Live Mock Interview slot catalogue + booking surface.
// Backed by SlotService (proto/druz9/v1/slot.proto): we hit GET /api/v1/slot
// for the catalogue and POST /api/v1/slot/{id}/book to reserve.
//
// Filtering: section + difficulty go to the wire; priceMax + sort are
// applied client-side (the proto contract has no server-side predicates for
// them yet — see queries/slot.ts comments).
//
// Booked slots are NOT auto-opened in a new tab anymore — the meet_url is
// surfaced via the «Мои слоты» drawer (popup blockers + post-action UX).

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Star, Video, Clock, ArrowUpDown, AlertCircle } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar, type AvatarGradient } from '../components/Avatar'
import { EmptyState } from '../components/EmptyState'
import { MyBookingsDrawer } from '../components/slot/MyBookingsDrawer'
import CreateSlotDialog from '../components/slot/CreateSlotDialog'
import { humanizeDifficulty, humanizeSection } from '../lib/labels'
import {
  isInterviewerOrAdmin,
  useBecomeInterviewer,
  useMyInterviewerApplicationQuery,
  useProfileQuery,
} from '../lib/queries/profile'
import {
  derivePriceBuckets,
  useBookSlot,
  useSlotsQuery,
  type Slot,
  type SlotFilter,
  type SlotSection,
  type SlotSort,
} from '../lib/queries/slot'

const SECTIONS: { key: SlotSection; label: string }[] = [
  { key: 'algorithms', label: 'Algorithms' },
  { key: 'sql', label: 'SQL' },
  { key: 'go', label: 'Go' },
  { key: 'system_design', label: 'System Design' },
  { key: 'behavioral', label: 'Behavioral' },
]

const SORTS: { key: SlotSort; label: string }[] = [
  { key: 'soonest', label: 'Сортировка: ближайшие' },
  { key: 'cheapest', label: 'Сортировка: дешевле' },
  { key: 'top_rated', label: 'Сортировка: рейтинг' },
]

const GRADIENTS: AvatarGradient[] = ['violet-cyan', 'pink-violet', 'cyan-violet', 'success-cyan']

function pickGradient(seed: string): AvatarGradient {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return GRADIENTS[hash % GRADIENTS.length]
}

function fmtPrice(rub: number): string {
  if (rub === 0) return 'Бесплатно'
  return `${rub.toLocaleString('ru-RU')}₽`
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function Header({
  count,
  isError,
  onOpenBookings,
  onCreateSlot,
  onBecomeInterviewer,
  isInterviewer,
  promoting,
  appStatus,
}: {
  count: number
  isError: boolean
  onOpenBookings: () => void
  onCreateSlot: () => void
  onBecomeInterviewer: () => void
  isInterviewer: boolean
  promoting: boolean
  appStatus: 'pending' | 'approved' | 'rejected' | undefined
}) {
  return (
    <div className="flex flex-col items-start gap-4 px-4 pb-4 pt-6 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-20 lg:pt-7">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary">Live Mock Interview</h1>
        <p className="text-sm text-text-secondary">
          {isError
            ? 'Не удалось загрузить слоты'
            : count === 0
              ? 'Сейчас нет открытых слотов — загляни позже'
              : `Peer-mock с реальными разработчиками · ${count} слотов доступно`}
        </p>
      </div>
      <div className="flex gap-3">
        <Button variant="ghost" onClick={onOpenBookings}>Мои слоты</Button>
        {isInterviewer ? (
          <Button onClick={onCreateSlot}>Создать слот</Button>
        ) : appStatus === 'pending' ? (
          <Button disabled>На рассмотрении</Button>
        ) : (
          <Button onClick={onBecomeInterviewer} disabled={promoting}>
            {promoting ? 'Отправляем…' : appStatus === 'rejected' ? 'Подать ещё раз' : 'Стать интервьюером'}
          </Button>
        )}
      </div>
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] ${
        active
          ? 'border-accent bg-accent/15 text-accent-hover'
          : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  )
}

function SortMenu({ value, onChange }: { value: SlotSort; onChange: (s: SlotSort) => void }) {
  const [open, setOpen] = useState(false)
  const current = SORTS.find((s) => s.key === value) ?? SORTS[0]
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-text-secondary"
      >
        <ArrowUpDown className="h-3.5 w-3.5" />
        {current.label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <ul className="absolute right-0 top-full z-20 mt-1 flex min-w-[200px] flex-col rounded-md border border-border bg-surface-1 p-1 shadow-lg">
            {SORTS.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(s.key)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center rounded px-3 py-1.5 text-left text-[13px] hover:bg-surface-2 ${
                    s.key === value ? 'text-accent-hover' : 'text-text-secondary'
                  }`}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function FilterBar({
  filter,
  setFilter,
  priceBuckets,
}: {
  filter: SlotFilter
  setFilter: (f: SlotFilter) => void
  priceBuckets: number[]
}) {
  return (
    <div className="flex flex-col items-start gap-3 px-4 pb-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-20">
      <div className="flex flex-wrap items-center gap-2 overflow-x-auto">
        {SECTIONS.map((s) => (
          <FilterChip
            key={s.key}
            label={s.label}
            active={filter.section === s.key}
            onClick={() =>
              setFilter({ ...filter, section: filter.section === s.key ? undefined : s.key })
            }
          />
        ))}
        {priceBuckets.map((cap) => (
          <FilterChip
            key={cap}
            label={`до ${cap.toLocaleString('ru-RU')}₽`}
            active={filter.priceMax === cap}
            onClick={() =>
              setFilter({ ...filter, priceMax: filter.priceMax === cap ? undefined : cap })
            }
          />
        ))}
      </div>
      <SortMenu
        value={filter.sort ?? 'soonest'}
        onChange={(s) => setFilter({ ...filter, sort: s })}
      />
    </div>
  )
}

function SlotCard({ s, onBook, booking }: { s: Slot; onBook: () => void; booking: boolean }) {
  const initial = s.interviewer.username?.[0]?.toUpperCase() ?? '?'
  const isPast = new Date(s.starts_at).getTime() < Date.now()
  const disabled = booking || s.status !== 'available' || isPast
  const label = isPast
    ? 'Прошло'
    : s.status === 'booked'
      ? 'Занято'
      : s.status === 'cancelled'
        ? 'Отменено'
        : booking
          ? 'Бронируем…'
          : 'Забронировать'
  return (
    <Card className="flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
      <Avatar size="lg" gradient={pickGradient(s.interviewer.user_id)} initials={initial} />
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Link
            to={`/interviewer/${encodeURIComponent(s.interviewer.user_id)}`}
            state={{ username: s.interviewer.username }}
            className="text-sm font-bold text-text-primary hover:text-accent-hover"
          >
            @{s.interviewer.username}
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {typeof s.interviewer.avg_rating === 'number' && s.interviewer.avg_rating > 0 ? (
            <>
              <Star className="h-3.5 w-3.5 fill-warn text-warn" />
              <span className="font-mono text-[12px] font-semibold text-warn">
                {s.interviewer.avg_rating.toFixed(1)}
              </span>
              <span className="font-mono text-[11px] text-text-muted">
                · {s.interviewer.reviews_count ?? 0} отзывов
              </span>
            </>
          ) : (
            <span className="font-mono text-[11px] text-text-muted">Нет рейтинга</span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary">{humanizeSection(s.section)}</span>
          {s.difficulty && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary">{humanizeDifficulty(s.difficulty)}</span>
          )}
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary uppercase">{s.language}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-cyan" />
          <span className="text-sm font-semibold text-text-primary">{fmtTime(s.starts_at)}</span>
        </div>
        <span className="font-mono text-[11px] text-text-muted">{s.duration_min} мин</span>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="rounded-full bg-success/15 px-2.5 py-1 font-mono text-[12px] font-semibold text-success">
          {fmtPrice(s.price_rub)}
        </span>
      </div>
      <Button onClick={onBook} disabled={disabled}>
        {label}
      </Button>
    </Card>
  )
}

function SlotList({
  slots,
  isError,
  isLoading,
  onBook,
  bookingId,
}: {
  slots: Slot[]
  isError: boolean
  isLoading: boolean
  onBook: (id: string) => void
  bookingId: string | null
}) {
  if (isLoading) {
    return <EmptyState variant="loading" skeletonLayout="card-grid" />
  }
  if (isError) {
    return (
      <EmptyState
        variant="error"
        title="Не удалось загрузить слоты"
        body="Попробуй обновить страницу — если проблема повторится, мы уже видим её в логах."
      />
    )
  }
  if (slots.length === 0) {
    return (
      <EmptyState
        variant="no-data"
        title="По выбранным фильтрам слотов нет"
        body="Сбрось часть условий или загляни через пару часов — расписание обновляется."
      />
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-display text-base font-bold text-text-primary">Доступные слоты · {slots.length}</h3>
      {slots.map((s) => (
        <SlotCard key={s.id} s={s} onBook={() => onBook(s.id)} booking={bookingId === s.id} />
      ))}
    </div>
  )
}

function BookingErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs font-semibold text-danger/80 hover:text-danger"
      >
        Закрыть
      </button>
    </div>
  )
}

function PromoCard({
  onApply,
  isInterviewer,
  promoting,
  appStatus,
}: {
  onApply: () => void
  isInterviewer: boolean
  promoting: boolean
  appStatus: 'pending' | 'approved' | 'rejected' | undefined
}) {
  // Render order: role > application status > default invite.
  const title = isInterviewer
    ? 'Ты — интервьюер'
    : appStatus === 'pending'
      ? 'Заявка на рассмотрении'
      : appStatus === 'rejected'
        ? 'Заявка отклонена'
        : 'Стань интервьюером'
  const body = isInterviewer
    ? 'Создавай слоты в каталоге и зарабатывай на mock-интервью.'
    : appStatus === 'pending'
      ? 'Админы посмотрят твою заявку и пришлют решение в течение 48 часов.'
      : appStatus === 'rejected'
        ? 'Можешь подать ещё раз — добавь больше контекста о своём опыте.'
        : 'Зарабатывай на mock-интервью — тариф устанавливаешь сам.'
  const showCta = !isInterviewer && appStatus !== 'pending'
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-gradient-to-br from-accent to-pink p-5 shadow-glow">
      <h3 className="font-display text-lg font-bold text-text-primary">{title}</h3>
      <p className="text-xs text-white/80">{body}</p>
      {showCta && (
        <button
          type="button"
          onClick={onApply}
          disabled={promoting}
          className="inline-flex items-center justify-center rounded-md bg-white/20 px-3.5 py-2 text-xs font-semibold text-text-primary hover:bg-white/30 disabled:opacity-60"
        >
          {promoting ? 'Отправляем…' : appStatus === 'rejected' ? 'Подать ещё раз' : 'Подать заявку'}
        </button>
      )}
    </div>
  )
}

// FreeModeNotice — payments are stubbed in M1; show this until M4 lands.
function FreeModeNotice() {
  return (
    <div className="rounded-md border border-cyan/30 bg-cyan/5 px-3 py-2 text-xs text-cyan">
      Оплата в разработке — все слоты сейчас бесплатные. Цены показываем для прозрачности будущего тарифа.
    </div>
  )
}

function BookedSidebar({ booked, onOpen }: { booked: Slot[]; onOpen: () => void }) {
  if (booked.length === 0) return null
  return (
    <Card className="flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-text-primary">Забронированы</h3>
        <button
          type="button"
          onClick={onOpen}
          className="text-[11px] font-semibold text-accent hover:text-accent-hover"
        >
          Мои слоты →
        </button>
      </div>
      {booked.map((s) => (
        <div key={s.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
          <div className="flex items-center gap-2">
            <Avatar
              size="sm"
              gradient={pickGradient(s.interviewer.user_id)}
              initials={s.interviewer.username?.[0]?.toUpperCase() ?? '?'}
            />
            <span className="text-sm font-semibold text-text-primary">@{s.interviewer.username}</span>
            <span className="ml-auto font-mono text-[11px] text-cyan">{fmtTime(s.starts_at)}</span>
          </div>
          <span className="font-mono text-[11px] text-text-muted">
            {humanizeSection(s.section)} · {s.duration_min} мин
          </span>
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex w-fit items-center gap-1.5 rounded-md bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success hover:bg-success/25"
          >
            <Video className="h-3 w-3" /> Видеозвонок
          </button>
        </div>
      ))}
    </Card>
  )
}

export default function SlotsPage() {
  const [filter, setFilter] = useState<SlotFilter>({ sort: 'soonest' })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [bookErr, setBookErr] = useState<string | null>(null)

  const profile = useProfileQuery()
  const isInterviewer = isInterviewerOrAdmin(profile.data?.role)
  const myApp = useMyInterviewerApplicationQuery()
  const appStatus = myApp.data?.status as 'pending' | 'approved' | 'rejected' | undefined
  const become = useBecomeInterviewer()
  const onBecomeInterviewer = () => {
    become.mutate('', {
      onError: (err) => {
        setBookErr(err instanceof Error ? err.message : 'Не удалось отправить заявку')
      },
    })
  }

  const { data, isError, isLoading } = useSlotsQuery(filter)
  const slots = useMemo(() => data ?? [], [data])

  const priceBuckets = useMemo(() => derivePriceBuckets(slots), [slots])

  const book = useBookSlot()
  const onBook = (id: string) => {
    setBookErr(null)
    book.mutate(id, {
      onSuccess: () => {
        setDrawerOpen(true)
      },
      onError: (err) => {
        setBookErr(err instanceof Error ? err.message : 'Не удалось забронировать слот')
      },
    })
  }

  const bookedSlots = useMemo(() => slots.filter((s) => s.status === 'booked'), [slots])

  return (
    <AppShellV2>
      <Header
        count={slots.length}
        isError={isError}
        onOpenBookings={() => setDrawerOpen(true)}
        onCreateSlot={() => setCreateOpen(true)}
        onBecomeInterviewer={onBecomeInterviewer}
        isInterviewer={isInterviewer}
        promoting={become.isPending}
        appStatus={appStatus}
      />
      <FilterBar filter={filter} setFilter={setFilter} priceBuckets={priceBuckets} />
      <div className="flex flex-col gap-4 px-4 pb-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:pb-7">
        <div className="flex flex-1 flex-col gap-4">
          <FreeModeNotice />
          {bookErr && <BookingErrorBanner message={bookErr} onDismiss={() => setBookErr(null)} />}
          <SlotList
            slots={slots}
            isError={isError}
            isLoading={isLoading}
            onBook={onBook}
            bookingId={book.isPending ? (book.variables as string | null) : null}
          />
        </div>
        <div className="flex w-full flex-col gap-5 lg:w-[380px]">
          <PromoCard
            onApply={onBecomeInterviewer}
            isInterviewer={isInterviewer}
            promoting={become.isPending}
            appStatus={appStatus}
          />
          <BookedSidebar booked={bookedSlots} onOpen={() => setDrawerOpen(true)} />
        </div>
      </div>
      <MyBookingsDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <CreateSlotDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </AppShellV2>
  )
}
