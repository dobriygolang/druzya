// AITutorChatPage — `/tutor/ai/{slug}` chat-интерфейс.
//
// Flow:
//   1. Resolve persona by slug → ListPersonas + find. Если нет — adopt
//      на фоне (нужен auth, fall back в /login).
//   2. Load my threads → find thread с persona.id.
//   3. Render history → polling? Нет, react-query refetch on send.
//   4. Send → optimistic append + invalidate history.
//
// Минималистично: текстовый log + textarea + Submit. Sticky header с
// именем персоны + recall-summary («что AI помнит»). Без markdown
// render — content идёт plain text (LLM возвращает структурированно).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, Send, ArrowLeft } from 'lucide-react'

import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ApiError, readAccessToken } from '../lib/apiClient'
import {
  useAITutorHistoryQuery,
  useAITutorPersonasQuery,
  useAdoptAITutorMutation,
  useMyAITutorThreadsQuery,
  useSendAITutorMessageMutation,
  type AITutorEpisode,
  type AITutorPersona,
  type AITutorThread,
} from '../lib/queries/aiTutor'

export default function AITutorChatPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const navigate = useNavigate()

  const personasQ = useAITutorPersonasQuery()
  const threadsQ = useMyAITutorThreadsQuery()
  const adopt = useAdoptAITutorMutation()

  const persona: AITutorPersona | undefined = useMemo(
    () => (personasQ.data?.items ?? []).find((p) => p.slug === slug),
    [personasQ.data, slug],
  )

  const thread: AITutorThread | undefined = useMemo(() => {
    if (!persona) return undefined
    return (threadsQ.data?.items ?? []).find((t) => t.persona_id === persona.id)
  }, [threadsQ.data, persona])

  // Auto-adopt: если персона есть, но thread'а нет (юзер пришёл по
  // прямой ссылке без adopt), и юзер залогинен — адоптируем.
  const [adoptTried, setAdoptTried] = useState(false)
  useEffect(() => {
    if (!persona || thread || adoptTried) return
    if (!readAccessToken()) {
      navigate(`/login?next=${encodeURIComponent(`/tutor/ai/${slug}`)}`)
      return
    }
    setAdoptTried(true)
    void adopt.mutateAsync(slug).catch(() => {
      /* mutation error surfaces ниже */
    })
  }, [persona, thread, adoptTried, slug, navigate, adopt])

  if (personasQ.isPending || (persona && !thread && (threadsQ.isPending || adopt.isPending))) {
    return (
      <AppShellV2>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
        </div>
      </AppShellV2>
    )
  }
  if (!persona) {
    return (
      <AppShellV2>
        <div className="mx-auto max-w-3xl px-4 py-10">
          <p className="text-[14px] text-danger">Персона не найдена.</p>
          <Button variant="ghost" onClick={() => navigate('/atlas')}>
            ← Atlas
          </Button>
        </div>
      </AppShellV2>
    )
  }
  if (!thread) {
    return (
      <AppShellV2>
        <div className="mx-auto max-w-3xl px-4 py-10">
          <p className="text-[14px] text-danger">
            {adopt.error instanceof ApiError ? adopt.error.body : 'Не удалось открыть чат.'}
          </p>
        </div>
      </AppShellV2>
    )
  }

  return <ChatBody persona={persona} thread={thread} />
}

function ChatBody({
  persona,
  thread,
}: {
  persona: AITutorPersona
  thread: AITutorThread
}) {
  const navigate = useNavigate()
  const historyQ = useAITutorHistoryQuery(thread.id, 60)
  const send = useSendAITutorMessageMutation(thread.id)
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  const episodes = useMemo(
    () =>
      (historyQ.data?.episodes ?? []).filter(
        (e) => e.role === 'user' || e.role === 'assistant' || e.role === 'system',
      ),
    [historyQ.data],
  )

  // Auto-scroll-bottom on new episodes.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [episodes.length])

  const onSend = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = draft.trim()
    if (!content || send.isPending) return
    setDraft('')
    try {
      await send.mutateAsync({ content })
    } catch {
      // Mutation state surfaces error inline.
      setDraft(content) // restore так юзер не теряет текст
    }
  }

  const summary = (historyQ.data?.thread.summary_md ?? '').trim()

  return (
    <AppShellV2>
      <div className="mx-auto flex h-[calc(100vh-72px)] w-full max-w-3xl flex-col gap-3 px-4 py-6">
        <header className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => navigate('/atlas')}
              className="flex items-center gap-1 self-start font-mono text-[11px] text-text-muted hover:text-text-primary"
            >
              <ArrowLeft className="h-3 w-3" /> Atlas
            </button>
            <h1 className="font-display text-xl font-semibold">{persona.display_name}</h1>
            <p className="font-mono text-[11px] text-text-muted">
              AI · 24/7 · {persona.scope_track_kind}
            </p>
          </div>
          <div className="text-right font-mono text-[11px] text-text-muted">
            {thread.daily_msg_count}/30 · сегодня
          </div>
        </header>

        {summary && (
          <Card className="flex-col gap-1 p-3" interactive={false}>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
              Что AI помнит
            </p>
            <p className="whitespace-pre-line text-[12px] text-text-secondary">{summary}</p>
          </Card>
        )}

        <div
          ref={logRef}
          className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-md border border-border bg-surface-1 p-4"
        >
          {historyQ.isPending && (
            <p className="self-center text-[12px] text-text-muted">Загружаем…</p>
          )}
          {episodes.map((ep) => (
            <ChatBubble key={ep.id} ep={ep} />
          ))}
          {send.isPending && (
            <p className="self-start font-mono text-[11px] text-text-muted">…coach думает</p>
          )}
        </div>

        <form onSubmit={onSend} className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void onSend(e as unknown as React.FormEvent)
              }
            }}
            placeholder="Напиши сообщение… (⌘/Ctrl+Enter — отправить)"
            rows={3}
            maxLength={4000}
            className="flex-1 resize-none rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
          />
          <Button type="submit" disabled={!draft.trim() || send.isPending}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
        {send.isError && (
          <p className="text-[12px] text-danger">
            {send.error instanceof ApiError ? send.error.body : 'Не получилось отправить.'}
          </p>
        )}
      </div>
    </AppShellV2>
  )
}

function ChatBubble({ ep }: { ep: AITutorEpisode }) {
  const isUser = ep.role === 'user'
  const isSystem = ep.role === 'system'
  return (
    <div className={isUser ? 'self-end max-w-[80%]' : 'self-start max-w-[80%]'}>
      {isSystem ? (
        <p className="rounded-md border border-dashed border-border px-3 py-2 font-mono text-[11px] text-text-muted">
          {ep.content}
        </p>
      ) : (
        <div
          className={
            isUser
              ? 'rounded-md bg-text-primary px-3 py-2 text-sm text-bg'
              : 'rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary'
          }
        >
          <p className="whitespace-pre-wrap">{ep.content}</p>
          {!isUser && ep.model_used && (
            <p className="mt-1 font-mono text-[10px] text-text-muted">{ep.model_used}</p>
          )}
        </div>
      )}
    </div>
  )
}
