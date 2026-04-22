import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type StreakMonth = { name: string; done: number; total: number }
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
  today: { title: string; difficulty: string; section: string; complexity: string; time_left: string; day: number }
}

export function useKataStreakQuery() {
  return useQuery({
    queryKey: ['kata', 'streak'],
    queryFn: () => api<StreakResponse>('/kata/streak'),
  })
}
