// AICoachPill — inline contextual chat-pill для AI-coach'а.
//
// Используется на surface'ах где нужно «спросить про текущий node / mock /
// абзац» без перехода на full-page чат. Цель — увести от ассоциации с GPT:
// pill стилен «coach», открывается inline-drawer'ом, не занимает всю
// страницу.
//
// Flow:
//   1. Pill button → drawer
//   2. На первом open: adopt(personaSlug) — идемпотентно (relationship
//      создаётся один раз, все последующие adopt'ы возвращают тот же
//      thread'ed thread).
//   3. На первом сообщении: send({content, contextNote}) — context_note
//      идёт system-episode'ом перед user'ом (см ai_tutor SendMessage).
//      Subsequent сообщения — без contextNote (он уже в thread'е).
import { useEffect, useRef, useState } from 'react'
import { Loader2, Send, Sparkles, X } from 'lucide-react'

import { Button } from './Button'
import {
  useAdoptAITutorMutation,
  useSendAITutorMessageMutation,
} from '../lib/queries/aiTutor'
import { ApiError } from '../lib/apiClient'

type Turn = { role: 'user' | 'assistant'; content: string }

export interface AICoachPillProps {
  /** Slug персоны: algo-coach / sql-mentor / sysdesign-guru / english-coach / go-coach. */
  personaSlug: string
  /** Surface-context, идёт system-episode'ом на первом сообщении в этой сессии pill'а. */
  contextNote: string
  /**
   * Метка кнопки. Default — «Спросить coach'а».
   * Можно переопределить под surface («Объяснить этот узел»).
   */
  label?: string
  /** Полное имя coach'а в title drawer'а. */
  coachName?: string
}

export function AICoachPill({
  personaSlug,
  contextNote,
  label = 'Спросить coach’а',
  coachName,
}: AICoachPillProps) {
  const [open, setOpen] = useState(false)
  const [threadId, setThreadId] = useState<string | undefined>(undefined)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [contextSent, setContextSent] = useState(false)
  const adopt = useAdoptAITutorMutation()
  const send = useSendAITutorMessageMutation(threadId)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // Lazy adopt: только при первом open. Повторный open того же pill
  // переиспользует threadId.
  useEffect(() => {
    if (!open || threadId || adopt.isPending) return
    adopt
      .mutateAsync(personaSlug)
      .then((res) => setThreadId(res.thread.id))
      .catch(() => {
        /* surfaced via adopt.isError */
      })
  }, [open, threadId, personaSlug, adopt])

  // ESC закрывает drawer.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const onSend = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = draft.trim()
    if (!content || !threadId || send.isPending) return
    setDraft('')
    setTurns((t) => [...t, { role: 'user', content }])
    try {
      const res = await send.mutateAsync({
        content,
        contextNote: contextSent ? undefined : contextNote,
      })
      setContextSent(true)
      setTurns((t) => [
        ...t,
        { role: 'assistant', content: res.assistant_episode.content },
      ])
    } catch {
      // Restore draft чтобы юзер не потерял текст.
      setDraft(content)
      setTurns((t) => t.slice(0, -1))
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-3"
      >
        <Sparkles className="h-3.5 w-3.5 text-accent" />
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-stretch justify-end" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            role="button"
            tabIndex={-1}
            aria-label="Закрыть"
          />
          <aside className="relative flex h-full w-full max-w-[420px] flex-col bg-surface-1 shadow-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" />
                <span className="font-display text-sm font-bold text-text-primary">
                  {coachName ?? 'AI-coach'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-text-secondary hover:bg-surface-2"
                aria-label="Закрыть"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
              {adopt.isError && (
                <div className="rounded-md border border-warn/30 bg-warn/10 p-3 text-[12px] text-warn">
                  Не получилось подключить coach'а. Попробуй ещё раз.
                </div>
              )}
              {adopt.isPending && !threadId && (
                <div className="flex items-center gap-2 text-[12px] text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Подключаюсь…
                </div>
              )}
              {turns.length === 0 && threadId && !send.isPending && (
                <div className="text-[12px] text-text-muted">
                  Coach уже видит контекст этого экрана. Задай вопрос — отвечу с учётом твоей истории.
                </div>
              )}
              {turns.map((t, i) => (
                <div
                  key={i}
                  className={
                    t.role === 'user'
                      ? 'self-end max-w-[85%] rounded-lg bg-accent/15 px-3 py-2 text-[13px] text-text-primary'
                      : 'self-start max-w-[90%] rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-text-primary'
                  }
                >
                  {t.content}
                </div>
              ))}
              {send.isPending && (
                <div className="flex items-center gap-2 self-start text-[12px] text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Думаю…
                </div>
              )}
              {send.isError && (
                <div className="text-[12px] text-warn">
                  {send.error instanceof ApiError ? send.error.body : 'Не получилось отправить.'}
                </div>
              )}
            </div>

            <form onSubmit={onSend} className="border-t border-border px-4 py-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void onSend(e as unknown as React.FormEvent)
                    }
                  }}
                  rows={2}
                  placeholder="Спроси coach'а…"
                  className="min-h-[44px] flex-1 resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                  disabled={!threadId || send.isPending}
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!draft.trim() || !threadId || send.isPending}
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </>
  )
}
