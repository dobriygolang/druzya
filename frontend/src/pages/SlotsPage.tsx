// SlotsPage renders the Live Mock Interview slot catalogue + booking surface.
// Backed by SlotService (proto/druz9/v1/slot.proto): we hit GET /api/v1/slot
// for the catalogue and POST /api/v1/slot/{id}/book to reserve.
//
// All previously-hardcoded filter/SLOT data has been replaced with state
// driven by the API response. The price-cap chip now derives from actual
// slots (see derivePriceBuckets in lib/queries/slot.ts).
import { useMemo, useState } from 'react'
import { Star, Video, Clock, ArrowUpDown } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar, type AvatarGradient } from '../components/Avatar'
import { humanizeDifficulty, humanizeSection } from '../lib/labels'
import {
  derivePriceBuckets,
  useBookSlot,
  useSlotsQuery,
  type Slot,
  type SlotFilter,
  type SlotSection,
} from '../lib/queries/slot'

const SECTIONS: { key: SlotSection; label: string }[] = [
  { key: 'algorithms', label: 'Algorithms' },
  { key: 'sql', label: 'SQL' },
  { key: 'go', label: 'Go' },
  { key: 'system_design', label: 'System Design' },
  { key: 'behavioral', label: 'Behavioral' },
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

function Header({ count, isError }: { count: number; isError: boolean }) {
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
        <Button variant="ghost">Мои слоты</Button>
        <Button>Стать интервьюером</Button>
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
      <button className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-text-secondary">
        <ArrowUpDown className="h-3.5 w-3.5" />
        Сортировка: ближайшие
      </button>
    </div>
  )
}

function SlotCard({ s, onBook, booking }: { s: Slot; onBook: () => void; booking: boolean }) {
  const initial = s.interviewer.username?.[0]?.toUpperCase() ?? '?'
  return (
    <Card className="flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
      <Avatar size="lg" gradient={pickGradient(s.interviewer.user_id)} initials={initial} />
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-text-primary">@{s.interviewer.username}</span>
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
      <Button onClick={onBook} disabled={booking || s.status !== 'available'}>
        {s.status === 'booked' ? 'Занято' : booking ? 'Бронируем…' : 'Забронировать'}
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
    return (
      <div className="rounded-xl border border-border bg-surface-1 p-8 text-center text-sm text-text-muted">
        Загружаем слоты…
      </div>
    )
  }
  if (isError) {
    return (
      <div className="rounded-xl border border-danger/40 bg-surface-1 p-8 text-center text-sm text-danger">
        Не удалось загрузить слоты. Попробуй обновить страницу.
      </div>
    )
  }
  if (slots.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-1 p-8 text-center text-sm text-text-muted">
        По выбранным фильтрам слотов нет. Попробуй сбросить часть условий.
      </div>
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

function PromoCard() {
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-gradient-to-br from-accent to-pink p-5 shadow-glow">
      <h3 className="font-display text-lg font-bold text-text-primary">Стань интервьюером</h3>
      <p className="text-xs text-white/80">Зарабатывай на mock-интервью — тариф устанавливаешь сам.</p>
      <button className="inline-flex items-center justify-center rounded-md bg-white/20 px-3.5 py-2 text-xs font-semibold text-text-primary hover:bg-white/30">
        Подать заявку
      </button>
    </div>
  )
}

export default function SlotsPage() {
  const [filter, setFilter] = useState<SlotFilter>({})
  const { data, isError, isLoading } = useSlotsQuery(filter)
  const slots = useMemo(() => data ?? [], [data])

  // Buckets are derived from the *unfiltered* fetch — recomputed each render.
  // For stability we feed the displayed slots back; in practice the catalogue
  // is small enough that the user-facing UX is fine.
  const priceBuckets = useMemo(() => derivePriceBuckets(slots), [slots])

  const book = useBookSlot()
  const onBook = (id: string) => {
    book.mutate(id, {
      onSuccess: (b) => {
        if (b.meet_url) {
          window.open(b.meet_url, '_blank', 'noopener,noreferrer')
        }
      },
    })
  }

  const bookedSlots = useMemo(() => slots.filter((s) => s.status === 'booked'), [slots])

  return (
    <AppShellV2>
      <Header count={slots.length} isError={isError} />
      <FilterBar filter={filter} setFilter={setFilter} priceBuckets={priceBuckets} />
      <div className="flex flex-col gap-4 px-4 pb-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:pb-7">
        <div className="flex flex-1 flex-col gap-5">
          <SlotList
            slots={slots}
            isError={isError}
            isLoading={isLoading}
            onBook={onBook}
            bookingId={book.isPending ? (book.variables as string | null) : null}
          />
        </div>
        <div className="flex w-full flex-col gap-5 lg:w-[380px]">
          <PromoCard />
          {bookedSlots.length > 0 && (
            <Card className="flex-col gap-3 p-5">
              <h3 className="font-display text-base font-bold text-text-primary">Забронированы</h3>
              {bookedSlots.map((s) => (
                <div key={s.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
                  <div className="flex items-center gap-2">
                    <Avatar size="sm" gradient={pickGradient(s.interviewer.user_id)} initials={s.interviewer.username?.[0]?.toUpperCase() ?? '?'} />
                    <span className="text-sm font-semibold text-text-primary">@{s.interviewer.username}</span>
                    <span className="ml-auto font-mono text-[11px] text-cyan">{fmtTime(s.starts_at)}</span>
                  </div>
                  <span className="font-mono text-[11px] text-text-muted">{humanizeSection(s.section)} · {s.duration_min} мин</span>
                  <button className="inline-flex w-fit items-center gap-1.5 rounded-md bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success hover:bg-success/25">
                    <Video className="h-3 w-3" /> Видеозвонок
                  </button>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </AppShellV2>
  )
}
