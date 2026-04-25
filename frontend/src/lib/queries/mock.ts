import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

// MockMessage mirrors druz9.v1.MockMessage. We keep the shape lower-snake
// to match the OpenAPI/Connect REST translation (the codec lower-snakes
// proto fields by default).
export type MockMessage = {
  id: string
  role: 'assistant' | 'user' | 'system'
  content: string
  created_at: string
  tokens_used?: number
}

export type MockTask = {
  id: string
  slug: string
  title: string
  description: string
  difficulty: string
  section: string
  time_limit_sec?: number
  memory_limit_mb?: number
  starter_code?: Record<string, string>
  example_cases?: { input: string; output: string }[]
}

export type MockStressProfile = {
  pauses_score: number
  backspace_score: number
  chaos_score: number
  paste_attempts: number
}

export type MockSession = {
  id: string
  status: string
  company_id: string
  section: string
  difficulty: string
  duration_min: number
  task: MockTask
  started_at: string
  finished_at?: string
  last_messages: MockMessage[]
  stress_profile: MockStressProfile
}

export type MockReportSection = { score: number; comment: string }

export type MockReport = {
  session_id: string
  status?: string // "ready" | "processing"
  overall_score: number
  sections: Record<string, MockReportSection>
  strengths: string[]
  weaknesses: string[]
  recommendations: { title: string; description?: string; action: { kind: string; params?: Record<string, string> } }[]
  stress_analysis: string
}

export type CreateMockInput = {
  company_id: string
  section?: string // "SECTION_ALGORITHMS" | … (proto enum string form)
  difficulty?: string
  duration_min?: number
  voice_mode?: boolean
  devils_advocate?: boolean
  llm_model?: string
}

export type StressEventInput = {
  type: string // "pause" | "backspace_burst" | …
  at_ms: number
  duration_ms?: number
  metadata?: Record<string, string>
}

// queryKeys are exported so callers can cross-invalidate (e.g. profile
// cache should drop when a session finishes — see profile/queries).
export const mockQueryKeys = {
  all: ['mock'] as const,
  session: (id: string | undefined) => ['mock', 'session', id] as const,
  report: (id: string | undefined) => ['mock', 'session', id, 'report'] as const,
  replay: (id: string | undefined) => ['mock', 'session', id, 'replay'] as const,
}

// useMockSessionQuery fetches the live session row. staleTime is 30s — we
// expect WS updates to push fresh data more quickly than that, but the
// query gives the UI a stable boot.
export function useMockSessionQuery(id: string | undefined) {
  return useQuery({
    queryKey: mockQueryKeys.session(id),
    queryFn: () => api<MockSession>(`/mock/session/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  })
}

// useMockReportQuery polls for a report; once it returns status="ready" we
// cache it for 5 minutes since the worker only re-runs on explicit retry.
export function useMockReportQuery(id: string | undefined) {
  return useQuery({
    queryKey: mockQueryKeys.report(id),
    queryFn: () => api<MockReport>(`/mock/session/${id}/report`),
    enabled: !!id,
    staleTime: 5 * 60_000,
    refetchInterval: (q) => {
      const data = q.state.data as MockReport | undefined
      return data?.status === 'ready' ? false : 4_000
    },
  })
}

// useMockReplayQuery fetches the immutable replay artefact. staleTime
// Infinity because once a replay exists it never mutates; only a worker
// regeneration would change it, and that flushes the report cache too.
export function useMockReplayQuery(id: string | undefined) {
  return useQuery({
    queryKey: mockQueryKeys.replay(id),
    queryFn: () => api<MockReport>(`/mock/session/${id}/report`),
    enabled: !!id,
    staleTime: Infinity,
  })
}

// useCreateMockSessionMutation creates a session and returns the hydrated
// row. Caller redirects to /mock/:id with the returned id.
export function useCreateMockSessionMutation() {
  return useMutation({
    mutationFn: (input: CreateMockInput) =>
      api<MockSession>('/mock/session', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  })
}

// useSendMockMessage posts a user message + invalidates the session cache so
// the next read picks up the appended assistant reply. WS streaming bypasses
// this path; this mutation is for the fallback REST flow.
export function useSendMockMessage(id: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { content?: string; voice_transcript?: string; code_snapshot?: string }) =>
      api<MockMessage>(`/mock/session/${id}/message`, {
        method: 'POST',
        body: JSON.stringify({ session_id: id, ...payload }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mockQueryKeys.session(id) })
    },
  })
}

// useFinishMockSessionMutation finishes the session, invalidates the
// session cache, and pre-warms the report query so MockResultPage starts
// polling immediately.
export function useFinishMockSessionMutation(id: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api<MockSession>(`/mock/session/${id}/finish`, {
        method: 'POST',
        body: JSON.stringify({ session_id: id }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mockQueryKeys.session(id) })
      qc.invalidateQueries({ queryKey: mockQueryKeys.report(id) })
    },
  })
}

// useIngestStressMutation pushes a batch of editor events to the stress
// pipeline. Fire-and-forget — we don't expect the response body, errors
// surface via the mutation's status flag.
export function useIngestStressMutation(id: string | undefined) {
  return useMutation({
    mutationFn: (events: StressEventInput[]) =>
      api(`/mock/session/${id}/stress`, {
        method: 'POST',
        body: JSON.stringify({ session_id: id, events }),
      }),
  })
}
