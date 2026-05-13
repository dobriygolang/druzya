// Anticipates backend `IntelligenceService.{ListMemoryEntries,DeleteMemoryEntry}`
// (Agent I implementing in parallel). Wire shape matches expected proto:
//   - GET /api/v1/intelligence/memory/entries?kind=&since=&limit=&offset=
//   - POST /api/v1/intelligence/memory/entries/{id}/delete

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../apiClient'

export interface CoachMemoryEntry {
  id: string
  kind: string // e.g. 'goal_set' | 'mock_complete' | 'cue_session' | 'reflection_grade'
  content: string
  source?: string
  importance?: number // 1..10
  occurred_at: string // RFC3339
  expires_at?: string
  // edited_at — non-empty если юзер уточнял formulation. UI рисует
  // subtle «edited» метку.
  edited_at?: string
}

export interface ListMemoryEntriesResponse {
  items: CoachMemoryEntry[]
  total: number
}

const memoryKeys = {
  list: (kind: string | null, limit: number, offset: number) =>
    ['intelligence', 'memory', 'entries', { kind, limit, offset }] as const,
}

/** GET /api/v1/intelligence/memory/entries — paginated, filterable. */
export function useMemoryEntriesQuery(opts: {
  kind?: string | null
  limit?: number
  offset?: number
} = {}) {
  const limit = opts.limit ?? 30
  const offset = opts.offset ?? 0
  const kind = opts.kind ?? null
  return useQuery({
    queryKey: memoryKeys.list(kind, limit, offset),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (kind) params.set('kind', kind)
      if (limit > 0) params.set('limit', String(limit))
      if (offset > 0) params.set('offset', String(offset))
      const path = `/intelligence/memory/entries${params.toString() ? `?${params.toString()}` : ''}`
      return api<ListMemoryEntriesResponse>(path)
    },
    staleTime: 60_000,
  })
}

/** POST /api/v1/intelligence/memory/entries/{id}/delete — soft-delete. */
export function useDeleteMemoryEntryMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<Record<string, never>>(`/intelligence/memory/entries/${id}/delete`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['intelligence', 'memory', 'entries'] })
    },
  })
}

/** POST /api/v1/intelligence/memory/entries/{id}/edit — update summary. */
export function useEditMemoryEntryMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      api<CoachMemoryEntry>(`/intelligence/memory/entries/${id}/edit`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['intelligence', 'memory', 'entries'] })
    },
  })
}
