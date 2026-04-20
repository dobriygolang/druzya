import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type MockMessage = {
  id: string
  role: 'assistant' | 'user' | 'system'
  content: string
  created_at: string
}

export type MockSession = {
  id: string
  status: string
  company_id: string
  section: string
  difficulty: string
  duration_min: number
  task: {
    id: string
    slug: string
    title: string
    description: string
    difficulty: string
    section: string
    time_limit_sec: number
    memory_limit_mb: number
    starter_code: Record<string, string>
    example_cases: { input: string; output: string }[]
  }
  started_at: string
  last_messages: MockMessage[]
  stress_profile: {
    pauses_score: number
    backspace_score: number
    chaos_score: number
    paste_attempts: number
  }
}

export type MockReport = {
  session_id: string
  overall_score: number
  sections: Record<string, { score: number; comment: string }>
  strengths: string[]
  weaknesses: string[]
  recommendations: { title: string; action: { kind: string } }[]
  stress_analysis: string
  replay_url: string | null
}

export function useMockSessionQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['mock', 'session', id],
    queryFn: () => api<MockSession>(`/mock/session/${id}`),
    enabled: !!id,
  })
}

export function useMockReportQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['mock', 'session', id, 'report'],
    queryFn: () => api<MockReport>(`/mock/session/${id}/report`),
    enabled: !!id,
  })
}

export function useSendMockMessage(id: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (content: string) =>
      api<MockMessage>(`/mock/session/${id}/message`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mock', 'session', id] })
    },
  })
}
