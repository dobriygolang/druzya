import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type Achievement = {
  id: string
  name: string
  progress: string
  rarity: 'common' | 'rare' | 'legendary'
  unlocked: boolean
  locked: boolean
  description?: string
  reward?: string
}

export type AchievementsResponse = {
  total: number
  unlocked: number
  rare_count: number
  counts: { common: number; rare: number; legendary: number; hidden: number }
  featured_id: string
  items: Achievement[]
}

export function useAchievementsQuery() {
  return useQuery({
    queryKey: ['achievements'],
    queryFn: () => api<AchievementsResponse>('/achievements'),
  })
}
