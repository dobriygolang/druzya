import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type SeasonCheckpoint = {
  tier: number
  reward: string
  reward_kind: string
  done: boolean
  current?: boolean
  big?: boolean
}

export type Season = {
  id: string
  title: string
  codename: string
  started_at: string
  ends_at: string
  current_tier: number
  current_sp: number
  tier_max: number
  checkpoints: SeasonCheckpoint[]
  modifiers: { key: string; title: string; description: string }[]
}

export function useSeasonQuery() {
  return useQuery({
    queryKey: ['season', 'current'],
    queryFn: () => api<Season>('/season/current'),
  })
}
