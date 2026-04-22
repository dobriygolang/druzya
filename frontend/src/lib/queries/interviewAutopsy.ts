import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type AutopsyEvent = {
  time: string
  label: string
  status: string
  color: string
}

export type AutopsyFailure = {
  tag: string
  title: string
  sub: string
  level: string
}

export type InterviewAutopsyResponse = {
  id: string
  title: string
  role: string
  date: string
  duration_min: number
  verdict: string
  verdict_sub: string
  timeline: AutopsyEvent[]
  failures: AutopsyFailure[]
  ai_verdict: string
  action_plan: { p: string; text: string }[]
  next_attempt_weeks: string
}

export function useInterviewAutopsyQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['interview', id, 'autopsy'],
    queryFn: () => api<InterviewAutopsyResponse>(`/interview/${id}/autopsy`),
    enabled: !!id,
  })
}
