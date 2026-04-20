import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type DailyTask = {
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

export type DailyKata = {
  date: string
  task: DailyTask
  is_cursed: boolean
  is_weekly_boss: boolean
  already_submitted: boolean
}

export type Streak = {
  current: number
  longest: number
  freeze_tokens: number
  history: (boolean | null)[]
}

export type Calendar = {
  id: string
  company_id: string
  role: string
  interview_date: string
  days_left: number
  readiness_pct: number
  today: {
    kind: string
    title: string
    estimated_min: number
    done: boolean
  }[]
  week_plan: unknown[]
  weak_zones: { atlas_node_key: string; priority: string }[]
}

export function useDailyKataQuery() {
  return useQuery({
    queryKey: ['daily', 'kata'],
    queryFn: () => api<DailyKata>('/daily/kata'),
  })
}

export function useStreakQuery() {
  return useQuery({
    queryKey: ['daily', 'streak'],
    queryFn: () => api<Streak>('/daily/streak'),
  })
}

export function useCalendarQuery() {
  return useQuery({
    queryKey: ['daily', 'calendar'],
    queryFn: () => api<Calendar>('/daily/calendar'),
  })
}
