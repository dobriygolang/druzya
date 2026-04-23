import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

// ── editor mutations ──────────────────────────────────────────────────────
//
// `useDailyRunMutation` hits the backend chi-handler at /api/v1/daily/run —
// dry-grade execution that returns example-case feedback without touching the
// streak. `useDailySubmitMutation` posts to the proto-declared
// /api/v1/daily/kata/submit which persists, mutates streak and emits the
// DailyKataCompleted event. Both invalidate the kata + streak queries on
// success so the UI refreshes the "already submitted" / streak counters.

export type DailyRunRequest = {
  kata_id: string
  code: string
  language: string
}

export type DailyRunResponse = {
  passed: boolean
  total: number
  output: string
  time_ms: number
}

export type DailySubmitResponse = {
  passed: boolean
  tests_passed: number
  tests_total: number
  xp_earned: number
  streak: Streak
}

export function useDailyRunMutation() {
  return useMutation({
    mutationFn: (input: DailyRunRequest) =>
      api<DailyRunResponse>('/daily/run', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  })
}

export function useDailySubmitMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: DailyRunRequest) =>
      api<DailySubmitResponse>('/daily/kata/submit', {
        method: 'POST',
        body: JSON.stringify({ code: input.code, language: input.language }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['daily', 'kata'] })
      void qc.invalidateQueries({ queryKey: ['daily', 'streak'] })
    },
  })
}
