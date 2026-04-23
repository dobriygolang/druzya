// Pair-editor (collaborative code rooms) bounded-context client.
//
// REST endpoints (см. backend/cmd/monolith/services/editor.go) — путь
// `/editor/room/...` мостится через ConnectRPC transcoder (EditorService):
//
//   POST /editor/room                          create
//   GET  /editor/room/{roomId}                 detail
//   POST /editor/room/{roomId}/invite          create invite link (HMAC)
//   POST /editor/room/{roomId}/freeze          owner-only freeze (broadcasts ws)
//   GET  /editor/room/{roomId}/replay          export replay (MinIO URL)
//
// WebSocket: `/ws/editor/{roomId}?token=<jwt>` — bidirectional CRDT-ish
// stream. Envelope `{ kind, data }`; backend kinds:
//   - "op"      — text op {payload: base64-bytes}
//   - "cursor"  — {line, column}
//   - "presence"— {user_id, color}
//   - "freeze"  — server→client broadcast on /freeze
//   - "snapshot"— full document on join
//
// Anti-fallback: если backend WS отвечает 4xx — никакого «локального»
// editor-режима. UI показывает <EmptyState variant="error" />. 404 на
// roomId → <EmptyState variant="404-not-found" />.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../apiClient'

export type PairRoom = {
  id: string
  title: string
  language: string
  owner_id: string
  status: 'live' | 'frozen' | string
  created_at: string
}

export type PairParticipant = {
  user_id: string
  display_name?: string
  role: 'owner' | 'guest' | string
  color?: string
}

export type PairRoomDetail = {
  room: PairRoom
  participants: PairParticipant[]
}

export type PairInvite = {
  token: string
  url: string
  expires_at: string
}

export type CreateRoomPayload = {
  title: string
  language: string
}

export function useCreatePairRoomMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateRoomPayload) =>
      api<{ room: PairRoom }>('/editor/room', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pair-editor'] })
    },
  })
}

export function usePairRoomQuery(roomId: string | undefined) {
  return useQuery({
    queryKey: ['pair-editor', 'room', roomId],
    queryFn: async () => {
      try {
        return await api<PairRoomDetail>(`/editor/room/${encodeURIComponent(roomId ?? '')}`)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
    enabled: !!roomId,
    staleTime: 15 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export function useCreatePairInviteMutation(roomId: string | undefined) {
  return useMutation({
    mutationFn: () =>
      api<PairInvite>(`/editor/room/${encodeURIComponent(roomId ?? '')}/invite`, {
        method: 'POST',
        body: '{}',
      }),
  })
}

export function useFreezePairRoomMutation(roomId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api<{ status: 'frozen' }>(`/editor/room/${encodeURIComponent(roomId ?? '')}/freeze`, {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pair-editor', 'room', roomId] })
    },
  })
}

export function usePairReplayQuery(roomId: string | undefined, enabled = false) {
  return useQuery({
    queryKey: ['pair-editor', 'replay', roomId],
    queryFn: () =>
      api<{ url: string }>(`/editor/room/${encodeURIComponent(roomId ?? '')}/replay`),
    enabled: enabled && !!roomId,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

// ── WebSocket hook ────────────────────────────────────────────────────────
//
// useEditorWs: один WebSocket на комнату, переподключается по экспоненте.
// Anti-fallback: если соединение падает >5 раз подряд — фиксируем status =
// 'failed' и НЕ переключаемся в локальный режим; UI должен показать
// <EmptyState variant="error" /> с retry CTA, который дергает .reconnect().

export type EditorWsEnvelope = {
  kind: 'snapshot' | 'op' | 'cursor' | 'presence' | 'freeze' | string
  data?: unknown
}

export type EditorWsStatus = 'connecting' | 'open' | 'reconnecting' | 'failed' | 'closed'

export function useEditorWs(roomId: string | undefined, token: string | undefined) {
  const [status, setStatus] = useState<EditorWsStatus>('connecting')
  const [lastMessage, setLastMessage] = useState<EditorWsEnvelope | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const attemptsRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const closedByUser = useRef(false)
  const [reconnectKey, setReconnectKey] = useState(0)

  useEffect(() => {
    if (!roomId || !token) return
    closedByUser.current = false
    attemptsRef.current = 0

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const base = (import.meta.env.VITE_WS_BASE as string | undefined) || `${proto}//${window.location.host}/ws`
    const url = `${base.replace(/\/$/, '')}/editor/${encodeURIComponent(roomId)}?token=${encodeURIComponent(token)}`

    const connect = () => {
      setStatus(attemptsRef.current === 0 ? 'connecting' : 'reconnecting')
      const ws = new WebSocket(url)
      wsRef.current = ws
      ws.onopen = () => {
        attemptsRef.current = 0
        setStatus('open')
      }
      ws.onmessage = (ev) => {
        try {
          const env = JSON.parse(ev.data) as EditorWsEnvelope
          setLastMessage(env)
        } catch {
          // ignore malformed frames; backend always sends JSON envelopes.
        }
      }
      ws.onclose = () => {
        if (closedByUser.current) {
          setStatus('closed')
          return
        }
        attemptsRef.current += 1
        if (attemptsRef.current > 5) {
          setStatus('failed')
          return
        }
        const backoff = Math.min(10_000, 500 * 2 ** attemptsRef.current)
        timerRef.current = window.setTimeout(connect, backoff)
      }
      ws.onerror = () => {
        // Closure handler will trigger reconnect; nothing else to do.
      }
    }

    connect()

    return () => {
      closedByUser.current = true
      if (timerRef.current) window.clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [roomId, token, reconnectKey])

  const send = (env: EditorWsEnvelope) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify(env))
    return true
  }

  const reconnect = () => {
    attemptsRef.current = 0
    setReconnectKey((n) => n + 1)
  }

  return { status, lastMessage, send, reconnect }
}
