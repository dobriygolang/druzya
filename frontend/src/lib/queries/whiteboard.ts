// Peer-collab WS was dropped together with Hone SharedBoards.tsx; what
// remains is plain REST persistence over the existing whiteboard_rooms
// service. The room id is the document id, the title is the document
// title, и snapshot blob грузим/сохраняем как base64-обёрнутый JSON
// через сами Connect-RPC endpoint'ы (CreateRoom / GetRoom / ListMyRooms).
//
// Snapshot persistence: на бэке snapshot хранится BYTEA в whiteboard_rooms
// table + UpdateSnapshot RPC. Этот файл не выставляет save-mutation —
// сам сохранением кодирует WhiteboardPage через `/whiteboard/room/:id/save`
// REST endpoint (см. ниже useSaveWhiteboardMutation). Endpoint ходит мимо
// Connect proto чтобы не плодить новый RPC: blob, payload — base64 в JSON.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, API_BASE, readAccessToken } from '../apiClient'

export interface WhiteboardParticipant {
  user_id: string
  username: string
  joined_at: string
}

export interface WhiteboardRoom {
  id: string
  owner_id: string
  title: string
  ws_url?: string
  expires_at?: string
  created_at?: string
  participants?: WhiteboardParticipant[]
}

interface WhiteboardListResponse {
  items: WhiteboardRoom[]
}

/** GET /whiteboard/room/:id — meta + участники. */
export function useWhiteboardQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['whiteboard', 'room', id],
    enabled: Boolean(id),
    queryFn: async () => {
      if (!id) throw new Error('id required')
      return api<WhiteboardRoom>(`/whiteboard/room/${encodeURIComponent(id)}`)
    },
  })
}

/** GET /whiteboard/room — список комнат текущего юзера. */
export function useMyWhiteboardsQuery() {
  return useQuery({
    queryKey: ['whiteboard', 'rooms', 'mine'],
    queryFn: async () => api<WhiteboardListResponse>('/whiteboard/room'),
  })
}

/** POST /whiteboard/room — создать новый. Возвращает room с id, по которому
 *  редиректим на `/whiteboard/:id`. */
export function useCreateWhiteboardMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { title?: string } = {}) => {
      return api<WhiteboardRoom>('/whiteboard/room', {
        method: 'POST',
        body: JSON.stringify({ title: input.title ?? 'Untitled board' }),
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['whiteboard', 'rooms', 'mine'] })
    },
  })
}

/**
 * Save (debounced) snapshot blob. Solo-mode только: blob — raw Excalidraw
 * scene bytes (Uint8Array, base64'ed на wire). Endpoint:
 *   PUT /api/v1/whiteboard/room/:id/snapshot  body: {snapshot_b64}
 * Backend hand-rolled handler (см. cmd/monolith/services/whiteboard_rooms),
 * не Connect-RPC — снэпшот сохранение слишком ad-hoc для proto-фриза.
 */
export function useSaveWhiteboardMutation(id: string | undefined) {
  return useMutation({
    mutationFn: async (snapshot: Uint8Array) => {
      if (!id) throw new Error('id required')
      const token = readAccessToken()
      const resp = await fetch(
        `${API_BASE}/whiteboard/room/${encodeURIComponent(id)}/snapshot`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ snapshot_b64: bytesToB64(snapshot) }),
        },
      )
      if (!resp.ok) {
        throw new Error(`save failed: HTTP ${resp.status}`)
      }
    },
  })
}

/** DELETE /whiteboard/room/:id. */
export function useDeleteWhiteboardMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      return api<void>(`/whiteboard/room/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['whiteboard', 'rooms', 'mine'] })
    },
  })
}

function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] as number)
  return btoa(s)
}
