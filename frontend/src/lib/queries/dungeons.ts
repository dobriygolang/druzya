import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type DungeonCompany = {
  id: string
  name: string
  initial: string
  color: string
  tasks: number
  sections: number
  hours: number
  progress: number
  tags: string[]
  locked: boolean
  tier: 'normal' | 'hard' | 'boss'
  active?: boolean
  level_req?: number
  your_level?: number
}

export type DungeonsResponse = {
  total: number
  total_tasks: number
  done: number
  tabs: string[]
  companies: DungeonCompany[]
}

export function useDungeonsQuery() {
  return useQuery({
    queryKey: ['dungeons'],
    queryFn: () => api<DungeonsResponse>('/dungeons'),
  })
}
