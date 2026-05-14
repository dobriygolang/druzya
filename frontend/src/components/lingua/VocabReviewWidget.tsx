// Overview. Pull'ит due cards (react-query), показывает по одной, кнопки
// Reveal / Again / Got it. После последней карточки auto-refetches очередь.
//
// B/W only; #FF3B30 — точка-индикатор для «due > 0» badge (per Sergey rule).
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useReviewVocabMutation, useVocabDueQuery } from '../../lib/queries/lingua'

interface Props {
  /** Compact layout for sidebar (no big title). */
  compact?: boolean
}

export function VocabReviewWidget({ compact = false }: Props) {
  const { t } = useTranslation('lingua')
  const due = useVocabDueQuery()
  const review = useReviewVocabMutation()
  const [idx, setIdx] = useState(0)
  const [revealed, setRevealed] = useState(false)

  const items = due.data ?? []
  const cur = items[idx]

  const tick = useCallback(
    async (correct: boolean) => {
      if (!cur || review.isPending) return
      try {
        await review.mutateAsync({ word: cur.word, correct })
      } catch {
        /* swallow — invalidate from mutation onSuccess still refreshes */
      }
      setRevealed(false)
      const next = idx + 1
      if (next >= items.length) {
        setIdx(0)
      } else {
        setIdx(next)
      }
    },
    [cur, review, idx, items.length],
  )

  if (due.isLoading) {
    return (
      <div className={compact ? 'p-3' : 'p-4'}>
        <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">
          SRS · Daily
        </div>
        <div className="mt-2 text-xs text-text-muted">Loading…</div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className={compact ? 'p-3' : 'p-4'}>
        <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">
          SRS · Daily
        </div>
        <div className="mt-2 text-xs text-text-muted">
          {t('vocab.queue_empty')}
        </div>
      </div>
    )
  }

  if (!cur) return null

  return (
    <div className={compact ? 'border-t border-border p-3' : 'rounded-lg border border-border bg-surface-1 p-4'}>
      <div className="mb-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: '#FF3B30' }} aria-hidden />
          SRS · Daily
        </span>
        <span>
          {idx + 1} / {items.length}
        </span>
      </div>
      <div className="mb-2 text-base font-medium text-text-primary">{cur.word}</div>
      {revealed ? (
        <>
          <div className="mb-1 text-xs text-text-secondary">
            {cur.translation || '(no translation)'}
          </div>
          {cur.contextMd && (
            <div className="mb-2 font-serif text-[11px] italic leading-snug text-text-muted">
              «{cur.contextMd}»
            </div>
          )}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => void tick(false)}
              disabled={review.isPending}
              className="flex-1 rounded-md border border-border bg-transparent px-2.5 py-1 text-[11px] text-text-secondary hover:bg-surface-2 disabled:opacity-50"
            >
              Again
            </button>
            <button
              type="button"
              onClick={() => void tick(true)}
              disabled={review.isPending}
              className="flex-1 rounded-md border border-border-strong bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-text-primary hover:bg-surface-3 disabled:opacity-50"
            >
              Got it
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="w-full rounded-md border border-border bg-transparent px-2.5 py-1 text-[11px] text-text-secondary hover:bg-surface-2"
        >
          Reveal
        </button>
      )}
    </div>
  )
}
