// AIAssistantChat — right-side chat panel rendered inside the Mock pipeline
// cockpit when the candidate enabled AI assistance at company-pick time.
//
// Wave-12 UX consolidation: replaces the standalone "AI-allowed Interview"
// arena card. The Mock pipeline is now ONE flow with an opt-in chat panel,
// not two parallel modes.
//
// Anti-fallback: there is no Mock-AI backend endpoint yet. When the AI model
// catalogue is unavailable (or the endpoint hasn't shipped), we render a
// coming-soon EmptyState — we NEVER fabricate assistant replies.
//
// UX decision (documented for the PR): the panel is collapsible. The mock
// stage host on the left is the primary surface; an always-on 360px panel
// would crush the code editor / Excalidraw canvas on 13" laptops. Default
// state = expanded (the user opted in), but a header chevron lets them
// collapse to a 40px rail and reclaim horizontal space.

import { useState, type FormEvent } from 'react'
import { Bot, ChevronRight, Send, Sparkles } from 'lucide-react'
import { EmptyState } from '../EmptyState'
import { useAIModelsQuery } from '../../lib/queries/ai'

type Message = {
  id: string
  role: 'user' | 'assistant'
  text: string
  ts: number
}

export function AIAssistantChat() {
  const ai = useAIModelsQuery()
  const [collapsed, setCollapsed] = useState(false)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<Message[]>([])

  const aiAvailable = ai.data?.available && (ai.data?.items?.length ?? 0) > 0
  const headlineModel = ai.data?.items?.[0]?.label ?? 'Claude Sonnet 4'

  if (collapsed) {
    return (
      <aside
        className="flex w-10 shrink-0 flex-col items-center gap-2 rounded-xl border border-border bg-surface-1 py-3"
        aria-label="AI Помощник (свёрнуто)"
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary"
          title="Развернуть AI-помощника"
          aria-label="Развернуть AI-помощника"
        >
          <Bot className="h-4 w-4" />
        </button>
      </aside>
    )
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed || !aiAvailable) return
    // Backend chat endpoint not wired yet (Wave-13). We only echo the user's
    // message into the local transcript — NO fake assistant reply. The empty
    // assistant slot makes the gap explicit instead of silently swallowing.
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', text: trimmed, ts: Date.now() },
    ])
    setDraft('')
  }

  return (
    <aside
      className="flex w-full max-w-sm shrink-0 flex-col gap-3 rounded-xl border border-border bg-surface-1 p-3 lg:w-[360px]"
      aria-label="AI Помощник"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 font-display text-sm font-bold text-text-primary">
            <Sparkles className="h-4 w-4 text-text-secondary" />
            AI Помощник · {headlineModel}
          </span>
          <span className="font-mono text-[10px] text-text-muted">
            режим: AI-allowed mock
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-primary"
          title="Свернуть"
          aria-label="Свернуть AI-помощника"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </header>

      {!aiAvailable ? (
        <EmptyState
          variant="coming-soon"
          title="AI-помощник в Mock запускается в Wave-13"
          body="Пока используй обычный Mock без AI."
        />
      ) : (
        <>
          <div
            className="flex max-h-[480px] min-h-[200px] flex-1 flex-col gap-2 overflow-y-auto rounded-lg border border-border-strong bg-bg p-3"
            role="log"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <p className="text-xs text-text-muted">
                Спроси подсказку: «как разогнать BFS до O(V+E) на этом графе?», «что подсветить
                в STAR-истории про конфликт?», «какой trade-off у sharded counter?»
              </p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={[
                    'rounded-md px-2.5 py-1.5 text-xs',
                    m.role === 'user'
                      ? 'self-end bg-text-primary/15 text-text-primary'
                      : 'self-start bg-surface-2 text-text-secondary',
                  ].join(' ')}
                >
                  {m.text}
                </div>
              ))
            )}
          </div>
          <form onSubmit={onSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Сообщение AI-помощнику…"
              className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-text-primary focus:outline-none"
              aria-label="Сообщение AI-помощнику"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-text-primary text-bg disabled:opacity-50"
              aria-label="Отправить"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </>
      )}
    </aside>
  )
}
