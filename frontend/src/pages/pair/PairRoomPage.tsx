// PairRoomPage — the actual collaborative editor surface (route
// /pair/:roomId).
//
// Layout:
//   ┌──────────────── TopBar ────────────────┐
//   │ title · lang · freeze · share          │
//   ├──────────── Editor (full-bleed) ─┬─────┤
//   │                                  │ ppl │
//   │                                  │ chat│
//   │                                  │ vc  │
//   ├────────── StatusBar ─────────────┴─────┤
//   │ lang · ws-status · "Сдать на проверку" │
//   └────────────────────────────────────────┘
//
// Anti-fallback:
//   - 404 from /editor/room/:id → <EmptyState variant="404-not-found" />
//   - WS reaches 'failed' (>5 reconnects) → <EmptyState variant="error" />
//     replaces the editor; we DO NOT silently mount a local editor.
//   - loading → <EmptyState variant="loading" skeletonLayout="split-view" />.

import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Snowflake, Send, MessageSquare, Mic, ArrowLeft } from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { CollaborativeEditor } from '../../components/pair/CollaborativeEditor'
import { ParticipantsList, colorFor } from '../../components/pair/ParticipantsList'
import { ShareInvitePopover } from '../../components/pair/ShareInvitePopover'
import {
  useEditorWs,
  useFreezePairRoomMutation,
  usePairRoomQuery,
} from '../../lib/queries/pairEditor'
import { readAccessToken } from '../../lib/apiClient'

const LANGS = ['go', 'python', 'javascript', 'typescript', 'java', 'cpp']

export default function PairRoomPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const room = usePairRoomQuery(roomId)
  const token = readAccessToken() ?? undefined
  const [localText, setLocalText] = useState('')
  const [chatDraft, setChatDraft] = useState('')
  const freeze = useFreezePairRoomMutation(roomId)
  const ws = useEditorWs(roomId, token)

  const language = room.data?.room.language ?? 'go'
  const ownerId = room.data?.room.owner_id ?? ''
  const participants = room.data?.participants ?? []

  // Chat is layered on top of the same WS as `kind: "chat"` envelopes;
  // backend currently broadcasts unknown kinds as-is to other participants.
  const chatLog = useMemo(() => {
    if (!ws.lastMessage || ws.lastMessage.kind !== 'chat') return []
    const data = ws.lastMessage.data as { user_id: string; text: string } | undefined
    if (!data) return []
    return [{ user_id: data.user_id, text: data.text, ts: Date.now() }]
  }, [ws.lastMessage])

  if (room.isLoading) {
    return (
      <AppShellV2>
        <EmptyState variant="loading" skeletonLayout="split-view" />
      </AppShellV2>
    )
  }
  if (room.data === null) {
    return (
      <AppShellV2>
        <EmptyState
          variant="404-not-found"
          title="Комната не найдена"
          body="Возможно, ссылка истекла или комнату закрыли."
          cta={{ label: 'К списку комнат', onClick: () => navigate('/pair') }}
        />
      </AppShellV2>
    )
  }
  if (room.isError || !room.data) {
    return (
      <AppShellV2>
        <EmptyState
          variant="error"
          title="Не удалось загрузить комнату"
          cta={{ label: 'Повторить', onClick: () => room.refetch() }}
        />
      </AppShellV2>
    )
  }

  const isFrozen = room.data.room.status === 'frozen'
  const sendChat = () => {
    const text = chatDraft.trim()
    if (!text) return
    if (ws.send({ kind: 'chat', data: { text } })) {
      setChatDraft('')
    }
  }

  return (
    <AppShellV2>
      <div className="flex h-[calc(100vh-72px)] flex-col">
        {/* Top bar */}
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface-1 px-4">
          <button
            className="text-text-muted hover:text-text-primary"
            onClick={() => navigate('/pair')}
            aria-label="Назад"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="font-display text-[14px] font-bold text-text-primary">
            {room.data.room.title || 'Pair-coding'}
          </div>
          <select
            disabled
            value={language}
            className="rounded border border-border bg-bg px-2 py-1 font-mono text-[11px] text-text-secondary"
          >
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          {isFrozen && (
            <span className="inline-flex items-center gap-1 rounded-full bg-text-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-text-secondary">
              <Snowflake className="h-3 w-3" /> заморожено
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={<Snowflake className="h-3.5 w-3.5" />}
              disabled={isFrozen || freeze.isPending}
              onClick={() => freeze.mutate()}
            >
              {isFrozen ? 'Заморожено' : 'Заморозить'}
            </Button>
            {roomId && <ShareInvitePopover roomId={roomId} />}
          </div>
        </div>

        {/* Main split */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col">
            {ws.status === 'failed' ? (
              <EmptyState
                variant="error"
                title="Соединение потеряно"
                body="Не удалось восстановить связь с editor-сервером после нескольких попыток. Локальный режим не активирован — ваши изменения сейчас не синхронизируются."
                cta={{ label: 'Переподключиться', onClick: () => ws.reconnect() }}
              />
            ) : (
              <CollaborativeEditor
                language={language}
                value={localText}
                onLocalChange={setLocalText}
                send={ws.send}
                remote={ws.lastMessage}
                readOnly={isFrozen}
              />
            )}
          </div>

          {/* Right panel */}
          <aside className="flex w-[280px] shrink-0 flex-col border-l border-border bg-surface-1">
            <div className="border-b border-border p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                Участники
              </div>
              <ParticipantsList participants={participants} ownerId={ownerId} />
            </div>

            <div className="border-b border-border p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                Голосовой канал
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={<Mic className="h-3.5 w-3.5" />}
                disabled
                className="w-full justify-center"
              >
                Скоро (voice-mock)
              </Button>
            </div>

            <div className="flex flex-1 flex-col p-3">
              <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                <MessageSquare className="h-3 w-3" /> Чат
              </div>
              <div className="flex-1 overflow-auto rounded border border-border bg-bg p-2 text-[12px] text-text-secondary">
                {chatLog.length === 0 ? (
                  <span className="text-text-muted">Пока тихо.</span>
                ) : (
                  chatLog.map((m, i) => (
                    <div key={i} className="mb-1.5">
                      <span
                        className="mr-1 font-mono text-[10px]"
                        style={{ color: colorFor(m.user_id) }}
                      >
                        {m.user_id.slice(0, 6)}
                      </span>
                      <span>{m.text}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendChat()
                    }
                  }}
                  placeholder="Сообщение"
                  className="flex-1 rounded border border-border bg-bg px-2 py-1 text-[12px] text-text-primary outline-none focus:border-text-primary"
                />
                <button
                  type="button"
                  onClick={sendChat}
                  className="rounded bg-text-primary px-2 py-1 text-text-primary hover:bg-text-primary/90"
                  aria-label="Отправить"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </aside>
        </div>

        {/* Bottom status bar */}
        <div className="flex h-8 shrink-0 items-center justify-between border-t border-border bg-surface-2 px-4 font-mono text-[10px] text-text-muted">
          <div className="flex items-center gap-3">
            <span>{language.toUpperCase()}</span>
            <WsBadge status={ws.status} />
            <span>LSP: off</span>
          </div>
          <Button variant="ghost" size="sm" disabled>
            Сдать на проверку
          </Button>
        </div>
      </div>
    </AppShellV2>
  )
}

function WsBadge({ status }: { status: ReturnType<typeof useEditorWs>['status'] }) {
  const color =
    status === 'open' ? 'text-success' : status === 'failed' ? 'text-danger' : 'text-warn'
  const label =
    status === 'open'
      ? 'live'
      : status === 'connecting'
        ? 'connecting'
        : status === 'reconnecting'
          ? 'reconnecting'
          : status === 'failed'
            ? 'offline'
            : 'closed'
  return <span className={color}>WS · {label}</span>
}
