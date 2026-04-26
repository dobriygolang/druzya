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
import { IndexeddbPersistence } from 'y-indexeddb'
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness'
import { yCollab } from 'y-codemirror.next'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, lineNumbers, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { go } from '@codemirror/lang-go'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { HighlightStyle, syntaxHighlighting, indentOnInput } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

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
  | { kind: 'ready'; room: RoomMeta; guestToken?: string; myUserId?: string; myDisplayName?: string }

// ─── Page ─────────────────────────────────────────────────────────────────

export default function EditorRoomSharePage() {
  const { roomId } = useParams<{ roomId: string }>()
  const id = useMemo(() => (roomId ?? '').trim(), [roomId])
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#1e1e1e'
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
        const myDisplayName = decodeJwtClaim(useToken, 'dn')
        setState({ kind: 'ready', room, guestToken, myUserId, myDisplayName })
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

  return (
    <RoomEditor
      room={state.room}
      guestToken={state.guestToken}
      myUserId={state.myUserId}
      myDisplayName={state.myDisplayName}
    />
  )
}

// ─── RoomEditor — full multiplayer CodeMirror ────────────────────────────

const RoomEditor = memo(RoomEditorImpl)

// decodeJwtSub — base64url decode middle JWT part, extract `sub` claim.
// Используется чтобы определить current user_id без отдельного /me запроса.
// Не валидирует подпись — это OK для чисто визуальной идентификации
// (auth-критичные операции всё равно проверяются на бэке).
function decodeJwtSub(token: string | null): string | undefined {
  return decodeJwtClaim(token, 'sub')
}

// decodeJwtClaim — generic JWT body parser. Used by both `sub` (user-id)
// and `dn` (guest display name) reads. No signature check — OK for the
// purely visual cursor label; auth-critical ops still verify server-side.
function decodeJwtClaim(token: string | null, claim: string): string | undefined {
  if (!token) return undefined
  try {
    const parts = token.split('.')
    if (parts.length < 2) return undefined
    const payload = parts[1]!
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
    const json = JSON.parse(atob(b64)) as Record<string, unknown>
    const v = json[claim]
    return typeof v === 'string' ? v : undefined
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

// Judge0 status descriptions, которые означают что sandbox сам упал (не наш
// код). Показываем юзеру отдельным сообщением, иначе panel пустой и юзер
// думает что проблема в его коде. Полный список — Judge0 docs status_id 6+.
function isJudgeError(status: string): boolean {
  if (!status) return false
  const s = status.toLowerCase()
  return s.includes('internal error') || s.includes('exec format') || s === 'undefined'
}

function RoomEditorImpl({ room, guestToken, myUserId, myDisplayName }: { room: RoomMeta; guestToken?: string; myUserId?: string; myDisplayName?: string }) {
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'reconnecting' | 'failed'>(
    'connecting',
  )
  const ydocRef = useRef<Y.Doc | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const sendRef = useRef<((u: Uint8Array) => void) | null>(null)
  const sendAwarenessRef = useRef<((u: Uint8Array) => void) | null>(null)
  const sendSnapshotRef = useRef<((u: Uint8Array) => void) | null>(null)
  const wsCloseRef = useRef<(() => void) | null>(null)

  // Theme picker — 4 переключаемых темы (зеркалит hone/Editor.tsx). Hot-swap
  // через themeCompartment.reconfigure(...). Persist в localStorage.
  const themeCompartmentRef = useRef<Compartment | null>(null)
  const [themeName, setThemeName] = useState<EditorThemeName>(() => {
    const saved = window.localStorage.getItem('druz9:web-editor:theme')
    if (saved && (EDITOR_THEME_ORDER as string[]).includes(saved)) {
      return saved as EditorThemeName
    }
    return 'vscode' // web default — VSCode (раньше vscodeDarkHighlight только)
  })
  const cycleTheme = useCallback(() => {
    setThemeName((cur) => {
      const idx = EDITOR_THEME_ORDER.indexOf(cur)
      const next = EDITOR_THEME_ORDER[(idx + 1) % EDITOR_THEME_ORDER.length]!
      try { window.localStorage.setItem('druz9:web-editor:theme', next) } catch { /* ignore */ }
      return next
    })
  }, [])

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

    // Local-first: y-indexeddb сохраняет код локально. Offline-edits
    // переживают reload + reconnect; при rejoin'е CRDT merge сам разрулит
    // local + remote updates. Mirror hone Editor.tsx.
    const persistence = new IndexeddbPersistence(`druz9:editor:${room.id}`, ydoc)

    const awareness = new Awareness(ydoc)
    // КРИТИЧНО: ищем СЕБЯ по myUserId (decoded из JWT), не по ownerId.
    // Раньше тут был `p.userId === room.ownerId` → у всех гостей name
    // оказывался username'ом owner'а ("dobriygolang") вместо собственного.
    const me = myUserId ? room.participants.find((p) => p.userId === myUserId) : undefined
    // Wave-15: гости больше не лежат в participants — имя берётся из
    // dn claim'а JWT (см. MintScopedWithDisplayName на бэке). Fallback'и:
    // participants.username (зарегистрированный юзер) → dn (гость) → 'guest'.
    awareness.setLocalStateField('user', {
      name: me?.username || myDisplayName || 'guest',
      color: userColor(myUserId || room.id),
    })

    // Snapshot scheduler — 1.5s после последнего edit'а шлём
    // Y.encodeStateAsUpdate(ydoc) серверу. Сервер хранит latest blob и
    // hydrate'ит новых join'ов. Без этого guest на refresh видел пустой
    // ytext (editor был чисто-relay).
    let snapshotTimer: number | null = null
    const sendFullSnapshot = () => {
      const sender = sendSnapshotRef.current
      if (!sender) return
      const full = Y.encodeStateAsUpdate(ydoc)
      if (full.byteLength > 0) sender(full)
    }
    const scheduleSnapshot = () => {
      if (snapshotTimer !== null) window.clearTimeout(snapshotTimer)
      snapshotTimer = window.setTimeout(() => {
        snapshotTimer = null
        sendFullSnapshot()
      }, 1500)
    }

    const onYUpdate = (update: Uint8Array, origin: unknown) => {
      // 'remote' — WS apply; persistence — IndexedDB restore on mount.
      // Игнорируем оба чтобы не зацикливать.
      if (origin === 'remote' || origin === persistence) return
      sendRef.current?.(update)
      scheduleSnapshot()
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
    sendSnapshotRef.current = (full) => {
      handle.send({ kind: 'snapshot', data: { payload: bytesToB64(full) } })
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
    const themeCompartment = new Compartment()
    themeCompartmentRef.current = themeCompartment
    const initialBundle = EDITOR_THEMES[themeName]

    const cmState = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        history(),
        indentOnInput(),
        // indentWithTab ПЕРЕД defaultKeymap'ом — иначе Tab focus-trap'ится
        // на сайдбар (browser default behavior + CM defaultKeymap не имеет
        // tab→indent). Mirror hone Editor.tsx.
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        langCompartment.of(langExt),
        // Theme compartment — 4 темы (BLACK / VSCODE / YANDEX / CODE-IV).
        // Hot-swap'аются через themeCompartment.reconfigure(...) при click'е
        // на theme-button в top-bar'е.
        themeCompartment.of([
          syntaxHighlighting(initialBundle.highlight),
          initialBundle.theme,
        ]),
        yCollab(ytext, awareness),
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
      if (snapshotTimer !== null) {
        window.clearTimeout(snapshotTimer)
        snapshotTimer = null
      }
      try { sendFullSnapshot() } catch { /* ignore */ }
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
        try {
          void persistence.destroy()
        } catch {
          /* ignore */
        }
      }, 60)
      ydocRef.current = null
      wsCloseRef.current = null
      sendRef.current = null
      sendAwarenessRef.current = null
      sendSnapshotRef.current = null
    }
  }, [room, guestToken])

  // handleFormat — реальный gofmt через backend (POST /editor/room/{id}/format).
  // Backend использует go/format std-lib для Go. Fallback — local trim
  // trailing whitespace когда сервер недоступен / не Go.
  const handleFormat = useCallback(async () => {
    const view = viewRef.current
    if (!view) return
    const code = view.state.doc.toString()
    if (!code) return
    // Smart client-side reformatter — для языков, на которые backend
    // `go/format` не подходит (Python/JS/TS) делает то же что hone version:
    // trim trailing, collapse 3+ blank lines в 1, tab→space normalize,
    // ensure final newline. Не настоящий black/prettier, но реально
    // что-то делает кроме «ничего».
    const fallbackTrim = () => {
      const { state } = view
      const indentSpaces = room.language === 'python' ? 4 : 2
      const original = state.doc.toString()
      let lines = original.split('\n').map((l) => l.replace(/[ \t]+$/, ''))
      lines = lines.map((l) => l.replace(/\t/g, ' '.repeat(indentSpaces)))
      const collapsed: string[] = []
      let blankRun = 0
      for (const l of lines) {
        if (l.trim() === '') {
          blankRun += 1
          if (blankRun <= 1) collapsed.push(l)
        } else {
          blankRun = 0
          collapsed.push(l)
        }
      }
      while (collapsed.length > 0 && collapsed[collapsed.length - 1] === '') {
        collapsed.pop()
      }
      const next = collapsed.join('\n') + '\n'
      if (next !== original) {
        view.dispatch({ changes: { from: 0, to: state.doc.length, insert: next } })
      }
    }
    try {
      const token = guestToken ?? readAccessToken() ?? ''
      const resp = await fetch(
        `${API_BASE}/editor/room/${encodeURIComponent(room.id)}/format`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ code, language: room.language }),
        },
      )
      if (!resp.ok) {
        fallbackTrim()
        return
      }
      const j = (await resp.json()) as { code?: string; error?: string }
      if (j.error || typeof j.code !== 'string') {
        fallbackTrim()
        return
      }
      if (j.code !== code) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: j.code } })
      }
    } catch {
      fallbackTrim()
    }
  }, [room.id, room.language, guestToken])

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
      // Vanguard transcoder принимает enum либо как int, либо как имя.
      // Используем имя — это canonical proto3 JSON form, безопаснее против
      // version skew между прото и transcoder'ом.
      const langName: Record<string, string> = {
        go: 'LANGUAGE_GO',
        python: 'LANGUAGE_PYTHON',
        javascript: 'LANGUAGE_JAVASCRIPT',
        typescript: 'LANGUAGE_TYPESCRIPT',
      }
      const lang = langName[room.language] ?? 'LANGUAGE_UNSPECIFIED'
      const resp = await fetch(`${API_BASE}/editor/room/${encodeURIComponent(room.id)}/run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code, language: lang }),
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
        void handleFormat()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleRun, handleFormat])

  // Theme reconfigure — hot-swap'аем theme bundle через Compartment.
  // Не пересоздаём view → cursor/selection/yCollab/scroll сохраняются.
  useEffect(() => {
    const view = viewRef.current
    const compartment = themeCompartmentRef.current
    if (!view || !compartment) return
    const bundle = EDITOR_THEMES[themeName]
    view.dispatch({
      effects: compartment.reconfigure([
        syntaxHighlighting(bundle.highlight),
        bundle.theme,
      ]),
    })
  }, [themeName])

  // Root bg/fg синхронны с активной темой — иначе при переключении на
  // YANDEX (light) edge-зоны вне CodeMirror'а оставались тёмными.
  const themeRootBg =
    themeName === 'yandex-code' ? '#ffffff'
    : themeName === 'black' ? '#000'
    : themeName === 'code-interview' ? '#181820'
    : '#1e1e1e'
  const themeRootFg = themeName === 'yandex-code' ? '#080808' : '#d4d4d4'
  return (
    <div style={{ position: 'fixed', inset: 0, background: themeRootBg, color: themeRootFg }}>
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
          onClick={cycleTheme}
          title={`Theme: ${EDITOR_THEME_LABEL[themeName]} — click to cycle`}
          style={{
            padding: '7px 12px',
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
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#fff' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)' }}
        >
          <span aria-hidden style={{ fontSize: 11 }}>◐</span>
          {EDITOR_THEME_LABEL[themeName]}
        </button>
        <button
          onClick={() => void handleFormat()}
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
                <span
                  style={{
                    color: isJudgeError(runResult.status) ? '#ff8c8c' : 'rgba(255,255,255,0.4)',
                    fontSize: 10,
                    letterSpacing: '0.12em',
                  }}
                >
                  {isJudgeError(runResult.status)
                    ? `JUDGE0 · ${runResult.status.toUpperCase()}`
                    : `EXIT ${runResult.exitCode} · ${runResult.timeMs}ms`}
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
                  ? isJudgeError(runResult.status)
                    ? `Sandbox returned status: "${runResult.status}".\n\nThis usually means Judge0 itself failed (host cgroup config, isolate sandbox not initialised, or workers down). Common fix on the server side:\n  • Ensure both judge0-server and judge0-workers run with privileged: true\n  • Boot host with cgroup v1 (Judge0 1.13.x doesn't support cgroup v2 — set GRUB \`systemd.unified_cgroup_hierarchy=0\`)\n  • Check \`docker logs infra-judge0-workers-1\` for ENOSPC / isolate errors\n\nThis is not your code — the sandbox didn't even attempt to compile it.`
                    : outputTab === 'stdout'
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

// ─── Editor themes (4 переключаемых, mirror hone/Editor.tsx) ─────────────
//
// black / vscode / yandex-code / code-interview. Кнопка-cycle в top-bar
// циклирует через них; выбор persist'ится в localStorage. Hot-swap через
// CodeMirror Compartment без re-create EditorView'а.
type EditorThemeName = 'black' | 'vscode' | 'yandex-code' | 'code-interview'
const EDITOR_THEME_ORDER: EditorThemeName[] = ['black', 'vscode', 'yandex-code', 'code-interview']
const EDITOR_THEME_LABEL: Record<EditorThemeName, string> = {
  'black': 'BLACK',
  'vscode': 'VSCODE',
  'yandex-code': 'YANDEX',
  'code-interview': 'CODE-IV',
}
interface EditorThemeBundle {
  highlight: HighlightStyle
  theme: ReturnType<typeof EditorView.theme>
}
function makeEditorTheme(opts: {
  bg: string; fg: string; caret: string; selection: string;
  gutter: string; gutterFg: string; activeLine: string; dark: boolean
}) {
  return EditorView.theme(
    {
      '&': {
        height: '100vh',
        backgroundColor: opts.bg,
        color: opts.fg,
        fontSize: '14px',
        fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
      },
      '.cm-content': { caretColor: opts.caret, padding: '20px 24px', color: opts.fg },
      '.cm-gutters': { backgroundColor: opts.gutter, color: opts.gutterFg, border: 'none' },
      '.cm-activeLine': { backgroundColor: opts.activeLine },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: opts.fg },
      '.cm-cursor': { borderLeftColor: opts.caret, borderLeftWidth: '1.5px' },
      '.cm-selectionBackground, ::selection': { backgroundColor: opts.selection },
      '.cm-ySelection': { backgroundColor: opts.selection },
      '.cm-ySelectionCaret': {
        position: 'relative',
        borderLeft: '2px solid', borderRight: '2px solid',
        marginLeft: '-1px', marginRight: '-1px',
        boxSizing: 'border-box', display: 'inline',
      },
      '.cm-ySelectionCaretDot': {
        borderRadius: '50%',
        position: 'absolute', width: 6, height: 6, top: -3, left: -3,
        backgroundColor: 'inherit', border: `1px solid ${opts.bg}`,
      },
      '.cm-ySelectionInfo': {
        position: 'absolute', top: -1.4, left: -1,
        fontSize: '10px', fontFamily: 'ui-monospace, monospace',
        fontWeight: 500, lineHeight: 'normal', userSelect: 'none',
        color: opts.dark ? '#000' : '#fff',
        paddingLeft: '4px', paddingRight: '4px', zIndex: 101,
        transform: 'translateY(-100%)', backgroundColor: 'inherit',
        whiteSpace: 'nowrap',
        opacity: '1 !important', transition: 'none !important',
      },
    },
    { dark: opts.dark },
  )
}
const EDITOR_THEMES: Record<EditorThemeName, EditorThemeBundle> = {
  black: {
    highlight: HighlightStyle.define([
      { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier, t.definitionKeyword], color: '#c678dd', fontWeight: '600' },
      { tag: [t.typeName, t.className, t.namespace], color: '#56b6c2' },
      { tag: t.string, color: '#e5c07b' },
      { tag: t.regexp, color: '#e06c75' },
      { tag: t.number, color: '#d19a66' },
      { tag: t.bool, color: '#d19a66' },
      { tag: t.null, color: '#d19a66' },
      { tag: t.literal, color: '#d19a66' },
      { tag: t.comment, color: '#7f848e', fontStyle: 'italic' },
      { tag: t.lineComment, color: '#7f848e', fontStyle: 'italic' },
      { tag: t.blockComment, color: '#7f848e', fontStyle: 'italic' },
      { tag: t.docComment, color: '#7f848e', fontStyle: 'italic' },
      { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#61afef' },
      { tag: [t.variableName, t.propertyName], color: '#e5e5e5' },
      { tag: t.operator, color: '#abb2bf' },
      { tag: t.punctuation, color: '#abb2bf' },
      { tag: t.bracket, color: '#abb2bf' },
      { tag: t.tagName, color: '#e06c75' },
      { tag: t.attributeName, color: '#d19a66' },
      { tag: t.invalid, color: '#ff6a6a' },
    ]),
    theme: makeEditorTheme({
      bg: '#000', fg: '#e5e5e5', caret: '#fff',
      selection: 'rgba(255,255,255,0.18)',
      gutter: '#000', gutterFg: 'rgba(255,255,255,0.25)',
      activeLine: 'rgba(255,255,255,0.02)', dark: true,
    }),
  },
  vscode: {
    highlight: HighlightStyle.define([
      { tag: t.keyword, color: '#569cd6', fontWeight: '500' },
      { tag: [t.controlKeyword, t.moduleKeyword], color: '#c586c0' },
      { tag: [t.string, t.special(t.string)], color: '#ce9178' },
      { tag: t.number, color: '#b5cea8' },
      { tag: t.bool, color: '#569cd6' },
      { tag: t.null, color: '#569cd6' },
      { tag: t.comment, color: '#6a9955', fontStyle: 'italic' },
      { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#dcdcaa' },
      { tag: [t.typeName, t.className], color: '#4ec9b0' },
      { tag: t.variableName, color: '#9cdcfe' },
      { tag: t.propertyName, color: '#9cdcfe' },
      { tag: [t.operator, t.punctuation], color: '#d4d4d4' },
      { tag: t.bracket, color: '#d4d4d4' },
      { tag: t.tagName, color: '#569cd6' },
      { tag: t.attributeName, color: '#9cdcfe' },
      { tag: t.regexp, color: '#d16969' },
      { tag: t.escape, color: '#d7ba7d' },
    ]),
    theme: makeEditorTheme({
      bg: '#1e1e1e', fg: '#d4d4d4', caret: '#aeafad',
      selection: '#264f78',
      gutter: '#1e1e1e', gutterFg: '#858585',
      activeLine: 'rgba(255,255,255,0.04)', dark: true,
    }),
  },
  'yandex-code': {
    highlight: HighlightStyle.define([
      { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier, t.definitionKeyword], color: '#0033b3', fontWeight: '600' },
      { tag: [t.typeName, t.className, t.namespace], color: '#00627a' },
      { tag: t.string, color: '#067d17' },
      { tag: t.regexp, color: '#067d17' },
      { tag: t.number, color: '#1750eb' },
      { tag: t.bool, color: '#0033b3' },
      { tag: t.null, color: '#0033b3' },
      { tag: t.literal, color: '#1750eb' },
      { tag: t.comment, color: '#8c8c8c', fontStyle: 'italic' },
      { tag: t.lineComment, color: '#8c8c8c', fontStyle: 'italic' },
      { tag: t.blockComment, color: '#8c8c8c', fontStyle: 'italic' },
      { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#00627a' },
      { tag: [t.variableName, t.propertyName], color: '#080808' },
      { tag: t.operator, color: '#080808' },
      { tag: t.punctuation, color: '#080808' },
      { tag: t.bracket, color: '#080808' },
      { tag: t.tagName, color: '#0033b3' },
      { tag: t.attributeName, color: '#871094' },
      { tag: t.invalid, color: '#ff0000' },
    ]),
    theme: makeEditorTheme({
      bg: '#ffffff', fg: '#080808', caret: '#080808',
      selection: '#a6d2ff',
      gutter: '#f5f5f5', gutterFg: '#999999',
      activeLine: '#fcfaff', dark: false,
    }),
  },
  'code-interview': {
    highlight: HighlightStyle.define([
      { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier, t.definitionKeyword], color: '#ff79c6' },
      { tag: [t.typeName, t.className, t.namespace], color: '#8be9fd' },
      { tag: t.string, color: '#f1fa8c' },
      { tag: t.regexp, color: '#ff5555' },
      { tag: t.number, color: '#bd93f9' },
      { tag: t.bool, color: '#bd93f9' },
      { tag: t.null, color: '#bd93f9' },
      { tag: t.literal, color: '#bd93f9' },
      { tag: t.comment, color: '#6272a4', fontStyle: 'italic' },
      { tag: t.lineComment, color: '#6272a4', fontStyle: 'italic' },
      { tag: t.blockComment, color: '#6272a4', fontStyle: 'italic' },
      { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#50fa7b' },
      { tag: [t.variableName, t.propertyName], color: '#f8f8f2' },
      { tag: t.operator, color: '#ff79c6' },
      { tag: t.punctuation, color: '#f8f8f2' },
      { tag: t.bracket, color: '#f8f8f2' },
      { tag: t.tagName, color: '#ff79c6' },
      { tag: t.attributeName, color: '#50fa7b' },
      { tag: t.invalid, color: '#ff5555' },
    ]),
    theme: makeEditorTheme({
      bg: '#181820', fg: '#f8f8f2', caret: '#f8f8f2',
      selection: 'rgba(189,147,249,0.30)',
      gutter: '#181820', gutterFg: '#6272a4',
      activeLine: 'rgba(255,255,255,0.03)', dark: true,
    }),
  },
}

// Legacy block — оставлен на случай если найдётся внешний импорт (vite
// tree-shake'ает unused exports). Не используется в Editor'е, новый код
// использует EDITOR_THEMES.
const _legacyVscodeDarkHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#569cd6', fontWeight: '500' }, // if/for/return — VS blue
  { tag: [t.controlKeyword, t.moduleKeyword], color: '#c586c0' }, // import/from — VS purple
  { tag: [t.string, t.special(t.string)], color: '#ce9178' }, // strings — VS orange
  { tag: t.number, color: '#b5cea8' }, // numbers — VS light-green
  { tag: t.bool, color: '#569cd6' }, // true/false — VS blue
  { tag: t.null, color: '#569cd6' },
  { tag: t.comment, color: '#6a9955', fontStyle: 'italic' }, // comments — VS green
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#dcdcaa' }, // fn names — VS yellow
  { tag: [t.typeName, t.className], color: '#4ec9b0' }, // types — VS teal
  { tag: t.variableName, color: '#9cdcfe' }, // identifiers — VS cyan
  { tag: t.propertyName, color: '#9cdcfe' },
  { tag: [t.operator, t.punctuation], color: '#d4d4d4' }, // operators — VS light-grey
  { tag: t.bracket, color: '#d4d4d4' },
  { tag: t.tagName, color: '#569cd6' },
  { tag: t.attributeName, color: '#9cdcfe' },
  { tag: t.regexp, color: '#d16969' }, // regex — VS red
  { tag: t.escape, color: '#d7ba7d' },
])

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _legacyEditorThemeWeb() {
  return EditorView.theme(
    {
      '&': {
        height: '100vh',
        // VSCode Dark+ background: #1e1e1e. Не #000 — pure-black слишком
        // контрастен для долгого чтения, тёмно-серый меньше нагружает глаза.
        backgroundColor: '#1e1e1e',
        color: '#d4d4d4',
        // Font-size 14 → лучше читаемость (юзер просил ↑). Раньше было 13.
        fontSize: '14px',
        fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
      },
      '.cm-content': { caretColor: '#aeafad', padding: '20px 24px' },
      '.cm-gutters': {
        backgroundColor: '#1e1e1e',
        color: '#858585',
        border: 'none',
      },
      // Active line подсветка — VS Code-like серый блик.
      '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#c6c6c6' },
      '.cm-cursor': { borderLeftColor: '#aeafad', borderLeftWidth: '1.5px' },
      '.cm-selectionBackground, ::selection': { backgroundColor: '#264f78' }, // VS selection blue
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
void _legacyVscodeDarkHighlight
void _legacyEditorThemeWeb

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
