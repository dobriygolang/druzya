import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

// StreakMonth is one of the twelve cells of the year-grid on /daily/streak.
// `done`/`missed`/`freeze` sum to the number of days with rows in
// daily_kata_history for that month; `total` is days in the calendar month
// (28..31), so the UI can render "done / total" fractions and leave the
// remaining cells as "future".
export type StreakMonth = {
  name: string
  done: number
  missed: number
  freeze: number
  total: number
}

// StreakResponse mirrors backend/services/daily/ports/streak_calendar_handler.go.
export type StreakResponse = {
  current: number
  best: number
  freeze_tokens: number
  freeze_max: number
  total_done: number
  total_missed: number
  total_freeze: number
  remaining: number
  year: number
  months: StreakMonth[]
}

// 5min cache — the year-grid is slow-moving (one mutation per day) and
// the backend invalidates on every SubmitKata. Keep in sync with
// DefaultKataYearTTL in daily/infra/cache.go.
const FIVE_MIN = 5 * 60 * 1000

export function useKataStreakQuery(year?: number) {
  const y = year ?? new Date().getUTCFullYear()
  return useQuery({
    queryKey: ['kata', 'streak', y],
    queryFn: () => api<StreakResponse>(`/kata/streak?year=${y}`),
    staleTime: FIVE_MIN,
  })
}
