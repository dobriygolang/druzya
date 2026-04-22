// Singleton-менеджер WebSocket с reconnect (экспоненциальный backoff с потолком 10с)
// и JWT-авторизацией через query-параметр. Один сокет на канал.

export type WSStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

type Handler = (event: string, payload: unknown) => void
type StatusHandler = (status: WSStatus) => void

interface ChannelState {
  ws: WebSocket | null
  status: WSStatus
  handlers: Set<Handler>
  statusHandlers: Set<StatusHandler>
  reconnectAttempts: number
  reconnectTimer: number | null
  refCount: number
  closedByUser: boolean
}

const channels = new Map<string, ChannelState>()

function baseUrl(): string {
  const env = import.meta.env.VITE_WS_BASE
  if (env && /^wss?:\/\//.test(env)) return env.replace(/\/$/, '')
  // Резолвим относительный путь относительно текущего origin.
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const path = (env || '/ws').replace(/\/$/, '')
    return `${proto}//${window.location.host}${path.startsWith('/') ? path : `/${path}`}`
  }
  return 'ws://localhost/ws'
}

function getToken(): string | null {
  try {
    return (
      localStorage.getItem('auth_token') ||
      localStorage.getItem('jwt') ||
      null
    )
  } catch {
    return null
  }
}

function ensureChannel(channel: string): ChannelState {
  let s = channels.get(channel)
  if (!s) {
    s = {
      ws: null,
      status: 'idle',
      handlers: new Set(),
      statusHandlers: new Set(),
      reconnectAttempts: 0,
      reconnectTimer: null,
      refCount: 0,
      closedByUser: false,
    }
    channels.set(channel, s)
  }
  return s
}

function setStatus(state: ChannelState, status: WSStatus) {
  state.status = status
  state.statusHandlers.forEach((h) => {
    try {
      h(status)
    } catch {
      // игнор
    }
  })
}

function scheduleReconnect(channel: string) {
  const state = ensureChannel(channel)
  if (state.closedByUser) return
  const attempt = state.reconnectAttempts + 1
  state.reconnectAttempts = attempt
  const delay = Math.min(10_000, 500 * 2 ** (attempt - 1))
  setStatus(state, 'reconnecting')
  if (state.reconnectTimer) {
    window.clearTimeout(state.reconnectTimer)
  }
  state.reconnectTimer = window.setTimeout(() => {
    state.reconnectTimer = null
    openSocket(channel)
  }, delay)
}

function openSocket(channel: string) {
  const state = ensureChannel(channel)
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
    return
  }
  setStatus(state, 'connecting')
  const token = getToken()
  const sep = channel.includes('?') ? '&' : '?'
  const url = `${baseUrl()}/${channel}${token ? `${sep}token=${encodeURIComponent(token)}` : ''}`
  let ws: WebSocket
  try {
    ws = new WebSocket(url)
  } catch {
    scheduleReconnect(channel)
    return
  }
  state.ws = ws

  ws.onopen = () => {
    state.reconnectAttempts = 0
    setStatus(state, 'open')
  }
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data)
      const event = data.event ?? data.type
      const payload = data.payload ?? data.data ?? data
      if (typeof event === 'string') {
        state.handlers.forEach((h) => {
          try {
            h(event, payload)
          } catch {
            // игнор handler errors
          }
        })
      }
    } catch {
      // не-JSON фрейм, игнор
    }
  }
  ws.onerror = () => {
    // Reconnect инициируется в onclose.
  }
  ws.onclose = () => {
    state.ws = null
    if (state.closedByUser) {
      setStatus(state, 'closed')
    } else {
      scheduleReconnect(channel)
    }
  }
}

export const wsClient = {
  connect(channel: string): void {
    const state = ensureChannel(channel)
    state.refCount += 1
    state.closedByUser = false
    if (!state.ws) openSocket(channel)
  },
  disconnect(channel: string): void {
    const state = channels.get(channel)
    if (!state) return
    state.refCount = Math.max(0, state.refCount - 1)
    if (state.refCount > 0) return
    state.closedByUser = true
    if (state.reconnectTimer) {
      window.clearTimeout(state.reconnectTimer)
      state.reconnectTimer = null
    }
    if (state.ws) {
      try {
        state.ws.close()
      } catch {
        // игнор
      }
      state.ws = null
    }
    setStatus(state, 'closed')
    channels.delete(channel)
  },
  send(channel: string, event: string, payload: unknown): void {
    const state = channels.get(channel)
    if (!state || !state.ws || state.ws.readyState !== WebSocket.OPEN) return
    try {
      state.ws.send(JSON.stringify({ event, payload }))
    } catch {
      // игнор
    }
  },
  on(channel: string, handler: Handler): () => void {
    const state = ensureChannel(channel)
    state.handlers.add(handler)
    return () => {
      state.handlers.delete(handler)
    }
  },
  onStatus(channel: string, handler: StatusHandler): () => void {
    const state = ensureChannel(channel)
    state.statusHandlers.add(handler)
    handler(state.status)
    return () => {
      state.statusHandlers.delete(handler)
    }
  },
  status(channel: string): WSStatus {
    return channels.get(channel)?.status ?? 'idle'
  },
}
