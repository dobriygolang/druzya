// Tutor closes a session с post-event write-up. Wraps the legacy
// window.prompt path in a proper modal so the tutor can:
//   1) write the full private session_note (required)
//   2) opt in to SHARE the note with the student (default OFF —
//      hard rule: privacy default-on, opt-in share)
//   3) optionally craft a CURATED student-facing copy via a second
//      textarea (empty = share raw private note as-is)
//
// On submit:
//   - CompleteEvent (existing RPC) writes session_note + flips status
//   - If «Share with student» is checked, fires SetSessionNoteVisibility
//     с visibility='shared' + the optional curated copy
//
// Two-step submit keeps the mutations atomic in the UI but separate
// at the API level — re-toggling visibility later doesn't need to
// re-write session_note.

import { useEffect, useRef, useState } from 'react'

import { Button } from './Button'
import { Modal } from './primitives/Modal'
import {
  useCompleteEventMutation,
  useSetSessionNoteVisibilityMutation,
} from '../lib/queries/tutor'

interface CompleteEventModalProps {
  open: boolean
  eventId: string
  eventTitle: string
  onClose: () => void
  onCompleted?: () => void
}

export function CompleteEventModal({
  open,
  eventId,
  eventTitle,
  onClose,
  onCompleted,
}: CompleteEventModalProps) {
  const [note, setNote] = useState('')
  const [share, setShare] = useState(false) // default OFF per privacy rule
  const [curated, setCurated] = useState('')
  const [error, setError] = useState<string | null>(null)

  const complete = useCompleteEventMutation()
  const setVisibility = useSetSessionNoteVisibilityMutation()
  const focusRef = useRef<HTMLTextAreaElement>(null)

  // Reset state every time the modal opens — prevents stale notes when
  // the tutor closes without submitting, then reopens for a different event.
  useEffect(() => {
    if (open) {
      setNote('')
      setShare(false)
      setCurated('')
      setError(null)
    }
  }, [open, eventId])

  const submitting = complete.isPending || setVisibility.isPending

  const submit = async () => {
    const trimmedNote = note.trim()
    if (!trimmedNote) {
      setError('Session note required.')
      return
    }
    setError(null)
    try {
      await complete.mutateAsync({ event_id: eventId, session_note: trimmedNote })
      if (share) {
        // Best-effort: if visibility flip fails, the session is still
        // marked complete — tutor can retry sharing later via the event row.
        await setVisibility.mutateAsync({
          event_id: eventId,
          visibility: 'shared',
          shared_content_md: curated.trim() || undefined,
        })
      }
      onCompleted?.()
      onClose()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Не получилось'
      setError(msg)
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="Session note"
      description={`Запиши, что было пройдено на «${eventTitle}». Это нужно для завершения сессии.`}
      size="lg"
      initialFocusRef={focusRef}
      preventScrimClose
    >
      <div className="flex flex-col gap-4">
        {/* ── Private full note (required) ─────────────────────── */}
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            Private note (tutor-only)
          </span>
          <textarea
            ref={focusRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Что пройдено · ключевые моменты · следующие шаги"
            rows={6}
            disabled={submitting}
            className="resize-y rounded-md border border-hairline bg-bg px-3 py-2 font-sans text-[13px] leading-relaxed text-text-primary placeholder:text-text-muted focus:border-text-secondary focus:outline-none disabled:opacity-50"
            maxLength={8000}
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
            {note.length} / 8000
          </span>
        </label>

        {/* ── Share toggle (default OFF) ───────────────────────── */}
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => setShare(e.target.checked)}
            disabled={submitting}
            className="mt-0.5 accent-text-primary"
          />
          <span className="flex flex-col gap-1">
            <span className="text-[13px] text-text-primary">
              Поделиться с учеником
            </span>
            <span className="text-[12px] text-text-secondary">
              Ученик увидит заметку в Hone. По умолчанию — private.
            </span>
          </span>
        </label>

        {/* ── Optional curated copy (only when sharing) ───────── */}
        {share && (
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              Версия для ученика (необязательно)
            </span>
            <textarea
              value={curated}
              onChange={(e) => setCurated(e.target.value)}
              placeholder="Оставь пустым чтобы поделиться полной заметкой как есть"
              rows={4}
              disabled={submitting}
              className="resize-y rounded-md border border-hairline bg-bg px-3 py-2 font-sans text-[13px] leading-relaxed text-text-primary placeholder:text-text-muted focus:border-text-secondary focus:outline-none disabled:opacity-50"
              maxLength={8000}
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              {curated.length} / 8000 · пусто = full note as-is
            </span>
          </label>
        )}

        {/* ── Error surface ─────────────────────────────────────── */}
        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 text-[12px] text-danger"
          >
            <span
              aria-hidden="true"
              className="mt-1.5 inline-block h-[1.5px] w-6 shrink-0 bg-danger"
            />
            <span>{error}</span>
          </p>
        )}

        {/* ── Actions ───────────────────────────────────────────── */}
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
            type="button"
          >
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={submitting || !note.trim()}
            type="button"
          >
            {submitting ? 'Сохраняем…' : share ? 'Завершить + поделиться' : 'Завершить'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
