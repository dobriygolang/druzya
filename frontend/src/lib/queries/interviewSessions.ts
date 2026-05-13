// Wraps `IntelligenceService.{IngestInterviewSession,ListInterviewSessions}`
// через chi-direct REST.
//
// Wire shape совпадает с frontend localStorage CueSession (lib/cueSessions.ts)
// + дополнительные fields raw_transcript / ai_summary / completed_at.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../apiClient'

export interface InterviewStage {
  stage: string // 'hr' | 'algo' | 'sysdesign' | 'coding' | 'behavioral' | 'other'
  self_rating?: number // 1..5, 0 = unrated
  notes?: string
}

export interface InterviewSession {
  id: string
  company?: string
  persona?: string
  stages: InterviewStage[]
  ai_summary?: string
  raw_transcript?: string
  completed_at?: string // RFC3339
}

export interface IngestInterviewSessionBody {
  company?: string
  persona?: string
  stages: InterviewStage[]
  ai_summary?: string
  raw_transcript?: string
  completed_at?: string // RFC3339; empty → server time
}

export interface ListInterviewSessionsResponse {
  items: InterviewSession[]
  total: number
}

const interviewSessionKeys = {
  list: (limit: number, offset: number) =>
    ['intelligence', 'interview-sessions', { limit, offset }] as const,
}

/** GET /api/v1/intelligence/interview-sessions — paginated list. */
export function useInterviewSessionsQuery(opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 20
  const offset = opts.offset ?? 0
  return useQuery({
    queryKey: interviewSessionKeys.list(limit, offset),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (limit > 0) params.set('limit', String(limit))
      if (offset > 0) params.set('offset', String(offset))
      const path = `/intelligence/interview-sessions${params.toString() ? `?${params.toString()}` : ''}`
      return api<ListInterviewSessionsResponse>(path)
    },
    staleTime: 30_000,
  })
}

/** POST /api/v1/intelligence/interview-sessions/ingest. */
export function useIngestInterviewSessionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: IngestInterviewSessionBody) =>
      api<InterviewSession>('/intelligence/interview-sessions/ingest', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      // Invalidate list queries so юзер видит свежую запись.
      void qc.invalidateQueries({ queryKey: ['intelligence', 'interview-sessions'] })
    },
  })
}
