// /editor/:roomId — публичная multiplayer-страница code-room (mirror
// WhiteboardSharePage). Yjs Y.Text + CodeMirror 6 + yCollab → real-time
// collab + cursors / selections of other participants.
//
// Auth flow:
//   - Если access-token есть в localStorage — joinим как этот юзер.
//   - Иначе — guest prompt → POST /editor/room/{id}/guest-join {name} →
//     получаем guest JWT (in-memory) → join через WS.
//   - visibility=private → 403 (на REST GET и на WS upgrade).

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import * as Y from 'yjs'
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness'
import { yCollab } from 'y-codemirror.next'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, lineNumbers, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { go } from '@codemirror/lang-go'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'

import { API_BASE, readAccessToken } from '../lib/apiClient'

// ─── Types ────────────────────────────────────────────────────────────────

type Language = 'go' | 'python' | 'javascript' | 'typescript' | string

interface RoomMeta {
  id: string
  ownerId: string
  language: Language
  participants: { userId: string; username: string }[]
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'guest-prompt' }
  | { kind: 'forbidden'; reason: string }
  | { kind: 'not-found' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; room: RoomMeta; guestToken?: string; myUserId?: string }

// ─── Page ─────────────────────────────────────────────────────────────────

export default function EditorRoomSharePage() {
  const { roomId } = useParams<{ roomId: string }>()
  const id = useMemo(() => (roomId ?? '').trim(), [roomId])
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#000'
    return () => {
      document.body.style.backgroundColor = prev
    }
  }, [])

  const tryLoadWithToken = useCallback(
    async (token: string | null, guestToken?: string) => {
      const useToken = guestToken ?? token
      if (!useToken) {
        setState({ kind: 'guest-prompt' })
        return
      }
      try {
        const resp = await fetch(`${API_BASE}/editor/room/${id}`, {
          headers: { authorization: `Bearer ${useToken}` },
        })
        if (resp.status === 401) {
          setState({ kind: 'guest-prompt' })
          return
        }
        if (resp.status === 403) {
          setState({ kind: 'forbidden', reason: 'This room is private.' })
          return
        }
        if (resp.status === 404) {
          setState({ kind: 'not-found' })
          return
        }
        if (resp.status === 412 || resp.status === 410) {
          setState({ kind: 'expired' })
          return
        }
        if (!resp.ok) {
          setState({ kind: 'error', message: `HTTP ${resp.status}` })
          return
        }
        const json = (await resp.json()) as {
          id: string
          ownerId?: string
          owner_id?: string
          language?: string
          participants?: { userId?: string; user_id?: string; username?: string }[]
        }
        const room: RoomMeta = {
          id: json.id,
          ownerId: json.ownerId ?? json.owner_id ?? '',
          language: (json.language ?? 'javascript').toLowerCase(),
          participants: (json.participants ?? []).map((p) => ({
            userId: p.userId ?? p.user_id ?? '',
            username: p.username ?? 'guest',
          })),
        }
        // Определяем CURRENT user — JWT содержит claim "sub" с user UUID.
        // Без этого awareness писал имя owner'а себе (см. RoomEditorImpl
        // ниже — `me = participants.find(p => p.userId === room.ownerId)`),
        // и все коннект'ящиеся гости подписывались как owner.
        const myUserId = decodeJwtSub(useToken)
        setState({ kind: 'ready', room, guestToken, myUserId })
      } catch (e) {
        setState({ kind: 'error', message: (e as Error).message })
      }
    },
    [id],
  )

  useEffect(() => {
    void tryLoadWithToken(readAccessToken())
  }, [tryLoadWithToken])

  const handleGuestJoin = useCallback(
    async (name: string) => {
      setState({ kind: 'loading' })
      try {
        const resp = await fetch(`${API_BASE}/editor/room/${id}/guest-join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        if (resp.status === 403) {
          setState({
            kind: 'forbidden',
            reason: 'This room is private. Owner has not enabled guest access.',
          })
          return
        }
        if (resp.status === 404) {
          setState({ kind: 'not-found' })
          return
        }
        if (resp.status === 410) {
          setState({ kind: 'expired' })
          return
        }
        if (!resp.ok) {
          setState({ kind: 'error', message: `Guest-join failed: HTTP ${resp.status}` })
          return
        }
        const json = (await resp.json()) as { access_token: string }
        await tryLoadWithToken(null, json.access_token)
      } catch (e) {
        setState({ kind: 'error', message: (e as Error).message })
      }
    },
    [id, tryLoadWithToken],
  )

  if (state.kind === 'loading') return <CenterMessage text="LOADING ROOM…" />
  if (state.kind === 'guest-prompt') {
    return <GuestPrompt onJoin={(name) => void handleGuestJoin(name)} roomId={id} />
  }
  if (state.kind === 'forbidden') {
    return <CenterMessage text="PRIVATE ROOM" sub={state.reason} />
  }
  if (state.kind === 'not-found') return <CenterMessage text="ROOM NOT FOUND" />
  if (state.kind === 'expired') return <CenterMessage text="ROOM EXPIRED" />
  if (state.kind === 'error') return <CenterMessage text="ERROR" sub={state.message} />

  return <RoomEditor room={state.room} guestToken={state.guestToken} myUserId={state.myUserId} />
}

// ─── RoomEditor — full multiplayer CodeMirror ────────────────────────────

const RoomEditor = memo(RoomEditorImpl)

// decodeJwtSub — base64url decode middle JWT part, extract `sub` claim.
// Используется чтобы определить current user_id без отдельного /me запроса.
// Не валидирует подпись — это OK для чисто визуальной идентификации
// (auth-критичные операции всё равно проверяются на бэке).
function decodeJwtSub(token: string | null): string | undefined {
  if (!token) return undefined
  try {
    const parts = token.split('.')
    if (parts.length < 2) return undefined
    const payload = parts[1]!
    // base64url → base64 (replace `-` with `+`, `_` with `/`, pad with `=`)
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
    const json = JSON.parse(atob(b64)) as { sub?: string }
    return typeof json.sub === 'string' ? json.sub : undefined
  } catch {
    return undefined
  }
}

interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  timeMs: number
  status: string
}

function RoomEditorImpl({ room, guestToken, myUserId }: { room: RoomMeta; guestToken?: string; myUserId?: string }) {
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'reconnecting' | 'failed'>(
    'connecting',
  )
  const ydocRef = useRef<Y.Doc | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const sendRef = useRef<((u: Uint8Array) => void) | null>(null)
  const sendAwarenessRef = useRef<((u: Uint8Array) => void) | null>(null)
  const wsCloseRef = useRef<(() => void) | null>(null)

  // Run / Format / output panel state. Mirror hone Editor.tsx.
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [outputTab, setOutputTab] = useState<'stdout' | 'stderr'>('stdout')

  useEffect(() => {
    const ydoc = new Y.Doc()
    ydocRef.current = ydoc
    const ytext = ydoc.getText('code')

    const awareness = new Awareness(ydoc)
    // КРИТИЧНО: ищем СЕБЯ по myUserId (decoded из JWT), не по ownerId.
    // Раньше тут был `p.userId === room.ownerId` → у всех гостей name
    // оказывался username'ом owner'а ("dobriygolang") вместо собственного.
    const me = myUserId ? room.participants.find((p) => p.userId === myUserId) : undefined
    awareness.setLocalStateField('user', {
      name: me?.username || 'guest',
      color: userColor(myUserId || room.id),
    })

    const onYUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return
      sendRef.current?.(update)
    }
    ydoc.on('update', onYUpdate)

    const onAwUpdate = (
      diff: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === 'remote') return
      const changed = diff.added.concat(diff.updated, diff.removed)
      if (changed.length === 0) return
      sendAwarenessRef.current?.(encodeAwarenessUpdate(awareness, changed))
    }
    awareness.on('update', onAwUpdate)

    // WS connection.
    const token = guestToken ?? readAccessToken() ?? ''
    const wsBase = computeWsBase()
    const url = `${wsBase}/ws/editor/${encodeURIComponent(room.id)}?token=${encodeURIComponent(token)}`
    const handle = openWs(url, {
      onStatus: setWsStatus,
      onEnvelope: (env) => {
        if (env.kind === 'snapshot' || env.kind === 'op') {
          const data = env.data as { payload?: string }
          if (data?.payload) {
            Y.applyUpdate(ydoc, b64ToBytes(data.payload), 'remote')
          }
        } else if (env.kind === 'presence') {
          const data = env.data as
            | { data?: { update?: string }; update?: string }
            | undefined
          const b64 = data?.data?.update ?? data?.update
          if (typeof b64 === 'string') {
            try {
              applyAwarenessUpdate(awareness, b64ToBytes(b64), 'remote')
            } catch {
              /* ignore */
            }
          }
        }
      },
    })
    wsCloseRef.current = handle.close
    sendRef.current = (update) => {
      handle.send({ kind: 'op', data: { payload: bytesToB64(update) } })
    }
    sendAwarenessRef.current = (update) => {
      handle.send({ kind: 'presence', data: { update: bytesToB64(update) } })
    }

    // CodeMirror.
    const langExt = (() => {
      switch (room.language) {
        case 'go':
          return go()
        case 'python':
          return python()
        case 'javascript':
        case 'typescript':
          return javascript({ typescript: room.language === 'typescript' })
        default:
          return javascript()
      }
    })()
    const langCompartment = new Compartment()

    const cmState = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        langCompartment.of(langExt),
        yCollab(ytext, awareness),
        editorThemeWeb(),
      ],
    })
    const mount = document.getElementById('cm-mount-web')
    if (mount) {
      const view = new EditorView({ state: cmState, parent: mount })
      viewRef.current = view
    }

    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
      ydoc.off('update', onYUpdate)
      awareness.off('update', onAwUpdate)
      const closeHandle = wsCloseRef.current
      window.setTimeout(() => {
        try {
          closeHandle?.()
        } catch {
          /* ignore */
        }
        try {
          awareness.destroy()
        } catch {
          /* ignore */
        }
        try {
          ydoc.destroy()
        } catch {
          /* ignore */
        }
      }, 60)
      ydocRef.current = null
      wsCloseRef.current = null
      sendRef.current = null
      sendAwarenessRef.current = null
    }
  }, [room, guestToken])

  // handleFormat — re-indent / strip trailing whitespace через CM6 transactions.
  // Не настоящий gofmt/prettier, но даёт юзеру чистый indent + удаляет
  // trailing spaces. Mirror hone Editor.tsx.
  const handleFormat = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    const { state } = view
    const changes: Array<{ from: number; to: number; insert: string }> = []
    for (let i = 1; i <= state.doc.lines; i++) {
      const line = state.doc.line(i)
      const trimmed = line.text.replace(/[ \t]+$/, '')
      if (trimmed !== line.text) {
        changes.push({ from: line.from, to: line.to, insert: trimmed })
      }
    }
    if (changes.length > 0) view.dispatch({ changes })
  }, [])

  // handleRun — POST /api/v1/editor/room/{id}/run (см. proto editor.proto).
  // Auth через access_token (или guest-token). Backend проверяет
  // participant'ом ли user'а; иначе 403/401.
  const handleRun = useCallback(async () => {
    if (runningRef.current) return
    const view = viewRef.current
    if (!view) return
    const code = view.state.doc.toString()
    runningRef.current = true
    setRunning(true)
    setRunError(null)
    setPanelOpen(true)
    try {
      const token = guestToken ?? readAccessToken() ?? ''
      const langMap: Record<string, number> = {
        // mirror druz9.v1.Language enum (1=GO, 2=PYTHON, 3=JS, 4=TS).
        go: 1,
        python: 2,
        javascript: 3,
        typescript: 4,
      }
      const langInt = langMap[room.language] ?? 0
      const resp = await fetch(`${API_BASE}/editor/room/${encodeURIComponent(room.id)}/run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code, language: langInt }),
      })
      if (resp.status === 503) {
        setRunResult(null)
        setRunError('Sandbox not configured.')
        return
      }
      if (resp.status === 429) {
        setRunResult(null)
        setRunError('Slow down — limit reached.')
        return
      }
      if (resp.status === 403) {
        setRunResult(null)
        setRunError('You are not a participant.')
        return
      }
      if (!resp.ok) {
        setRunResult(null)
        setRunError(`HTTP ${resp.status}`)
        return
      }
      const j = (await resp.json()) as {
        stdout?: string
        stderr?: string
        exitCode?: number
        exit_code?: number
        timeMs?: number
        time_ms?: number
        status?: string
      }
      const r: RunResult = {
        stdout: j.stdout ?? '',
        stderr: j.stderr ?? '',
        exitCode: j.exitCode ?? j.exit_code ?? 0,
        timeMs: j.timeMs ?? j.time_ms ?? 0,
        status: j.status ?? '',
      }
      setRunResult(r)
      if (r.stderr && !r.stdout) setOutputTab('stderr')
      else setOutputTab('stdout')
    } catch (e) {
      setRunResult(null)
      setRunError((e as Error).message)
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [room.id, room.language, guestToken])

  // ⌘↵ / Ctrl+Enter — run. ⌘⇧F — format.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void handleRun()
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        handleFormat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleRun, handleFormat])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', color: '#fff' }}>
      <div
        id="cm-mount-web"
        style={{
          position: 'absolute',
          inset: 0,
          paddingTop: 0,
          paddingBottom: panelOpen ? 220 : 0,
          fontFamily: '"JetBrains Mono", monospace',
          transition: 'padding-bottom 200ms ease',
        }}
      />

      {/* Top-right: FORMAT + RUN — mirror hone Editor.tsx. */}
      <div
        style={{
          position: 'fixed',
          top: 14,
          right: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          zIndex: 25,
        }}
      >
        <button
          onClick={handleFormat}
          title="Format / re-indent (⌘⇧F)"
          style={{
            padding: '7px 14px',
            fontSize: 11,
            letterSpacing: '0.14em',
            background: 'rgba(20,20,22,0.78)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.6)',
            borderRadius: 999,
            cursor: 'pointer',
            fontFamily: '"JetBrains Mono", monospace',
            transition: 'color 160ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#fff'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'rgba(255,255,255,0.6)'
          }}
        >
          {'{ } FORMAT'}
        </button>
        <button
          onClick={() => void handleRun()}
          disabled={running}
          title="Run code (⌘↵)"
          style={{
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 500,
            background: 'rgba(255,255,255,0.92)',
            color: '#000',
            border: 'none',
            borderRadius: 999,
            cursor: running ? 'default' : 'pointer',
            opacity: running ? 0.6 : 1,
          }}
        >
          {running ? '⏵ RUNNING…' : '▶ RUN'}
        </button>
      </div>

      {/* Output panel — снизу. */}
      {panelOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            height: 220,
            background: 'rgba(15,15,17,0.96)',
            backdropFilter: 'blur(20px)',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            zIndex: 24,
            display: 'flex',
            flexDirection: 'column',
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ display: 'flex', gap: 14 }}>
              {(['stdout', 'stderr'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setOutputTab(tab)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: outputTab === tab ? '#fff' : 'rgba(255,255,255,0.4)',
                    cursor: 'pointer',
                    fontSize: 10,
                    letterSpacing: '0.18em',
                    padding: 0,
                  }}
                >
                  {tab.toUpperCase()}
                </button>
              ))}
              {runResult && (
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: '0.12em' }}>
                  EXIT {runResult.exitCode} · {runResult.timeMs}ms
                </span>
              )}
            </div>
            <button
              onClick={() => setPanelOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.4)',
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: 1,
              }}
              title="Close output"
            >
              ×
            </button>
          </div>
          <pre
            style={{
              flex: 1,
              margin: 0,
              padding: '12px 16px',
              overflow: 'auto',
              fontSize: 12,
              color: outputTab === 'stderr' ? '#ff8c8c' : '#d6d6d6',
              whiteSpace: 'pre-wrap',
            }}
          >
            {runError
              ? runError
              : running && !runResult
                ? '…'
                : runResult
                  ? outputTab === 'stdout'
                    ? runResult.stdout || '(no stdout)'
                    : runResult.stderr || '(no stderr)'
                  : ''}
          </pre>
        </div>
      )}
      <div
        style={{
          position: 'fixed',
          bottom: 16,
          right: 24,
          padding: '6px 14px',
          background: 'rgba(20,20,22,0.78)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 999,
          fontSize: 10,
          letterSpacing: '0.06em',
          color: 'rgba(255,255,255,0.6)',
          fontFamily: '"JetBrains Mono", monospace',
          zIndex: 25,
          pointerEvents: 'none',
        }}
      >
        <span>{room.language.toUpperCase()}</span>
        <span style={{ opacity: 0.4, margin: '0 8px' }}>·</span>
        <span
          style={{
            color:
              wsStatus === 'open'
                ? 'rgba(127,212,155,0.95)'
                : wsStatus === 'failed'
                  ? '#ff6a6a'
                  : 'rgba(255,255,255,0.5)',
            fontWeight: 500,
          }}
        >
          {wsStatus === 'open' ? 'LIVE' : wsStatus.toUpperCase()}
        </span>
      </div>
    </div>
  )
}

// Hone-style чёрный CM theme — light-grey текст, прозрачный фон над body #000.
function editorThemeWeb() {
  return EditorView.theme(
    {
      '&': {
        height: '100vh',
        backgroundColor: '#000',
        color: '#e5e5e5',
        fontSize: '13px',
      },
      '.cm-content': { caretColor: '#fff', padding: '20px 24px' },
      '.cm-gutters': {
        backgroundColor: '#000',
        color: 'rgba(255,255,255,0.25)',
        border: 'none',
      },
      '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent' },
      '.cm-cursor': { borderLeftColor: '#fff' },
      '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(255,255,255,0.15)' },
      // y-codemirror.next remote-cursor styles. Должны зеркалить hone/Editor.tsx
      // honeEditorTheme. Иначе у host vs guest разные visual experience.
      '.cm-ySelection': { backgroundColor: 'rgba(255,255,255,0.18)' },
      '.cm-ySelectionCaret': {
        position: 'relative',
        borderLeft: '2px solid',
        borderRight: '2px solid',
        marginLeft: '-1px',
        marginRight: '-1px',
        boxSizing: 'border-box',
        display: 'inline',
      },
      '.cm-ySelectionCaretDot': {
        borderRadius: '50%',
        position: 'absolute',
        width: 6,
        height: 6,
        top: -3,
        left: -3,
        backgroundColor: 'inherit',
        border: '1px solid #000',
      },
      // y-codemirror'овский встроенный CSS делает opacity:0 + fade →
      // label виден только на hover/movement. !important перебивает,
      // mirror hone Editor.tsx honeEditorTheme.
      '.cm-ySelectionInfo': {
        position: 'absolute',
        top: -1.4,
        left: -1,
        fontSize: '10px',
        fontFamily: 'ui-monospace, monospace',
        fontWeight: 500,
        lineHeight: 'normal',
        userSelect: 'none',
        color: '#000',
        paddingLeft: '4px',
        paddingRight: '4px',
        zIndex: 101,
        transform: 'translateY(-100%)',
        backgroundColor: 'inherit',
        whiteSpace: 'nowrap',
        opacity: '1 !important',
        transition: 'none !important',
      },
    },
    { dark: true },
  )
}

// ─── GuestPrompt ──────────────────────────────────────────────────────────

function GuestPrompt({ onJoin, roomId }: { onJoin: (name: string) => void; roomId: string }) {
  const [name, setName] = useState('')
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 18,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 11,
          letterSpacing: '0.24em',
          color: 'rgba(255,255,255,0.4)',
        }}
      >
        CODE ROOM
      </div>
      <h1
        style={{
          margin: 0,
          fontSize: 32,
          fontWeight: 400,
          letterSpacing: '-0.02em',
          textAlign: 'center',
        }}
      >
        Join as guest
      </h1>
      <p
        style={{
          margin: 0,
          fontSize: 14,
          color: 'rgba(255,255,255,0.6)',
          maxWidth: 380,
          textAlign: 'center',
          lineHeight: 1.6,
        }}
      >
        Enter your name. Other participants will see this in cursors and the
        member list. No account required.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) onJoin(name.trim())
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          width: '100%',
          maxWidth: 320,
          marginTop: 8,
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={40}
          style={{
            padding: '12px 14px',
            fontSize: 14,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10,
            color: '#fff',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={!name.trim()}
          style={{
            padding: '11px 20px',
            borderRadius: 999,
            background: name.trim() ? '#fff' : 'rgba(255,255,255,0.1)',
            color: name.trim() ? '#000' : 'rgba(255,255,255,0.4)',
            border: 'none',
            cursor: name.trim() ? 'pointer' : 'default',
            fontSize: 13.5,
            fontWeight: 500,
            transition: 'background-color 160ms ease, color 160ms ease',
          }}
        >
          Join room
        </button>
      </form>
      <div
        style={{
          marginTop: 14,
          fontSize: 9,
          letterSpacing: '0.2em',
          color: 'rgba(255,255,255,0.3)',
          fontFamily: '"JetBrains Mono", monospace',
        }}
      >
        ROOM · {roomId.slice(0, 8)}
      </div>
    </div>
  )
}

// ─── WS helper ────────────────────────────────────────────────────────────

interface WsEnvelope {
  kind: string
  data?: unknown
}

function openWs(
  url: string,
  opts: {
    onStatus: (s: 'connecting' | 'open' | 'reconnecting' | 'failed') => void
    onEnvelope: (env: WsEnvelope) => void
  },
): { send: (env: WsEnvelope) => boolean; close: () => void } {
  let ws: WebSocket | null = null
  let attempts = 0
  let timer: number | null = null
  let closed = false

  // Debug: localStorage.setItem('hone:debug:ws', '1') + reload.
  const dbg = (() => {
    try {
      return window.localStorage.getItem('hone:debug:ws') === '1'
    } catch {
      return false
    }
  })()
  const log = (...args: unknown[]) => {
    if (dbg) console.log('[editor.ws]', ...args)
  }

  const open = () => {
    opts.onStatus(attempts === 0 ? 'connecting' : 'reconnecting')
    log('open attempt', { url, attempts })
    ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      attempts = 0
      log('OPEN')
      opts.onStatus('open')
    }
    ws.onmessage = (ev) => {
      try {
        const data =
          typeof ev.data === 'string'
            ? ev.data
            : new TextDecoder().decode(ev.data as ArrayBuffer)
        const env = JSON.parse(data) as WsEnvelope
        log('RECV', env.kind, { bytes: data.length })
        opts.onEnvelope(env)
      } catch (e) {
        log('RECV malformed', e)
      }
    }
    ws.onclose = (ev) => {
      log('CLOSE', { code: ev.code, reason: ev.reason, attempts })
      if (closed) return
      attempts += 1
      if (attempts > 5) {
        opts.onStatus('failed')
        return
      }
      const backoff = Math.min(10_000, 500 * 2 ** attempts)
      timer = window.setTimeout(open, backoff)
    }
    ws.onerror = (e) => {
      log('ERROR', e)
      /* close handler reconnects */
    }
  }
  open()
  return {
    send: (env) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        log('SEND drop (not open)', { kind: env.kind, readyState: ws?.readyState })
        return false
      }
      const payload = JSON.stringify(env)
      log('SEND', env.kind, { bytes: payload.length })
      ws.send(payload)
      return true
    },
    close: () => {
      closed = true
      if (timer !== null) window.clearTimeout(timer)
      ws?.close()
    },
  }
}

function computeWsBase(): string {
  if (typeof window === 'undefined') return ''
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}`
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] as number)
  return btoa(s)
}

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

function userColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  const hue = Math.abs(h) % 360
  return `hsl(${hue}, 80%, 65%)`
}

// ─── CenterMessage ────────────────────────────────────────────────────────

function CenterMessage({ text, sub }: { text: string; sub?: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 14,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 11,
          letterSpacing: '0.24em',
          color: 'rgba(255,255,255,0.4)',
        }}
      >
        {text}
      </div>
      {sub && (
        <p
          style={{
            margin: 0,
            fontSize: 14,
            color: 'rgba(255,255,255,0.6)',
            textAlign: 'center',
            maxWidth: 420,
            lineHeight: 1.6,
          }}
        >
          {sub}
        </p>
      )}
    </div>
  )
}
