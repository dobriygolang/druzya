// MyBookingsDrawer — slide-from-right panel with two tabs:
//   "Я кандидат"   → useMyBookingsQuery     (slots I booked)
//   "Я интервьюер" → useHostedBookingsQuery (slots I hosted)
//
// Each tab shows the same row layout but with side-specific actions:
// candidate side gets «Отменить» + candidate→interviewer review,
// interviewer side gets only the interviewer→candidate review CTA.
// Behavior:
//   - Backdrop click + Escape → close
//   - body scroll-lock while open
//   - Empty / error / loading states use the EmptyState component
//   - "Видеозвонок" opens meet_url in a new tab
import { useEffect, useState } from 'react'
import { Star, Video, X } from 'lucide-react'
import { Button } from '../Button'
import { EmptyState } from '../EmptyState'
import ReviewDialog from './ReviewDialog'
import { humanizeDifficulty, humanizeSection } from '../../lib/labels'
import { isInterviewerOrAdmin, useProfileQuery } from '../../lib/queries/profile'
import {
  useCancelSlot,
  useHostedBookingsQuery,
  useMyBookingsQuery,
  type HostedBookingItem,
  type MyBookingItem,
} from '../../lib/queries/slot'

export type MyBookingsDrawerProps = {
  open: boolean
  onClose: () => void
}

type Tab = 'candidate' | 'interviewer'

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function MyBookingsDrawer({ open, onClose }: MyBookingsDrawerProps) {
  const profile = useProfileQuery()
  const isInterviewer = isInterviewerOrAdmin(profile.data?.role)
  const [tab, setTab] = useState<Tab>('candidate')

  // Lazily fetch — only when drawer is open AND the tab is active.
  const candidateList = useMyBookingsQuery({ enabled: open && tab === 'candidate' })
  const hostedList = useHostedBookingsQuery({ enabled: open && tab === 'interviewer' && isInterviewer })

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

  const list = tab === 'candidate' ? candidateList : hostedList
  const items = list.data ?? []

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-black/60" />
      <aside
        className="flex w-full max-w-md flex-col gap-4 overflow-y-auto bg-surface-1 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-text-primary">Мои сессии</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-secondary hover:bg-surface-2 hover:text-text-primary"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {isInterviewer && (
          <div className="flex gap-2">
            <TabButton active={tab === 'candidate'} onClick={() => setTab('candidate')}>
              Я кандидат
            </TabButton>
            <TabButton active={tab === 'interviewer'} onClick={() => setTab('interviewer')}>
              Я интервьюер
            </TabButton>
          </div>
        )}

        {list.isLoading && <EmptyState variant="loading" skeletonLayout="single-card" />}
        {list.isError && (
          <EmptyState
            variant="error"
            title="Не удалось загрузить список"
            body="Попробуй обновить страницу или зайти позже."
          />
        )}
        {!list.isLoading && !list.isError && items.length === 0 && (
          <EmptyState
            variant="no-data"
            title={tab === 'candidate' ? 'Ты ещё ничего не забронировал' : 'У тебя нет проведённых сессий'}
            body={
              tab === 'candidate'
                ? 'Выбери слот в каталоге слева — он появится здесь.'
                : 'Когда кандидаты забронируют твои слоты, они окажутся здесь.'
            }
          />
        )}

        <ul className="flex flex-col gap-3">
          {tab === 'candidate'
            ? (candidateList.data ?? []).map((b) => <CandidateRow key={b.id} item={b} />)
            : (hostedList.data ?? []).map((b) => <HostedRow key={b.id} item={b} />)}
        </ul>
      </aside>
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
      className={`rounded-full border px-3 py-1 text-[12px] ${
        active
          ? 'border-text-primary bg-text-primary/15 text-text-primary'
          : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  )
}

// ── candidate-side row (own bookings) ─────────────────────────────────────

function CandidateRow({ item }: { item: MyBookingItem }) {
  const cancel = useCancelSlot()
  const [confirming, setConfirming] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const isPast = new Date(item.starts_at).getTime() < Date.now()
  const cancelled = item.slot_status === 'cancelled' || item.status === 'cancelled'
  const reviewable = item.slot_status === 'completed' && !item.has_review
  const errMsg = cancel.isError ? (cancel.error instanceof Error ? cancel.error.message : 'Не удалось отменить') : null

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
      <RowHeader
        title={`${humanizeSection(item.section)}${item.difficulty ? ` · ${humanizeDifficulty(item.difficulty)}` : ''}`}
        startsAt={item.starts_at}
      />
      <RowSubline
        durationMin={item.duration_min}
        language={item.language}
        priceRub={item.price_rub}
        cancelled={cancelled}
      />
      {errMsg && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[11px] text-danger">
          {errMsg}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {item.meet_url && !cancelled && <MeetLink href={item.meet_url} />}
        {!cancelled && !isPast &&
          (confirming ? (
            <>
              <Button
                variant="ghost"
                onClick={() => cancel.mutate(item.slot_id, { onSuccess: () => setConfirming(false) })}
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
          ))}
        {reviewable && <ReviewCta label="Оценить интервьюера" onClick={() => setReviewOpen(true)} />}
        {item.has_review && <ReviewedChip />}
      </div>
      <ReviewDialog
        open={reviewOpen}
        bookingID={item.id}
        direction="REVIEW_DIRECTION_CANDIDATE_TO_INTERVIEWER"
        onClose={() => setReviewOpen(false)}
      />
    </li>
  )
}

// ── interviewer-side row (hosted sessions) ────────────────────────────────

function HostedRow({ item }: { item: HostedBookingItem }) {
  const [reviewOpen, setReviewOpen] = useState(false)
  const cancelled = item.slot_status === 'cancelled' || item.status === 'cancelled'
  const reviewable = item.slot_status === 'completed' && !item.has_review

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
      <RowHeader
        title={`@${item.candidate_username || 'кандидат'} · ${humanizeSection(item.section)}`}
        startsAt={item.starts_at}
      />
      <RowSubline
        durationMin={item.duration_min}
        language={item.language}
        priceRub={item.price_rub}
        cancelled={cancelled}
      />
      <div className="flex flex-wrap items-center gap-2">
        {item.meet_url && !cancelled && <MeetLink href={item.meet_url} />}
        {reviewable && (
          <ReviewCta label="Оценить кандидата" onClick={() => setReviewOpen(true)} />
        )}
        {item.has_review && <ReviewedChip />}
      </div>
      <ReviewDialog
        open={reviewOpen}
        bookingID={item.id}
        direction="REVIEW_DIRECTION_INTERVIEWER_TO_CANDIDATE"
        subjectHandle={item.candidate_username}
        onClose={() => setReviewOpen(false)}
      />
    </li>
  )
}

// ── shared row primitives ─────────────────────────────────────────────────

function RowHeader({ title, startsAt }: { title: string; startsAt: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-semibold text-text-primary">{title}</span>
      <span className="font-mono text-[11px] text-text-secondary">{fmtTime(startsAt)}</span>
    </div>
  )
}

function RowSubline({
  durationMin,
  language,
  priceRub,
  cancelled,
}: {
  durationMin: number
  language: string
  priceRub: number
  cancelled: boolean
}) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-text-muted">
      <span>{durationMin} мин</span>
      <span>·</span>
      <span className="uppercase">{language}</span>
      {priceRub > 0 && (
        <>
          <span>·</span>
          <span>{priceRub.toLocaleString('ru-RU')}₽</span>
        </>
      )}
      {cancelled && (
        <>
          <span>·</span>
          <span className="text-danger">отменено</span>
        </>
      )}
    </div>
  )
}

function MeetLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success hover:bg-success/25"
    >
      <Video className="h-3 w-3" /> Видеозвонок
    </a>
  )
}

function ReviewCta({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1 text-[11px] font-semibold text-warn hover:bg-warn/20"
    >
      <Star className="h-3 w-3" /> {label}
    </button>
  )
}

function ReviewedChip() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-text-muted">
      <Star className="h-3 w-3 fill-warn text-warn" /> Отзыв оставлен
    </span>
  )
}
