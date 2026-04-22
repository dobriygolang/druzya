import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type WeeklyReport = {
  period: string
  actions_count: number
  stats: {
    xp: { value: string; delta: string }
    matches: { value: string; wins: number; losses: number; delta: string }
    streak: { value: string; best: number }
    avg_lp: { value: string; total: string }
  }
  strong_sections: { id: string; name: string; sub: string; xp: string }[]
  weak_sections: { id: string; name: string; sub: string; xp: string; tone: string }[]
  stress_pattern: string
  actions: { p: string; text: string; sub: string }[]
  podcast: { title: string; duration: string; sub: string }
  compare_weeks: { label: string; xp: number; w: string }[]
}

export function useWeeklyReportQuery() {
  return useQuery({
    queryKey: ['report', 'weekly'],
    queryFn: () => api<WeeklyReport>('/report/weekly'),
  })
}
