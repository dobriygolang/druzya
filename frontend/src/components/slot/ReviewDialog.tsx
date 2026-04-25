// ReviewDialog — candidate-side form for posting a review on a completed
// mock-interview booking. Backed by useCreateReview (POST /api/v1/review,
// review.proto:CreateReviewRequest).
//
// Star widget is a 5-button row — keyboard-friendly, no external lib.
import { useState } from 'react'
import { Star } from 'lucide-react'
import { useCreateReview, type ReviewDirection } from '../../lib/queries/review'

type Props = {
  open: boolean
  bookingID: string
  /** Direction the form authors. Defaults to candidate→interviewer (the
   *  «Я кандидат» drawer tab) — interviewer-side flows pass the reverse. */
  direction?: ReviewDirection
  /** Counterparty's handle for copy ("@username"). */
  subjectHandle?: string
  onClose: () => void
  onSubmitted?: () => void
}

export default function ReviewDialog({
  open,
  bookingID,
  direction = 'REVIEW_DIRECTION_CANDIDATE_TO_INTERVIEWER',
  subjectHandle,
  onClose,
  onSubmitted,
}: Props) {
  const create = useCreateReview()
  const [rating, setRating] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const isOnCandidate = direction === 'REVIEW_DIRECTION_INTERVIEWER_TO_CANDIDATE'
  const titleVerb = isOnCandidate ? 'Оценить кандидата' : 'Оставить отзыв'

  if (!open) return null

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    if (rating < 1 || rating > 5) {
      setErrorMsg('Поставь оценку от 1 до 5')
      return
    }
    try {
      await create.mutateAsync({
        booking_id: bookingID,
        rating,
        feedback: feedback.trim() || undefined,
        direction,
      })
      onSubmitted?.()
      onClose()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось отправить отзыв')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-lg border border-border bg-surface-1 p-6 shadow-xl"
      >
        <h2 className="font-display mb-1 text-xl font-bold text-text-primary">{titleVerb}</h2>
        <p className="mb-4 text-xs text-text-muted">
          {subjectHandle ? `${isOnCandidate ? 'Кандидат' : 'Интервьюер'} @${subjectHandle}. ` : ''}
          {isOnCandidate
            ? 'Оценка попадёт в карточку кандидата — другие интервьюеры её увидят.'
            : 'Оценка влияет на рейтинг интервьюера в каталоге.'}
        </p>

        <div className="mb-4">
          <div className="mb-1 text-xs uppercase tracking-wide text-text-muted">Оценка</div>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                aria-label={`${n} звёзд`}
                className={`rounded-md p-1.5 ${rating >= n ? 'text-warn' : 'text-text-muted hover:text-text-secondary'}`}
              >
                <Star className={`h-6 w-6 ${rating >= n ? 'fill-warn' : ''}`} />
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1 text-xs uppercase tracking-wide text-text-muted">
            Комментарий (опционально)
          </div>
          <textarea
            rows={4}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            maxLength={1000}
            placeholder="Что было полезно, что можно улучшить?"
            className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-text-primary"
          />
        </div>

        {errorMsg && (
          <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {errorMsg}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-border px-3 text-sm text-text-secondary hover:bg-surface-2"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={create.isPending}
            className="h-9 rounded-md bg-text-primary px-4 text-sm font-semibold text-bg hover:bg-text-primary/90 disabled:opacity-60"
          >
            {create.isPending ? 'Отправляем…' : 'Опубликовать'}
          </button>
        </div>
      </form>
    </div>
  )
}
