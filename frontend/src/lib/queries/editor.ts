// Peer-collab WS was dropped together with Hone Editor.tsx; что осталось —
// plain REST persistence над services/editor (CreateRoom / GetRoom). Run
// code остаётся: backend Judge0 sandbox через POST /editor/room/:id/run.
//
// Snapshot save — отдельный hand-rolled endpoint, не proto-RPC, чтобы не
// плодить новый Connect method (см. whiteboard.ts комментарий).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, API_BASE, readAccessToken } from '../apiClient'

export type EditorLanguage =
  | 'language_unspecified'
  | 'language_go'
  | 'language_python'
  | 'language_javascript'
  | 'language_typescript'
  | 'language_sql'

export interface EditorRoom {
  id: string
  owner_id: string
  language: EditorLanguage
  type?: string
  ws_url?: string
  expires_at?: string
  is_frozen?: boolean
  participants?: { user_id: string; username: string; role: string }[]
}

interface EditorListResponse {
  items: EditorRoom[]
}

/** GET /editor/room/:id — meta + язык + участники. */
export function useEditorQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['editor', 'room', id],
    enabled: Boolean(id),
    queryFn: async () => {
      if (!id) throw new Error('id required')
      return api<EditorRoom>(`/editor/room/${encodeURIComponent(id)}`)
    },
  })
}

/** GET /editor/room — список комнат текущего юзера.
 *
 *  NB: backend services/editor сейчас не имеет ListMyRooms RPC (в отличие от
 *  whiteboard_rooms). Hook оставлен на будущее; пока возвращает пустой
 *  список через REST 404-fallback. */
export function useMyEditorRoomsQuery() {
  return useQuery({
    queryKey: ['editor', 'rooms', 'mine'],
    queryFn: async () => {
      try {
        return await api<EditorListResponse>('/editor/room')
      } catch {
        return { items: [] }
      }
    },
  })
}

/** POST /editor/room — создать новый. */
export function useCreateEditorMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { language?: EditorLanguage } = {}) => {
      return api<EditorRoom>('/editor/room', {
        method: 'POST',
        body: JSON.stringify({
          language: input.language ?? 'language_go',
          type: 'solo',
        }),
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['editor', 'rooms', 'mine'] })
    },
  })
}

/** PUT /editor/room/:id/snapshot — debounced solo save. Body — code string,
 *  не Yjs blob (Yjs CRDT удалён вместе с WS slice). */
export function useSaveEditorMutation(id: string | undefined) {
  return useMutation({
    mutationFn: async (code: string) => {
      if (!id) throw new Error('id required')
      const token = readAccessToken()
      const resp = await fetch(
        `${API_BASE}/editor/room/${encodeURIComponent(id)}/snapshot`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ code }),
        },
      )
      if (!resp.ok) {
        throw new Error(`save failed: HTTP ${resp.status}`)
      }
    },
  })
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  timeMs: number
  status: string
}

/** POST /editor/room/:id/run — Judge0-backed. */
export function useRunEditorMutation(id: string | undefined) {
  return useMutation({
    mutationFn: async (input: { code: string; language: EditorLanguage }): Promise<RunResult> => {
      if (!id) throw new Error('id required')
      const j = await api<{
        stdout?: string
        stderr?: string
        exitCode?: number
        exit_code?: number
        timeMs?: number
        time_ms?: number
        status?: string
      }>(`/editor/room/${encodeURIComponent(id)}/run`, {
        method: 'POST',
        body: JSON.stringify({
          code: input.code,
          language: input.language.toUpperCase(),
        }),
      })
      return {
        stdout: j.stdout ?? '',
        stderr: j.stderr ?? '',
        exitCode: j.exitCode ?? j.exit_code ?? 0,
        timeMs: j.timeMs ?? j.time_ms ?? 0,
        status: j.status ?? '',
      }
    },
  })
}

/** DELETE /editor/room/:id. */
export function useDeleteEditorMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      return api<void>(`/editor/room/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['editor', 'rooms', 'mine'] })
    },
  })
}
