// Simple modal: kind picker + title + optional source + optional minutes.
// При submit добавляет в lib/activity store → ActivityFeed reactively
// рендерит + F3 readiness реагирует boost'ом.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from './Button'
import { Modal } from './primitives/Modal'
import { logActivity, type ActivityKind } from '../lib/activity'
import { cn } from '../lib/cn'

interface Props {
  onClose: () => void
  /** Optional pre-fill from DailyPlanCard action click. */
  preset?: {
    kind: ActivityKind
    title: string
    source?: string
  }
}

interface KindOption {
  id: ActivityKind
  label: string
  hint: string
}

export function QuickLogModal({ onClose, preset }: Props) {
  const { t } = useTranslation('common')
  const KIND_OPTIONS: KindOption[] = [
    { id: 'mock', label: t('quick_log.kind.mock.label'), hint: t('quick_log.kind.mock.hint') },
    { id: 'leetcode', label: t('quick_log.kind.leetcode.label'), hint: t('quick_log.kind.leetcode.hint') },
    { id: 'reading', label: t('quick_log.kind.reading.label'), hint: t('quick_log.kind.reading.hint') },
    { id: 'coach', label: t('quick_log.kind.coach.label'), hint: t('quick_log.kind.coach.hint') },
    { id: 'focus_block', label: t('quick_log.kind.focus_block.label'), hint: t('quick_log.kind.focus_block.hint') },
    { id: 'reflection', label: t('quick_log.kind.reflection.label'), hint: t('quick_log.kind.reflection.hint') },
    { id: 'external', label: t('quick_log.kind.external.label'), hint: t('quick_log.kind.external.hint') },
  ]
  const [kind, setKind] = useState<ActivityKind>(preset?.kind ?? 'leetcode')
  const [title, setTitle] = useState(preset?.title ?? '')
  const [source, setSource] = useState(preset?.source ?? '')
  const [minutes, setMinutes] = useState<string>('')

  const canSubmit = title.trim().length >= 2

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    const minutesNum = parseInt(minutes, 10)
    logActivity({
      kind,
      title: title.trim(),
      source: source.trim() || undefined,
      minutes: Number.isFinite(minutesNum) && minutesNum > 0 ? minutesNum : undefined,
    })
    onClose()
  }

  return (
    <Modal open onClose={onClose} size="sm" title={t('quick_log.modal_title')}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          {t('quick_log.eyebrow')}
        </span>

        {/* Kind picker — 7 chips */}
        <div className="flex flex-col gap-2">
          <label className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {t('quick_log.field.kind')}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {KIND_OPTIONS.map((opt) => {
              const active = kind === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setKind(opt.id)}
                  title={opt.hint}
                  aria-pressed={active}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-[12px] transition-colors',
                    active
                      ? 'border-text-primary bg-text-primary/10 font-semibold text-text-primary'
                      : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong',
                  )}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="quicklog-title"
            className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted"
          >
            {t('quick_log.field.what')}
          </label>
          <input
            id="quicklog-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="LeetCode #239 Sliding Window Max"
            autoFocus
            maxLength={200}
            className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="quicklog-source"
              className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted"
            >
              {t('quick_log.field.source')}
            </label>
            <input
              id="quicklog-source"
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="LeetCode / DDIA / Coursera"
              maxLength={64}
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="quicklog-minutes"
              className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted"
            >
              {t('quick_log.field.minutes')}
            </label>
            <input
              id="quicklog-minutes"
              type="number"
              min="1"
              max="600"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="30"
              className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
            />
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" type="button" onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {t('actions.save')}
          </Button>
        </footer>
      </form>
    </Modal>
  )
}
