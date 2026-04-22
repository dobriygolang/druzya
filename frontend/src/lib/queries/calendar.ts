import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type InterviewCalendar = {
  target_date: string
  countdown: string
  days_left: number
  company: string
  role: string
  sections: string
  readiness_pct: number
  today_tasks: { id: string; title: string; sub: string; status: 'done' | 'active' | 'future' }[]
  schedule_days: number
  strengths: { label: string; value: number }[]
  weaknesses: { label: string; value: number }[]
  ai_recommendation: string
}

export function useInterviewCalendarQuery() {
  return useQuery({
    queryKey: ['interview', 'calendar'],
    queryFn: () => api<InterviewCalendar>('/interview/calendar'),
  })
}
