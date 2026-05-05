// AI-tutor — react-query hooks. См docs/feature/ai-tutor.md.
//
// Backend RPCs живут в /api/v1/ai-tutor/*. Persona catalogue —
// public-route (whitelisted в restAuthGate); все остальные требуют
// bearer.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

// ── Wire types ──────────────────────────────────────────────────────

export type AITutorPersona = {
  id: string
  slug: string
  display_name: string
  scope_track_kind: string
  pace_per_week: number
  active: boolean
  ai_user_id: string
}

export type AITutorThread = {
  id: string
  student_id: string
  persona_id: string
  summary_md: string
  message_count: number
  daily_msg_count: number
  created_at?: string
  updated_at?: string
}

export type AITutorEpisodeRole =
  | 'user'
  | 'assistant'
  | 'system'
  | 'assignment'
  | 'snapshot_inject'

export type AITutorEpisode = {
  id: string
  thread_id: string
  role: AITutorEpisodeRole
  content: string
  model_used: string
  tokens_in: number
  tokens_out: number
  occurred_at?: string
}

// ── Public catalogue ────────────────────────────────────────────────

export function useAITutorPersonasQuery() {
  return useQuery({
    queryKey: ['ai-tutor', 'personas'] as const,
    queryFn: () => api<{ items: AITutorPersona[] }>('/ai-tutor/personas'),
    staleTime: 5 * 60_000,
  })
}

// ── Authenticated ───────────────────────────────────────────────────

export function useAdoptAITutorMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (personaSlug: string) =>
      api<{ persona: AITutorPersona; thread: AITutorThread }>(
        '/ai-tutor/adopt',
        { method: 'POST', body: JSON.stringify({ persona_slug: personaSlug }) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai-tutor', 'threads'] })
      void qc.invalidateQueries({ queryKey: ['tutor', 'my-tutors'] })
    },
  })
}

/** Default — first page (limit=200, no cursor). The wire endpoint
 *  supports keyset cursor; UI infinite-scroll deferred to a UX pass. */
export function useMyAITutorThreadsQuery(limit = 200) {
  return useQuery({
    queryKey: ['ai-tutor', 'threads', limit] as const,
    queryFn: () =>
      api<{ items: AITutorThread[]; next_cursor?: string }>(
        `/ai-tutor/threads?limit=${limit}`,
      ),
    staleTime: 30_000,
  })
}

/** Forward-cursor pagination через `limit`. По умолчанию 30 последних. */
export function useAITutorHistoryQuery(threadId: string | undefined, limit = 30) {
  return useQuery({
    queryKey: ['ai-tutor', 'history', threadId, limit] as const,
    queryFn: () =>
      api<{ thread: AITutorThread; episodes: AITutorEpisode[] }>(
        `/ai-tutor/threads/${encodeURIComponent(threadId!)}/history?limit=${limit}`,
      ),
    enabled: Boolean(threadId),
    staleTime: 10_000,
  })
}

export function useSendAITutorMessageMutation(threadId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { content: string; contextNote?: string }) =>
      api<{
        user_episode: AITutorEpisode
        assistant_episode: AITutorEpisode
        compacted: boolean
      }>(`/ai-tutor/threads/${encodeURIComponent(threadId!)}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: args.content,
          context_note: args.contextNote ?? '',
        }),
      }),
    onSuccess: () => {
      // History query пересжимаем — два новых episodes уже лежат в БД,
      // фронт получит их при refetch. summary_md тоже мог обновиться
      // (compacted=true).
      void qc.invalidateQueries({ queryKey: ['ai-tutor', 'history', threadId] })
      void qc.invalidateQueries({ queryKey: ['ai-tutor', 'threads'] })
    },
  })
}
