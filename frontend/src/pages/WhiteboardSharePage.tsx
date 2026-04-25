// /whiteboard/:roomId — публичная multiplayer-страница для shared-board.
//
// Контракт:
//   - Если auth-токен валиден → подключаемся как этот юзер. Доска
//     добавляется в его список (auto-join через GET /whiteboard/room/{id}).
//   - Если токена нет → показываем sign-in CTA с возвратом сюда. Гость-flow
//     без регистрации потребует guest-token endpoint на бэке (отдельная
//     задача); пока требуем auth.
//   - Owner может flip'нуть visibility=private — тогда все кроме него
//     получают 403 (см. backend ws_handler + app.GetRoom).
//
// Архитектура sync (mirrors hone/SharedBoards.tsx):
//   - Y.Doc + Y.Map<'scene'>['elements'] хранит JSON-stringified Excalidraw
//     elements. Local change → Y.Map.set → ws-update relay.
//   - Awareness (y-protocols) для cursors других участников →
//     Excalidraw appState.collaborators map.
//   - WS envelope kinds: 'snapshot', 'update', 'awareness', 'ping'/'pong'.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import * as Y from 'yjs'
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness'
import { Excalidraw, CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import '@excalidraw/excalidraw/index.css'

import { API_BASE, readAccessToken } from '../lib/apiClient'

// ─── Types ────────────────────────────────────────────────────────────────

interface RoomMeta {
  id: string
  ownerId: string
  title: string
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

// ─── Page component ───────────────────────────────────────────────────────

export default function WhiteboardSharePage() {
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

  // Initial load: try with existing token, fall back to guest prompt.
  const tryLoadWithToken = useCallback(
    async (token: string | null, guestToken?: string) => {
      const useToken = guestToken ?? token
      if (!useToken) {
        setState({ kind: 'guest-prompt' })
        return
      }
      try {
        const resp = await fetch(`${API_BASE}/whiteboard/room/${id}`, {
          headers: { authorization: `Bearer ${useToken}` },
        })
        if (resp.status === 401) {
          setState({ kind: 'guest-prompt' })
          return
        }
        if (resp.status === 403) {
          setState({ kind: 'forbidden', reason: 'This board is private.' })
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
          title?: string
          participants?: { userId?: string; user_id?: string; username?: string }[]
        }
        const room: RoomMeta = {
          id: json.id,
          ownerId: json.ownerId ?? json.owner_id ?? '',
          title: json.title ?? 'Untitled board',
          participants: (json.participants ?? []).map((p) => ({
            userId: p.userId ?? p.user_id ?? '',
            username: p.username ?? 'guest',
          })),
        }
        // Decode current user_id from JWT — иначе awareness писал owner'а
        // как self для всех гостей (см. RoomEditor `me = participants.find(
        // p => p.userId === room.ownerId)`).
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
        const resp = await fetch(`${API_BASE}/whiteboard/room/${id}/guest-join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        if (resp.status === 403) {
          setState({ kind: 'forbidden', reason: 'This board is private. Owner has not enabled guest access.' })
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
        // Don't write to localStorage — we keep guest token in-memory only,
        // attached to this page state (guestToken). Then re-fetch room meta.
        await tryLoadWithToken(null, json.access_token)
      } catch (e) {
        setState({ kind: 'error', message: (e as Error).message })
      }
    },
    [id, tryLoadWithToken],
  )

  if (state.kind === 'loading') return <CenterMessage text="LOADING BOARD…" />
  if (state.kind === 'guest-prompt') {
    return <GuestPrompt onJoin={(name) => void handleGuestJoin(name)} boardId={id} />
  }
  if (state.kind === 'forbidden') {
    return <CenterMessage text="PRIVATE BOARD" sub={state.reason} />
  }
  if (state.kind === 'not-found') return <CenterMessage text="BOARD NOT FOUND" />
  if (state.kind === 'expired') return <CenterMessage text="BOARD EXPIRED" />
  if (state.kind === 'error') return <CenterMessage text="ERROR" sub={state.message} />

  return <RoomCanvas room={state.room} guestToken={state.guestToken} myUserId={state.myUserId} />
}

// ─── Guest prompt — name + join button ───────────────────────────────────

function GuestPrompt({
  onJoin,
  boardId,
}: {
  onJoin: (name: string) => void
  boardId: string
}) {
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
        SHARED BOARD
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
          Join board
        </button>
      </form>
      <div
        className="mono"
        style={{
          marginTop: 14,
          fontSize: 9,
          letterSpacing: '0.2em',
          color: 'rgba(255,255,255,0.3)',
          fontFamily: '"JetBrains Mono", monospace',
        }}
      >
        ROOM · {boardId.slice(0, 8)}
      </div>
    </div>
  )
}

// ─── RoomCanvas — full multiplayer Excalidraw ────────────────────────────

const RoomCanvas = memo(RoomCanvasImpl)

// decodeJwtSub — извлекает `sub` claim (user UUID) из JWT без верификации
// подписи. Auth-критичные операции всё равно проверяются на бэке —
// здесь нужно только для UI-идентификации current user'а.
function decodeJwtSub(token: string | null): string | undefined {
  if (!token) return undefined
  try {
    const parts = token.split('.')
    if (parts.length < 2) return undefined
    const payload = parts[1]!
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
    const json = JSON.parse(atob(b64)) as { sub?: string }
    return typeof json.sub === 'string' ? json.sub : undefined
  } catch {
    return undefined
  }
}

function RoomCanvasImpl({ room, guestToken, myUserId }: { room: RoomMeta; guestToken?: string; myUserId?: string }) {
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'reconnecting' | 'failed'>(
    'connecting',
  )
  const ydocRef = useRef<Y.Doc | null>(null)
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const sendRef = useRef<((u: Uint8Array) => void) | null>(null)
  const sendAwarenessRef = useRef<((u: Uint8Array) => void) | null>(null)
  const wsCloseRef = useRef<(() => void) | null>(null)
  const awarenessRef = useRef<Awareness | null>(null)
  const applyingRemoteRef = useRef(false)
  const debounceRef = useRef<number | null>(null)
  const pendingElementsRef = useRef<string | null>(null)

  useEffect(() => {
    const ydoc = new Y.Doc()
    ydocRef.current = ydoc
    const yScene = ydoc.getMap<string>('scene')

    const awareness = new Awareness(ydoc)
    awarenessRef.current = awareness
    // КРИТИЧНО: ищем СЕБЯ по myUserId (decoded из JWT), не по ownerId.
    // Раньше у всех гостей name был = owner'у → одинаковые имена на canvas.
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

    const onAwChange = () => {
      const api = apiRef.current
      if (!api) return
      const collabs = new Map<string, {
        pointer?: { x: number; y: number; tool: 'pointer' | 'laser' }
        username?: string
        color?: { background: string; stroke: string }
      }>()
      awareness.getStates().forEach((stateRaw, clientId) => {
        if (clientId === awareness.clientID) return
        const u = (stateRaw as { user?: { name?: string; color?: string } }).user
        const p = (stateRaw as { pointer?: { x: number; y: number } }).pointer
        if (!u) return
        collabs.set(String(clientId), {
          username: u.name || 'guest',
          color: { background: u.color || '#888', stroke: u.color || '#888' },
          pointer: p ? { x: p.x, y: p.y, tool: 'pointer' } : undefined,
        })
      })
      try {
        api.updateScene({
          collaborators: collabs as never,
          captureUpdate: CaptureUpdateAction.NEVER,
        })
      } catch {
        /* ignore */
      }
    }
    awareness.on('change', onAwChange)

    const onSceneChange = () => {
      const json = yScene.get('elements')
      if (!json || !apiRef.current) return
      try {
        const elements = JSON.parse(json)
        applyingRemoteRef.current = true
        apiRef.current.updateScene({
          elements,
          captureUpdate: CaptureUpdateAction.NEVER,
        })
      } catch {
        /* ignore parse */
      } finally {
        queueMicrotask(() => {
          applyingRemoteRef.current = false
        })
      }
    }
    yScene.observe(onSceneChange)

    // Guest-token (если есть) приоритетен, потому что на этой странице
    // юзер мог войти как guest, не имея access_token в localStorage.
    const token = guestToken ?? readAccessToken() ?? ''
    const wsBase = computeWsBase()
    const url = `${wsBase}/ws/whiteboard/${encodeURIComponent(room.id)}?token=${encodeURIComponent(token)}`
    const handle = openWs(url, {
      onStatus: setWsStatus,
      onEnvelope: (env) => {
        if (env.kind === 'snapshot' || env.kind === 'update') {
          const data = env.data as { update?: string }
          if (data?.update) {
            Y.applyUpdate(ydoc, b64ToBytes(data.update), 'remote')
          }
        } else if (env.kind === 'awareness') {
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
      handle.send({ kind: 'update', data: { update: bytesToB64(update) } })
    }
    sendAwarenessRef.current = (update) => {
      handle.send({ kind: 'awareness', data: { update: bytesToB64(update) } })
    }

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      const pending = pendingElementsRef.current
      pendingElementsRef.current = null
      if (pending !== null && yScene.get('elements') !== pending) {
        yScene.set('elements', pending)
      }
      yScene.unobserve(onSceneChange)
      ydoc.off('update', onYUpdate)
      awareness.off('update', onAwUpdate)
      awareness.off('change', onAwChange)
      const closeHandle = wsCloseRef.current
      window.setTimeout(() => {
        closeHandle?.()
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
      awarenessRef.current = null
      wsCloseRef.current = null
      sendRef.current = null
      sendAwarenessRef.current = null
    }
  }, [room])

  const handleChange = useCallback((elements: readonly unknown[]) => {
    if (applyingRemoteRef.current) return
    const ydoc = ydocRef.current
    if (!ydoc) return
    const yScene = ydoc.getMap<string>('scene')
    const json = JSON.stringify(elements)
    pendingElementsRef.current = json
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      if (yScene.get('elements') === json) {
        pendingElementsRef.current = null
        return
      }
      yScene.set('elements', json)
      pendingElementsRef.current = null
    }, 80)
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <div className="hone-excalidraw-mount-web" style={{ position: 'absolute', inset: 0 }}>
        <Excalidraw
          theme="dark"
          excalidrawAPI={(api) => {
            apiRef.current = api
            // КРИТИЧНО: WS snapshot часто приезжает РАНЬШЕ чем Excalidraw
            // успевает смонтироваться и вызвать этот callback. Тогда
            // yScene.observe срабатывает с apiRef.current === null и
            // сцена теряется (host рисовал ДО прихода guest'а — guest
            // никогда не увидит). Replay yScene → Excalidraw здесь.
            const ydoc = ydocRef.current
            if (ydoc) {
              const yScene = ydoc.getMap<string>('scene')
              const json = yScene.get('elements')
              if (json) {
                try {
                  const elements = JSON.parse(json)
                  applyingRemoteRef.current = true
                  api.updateScene({
                    elements,
                    captureUpdate: CaptureUpdateAction.NEVER,
                  })
                  queueMicrotask(() => {
                    applyingRemoteRef.current = false
                  })
                } catch {
                  /* ignore parse */
                }
              }
            }
            requestAnimationFrame(() => {
              try {
                api.refresh()
              } catch {
                /* ignore */
              }
            })
            window.setTimeout(() => {
              try {
                api.refresh()
              } catch {
                /* ignore */
              }
            }, 100)
          }}
          onPointerUpdate={(payload) => {
            const aw = awarenessRef.current
            if (!aw) return
            const p = payload?.pointer
            if (!p) return
            aw.setLocalStateField('pointer', { x: p.x, y: p.y })
          }}
          onChange={handleChange}
          UIOptions={{
            canvasActions: { saveToActiveFile: false, loadScene: false, export: false },
          }}
        />
      </div>
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
        <span>{room.title}</span>
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
      <style>{webExcalidrawStyles}</style>
    </div>
  )
}

// Inject same dark-mode + filter overrides as Hone desktop.
const webExcalidrawStyles = `
.hone-excalidraw-mount-web .excalidraw {
  --color-canvas-background: #000;
  --theme-filter: invert(100%) hue-rotate(180deg) !important;
}
.hone-excalidraw-mount-web .excalidraw .layer-ui__wrapper__top-right,
.hone-excalidraw-mount-web .excalidraw .scroll-back-to-content,
.hone-excalidraw-mount-web .excalidraw .help-icon {
  display: none !important;
}
`

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

  // Debug logs включаются через `localStorage.setItem('hone:debug:ws', '1')`.
  // Зеркалит формат app-логов в hone/.../whiteboard.ts чтобы можно было
  // сравнивать оба клиента side-by-side.
  const dbg = (() => {
    try {
      return window.localStorage.getItem('hone:debug:ws') === '1'
    } catch {
      return false
    }
  })()
  const log = (...args: unknown[]) => {
    if (dbg) console.log('[wb.ws]', ...args)
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

// ─── Center message UI ────────────────────────────────────────────────────

function CenterMessage({
  text,
  sub,
  cta,
}: {
  text: string
  sub?: string
  cta?: { label: string; onClick: () => void }
}) {
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
        padding: '32px',
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
      {cta && (
        <button
          onClick={cta.onClick}
          style={{
            marginTop: 10,
            padding: '10px 20px',
            borderRadius: 999,
            background: '#fff',
            color: '#000',
            border: 'none',
            cursor: 'pointer',
            fontSize: 13.5,
            fontWeight: 500,
          }}
        >
          {cta.label}
        </button>
      )}
    </div>
  )
}
