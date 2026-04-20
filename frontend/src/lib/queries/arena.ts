import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type ArenaTask = {
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

export type Participant = {
  user_id: string
  username: string
  team: number
  elo_before: number
}

export type ArenaMatch = {
  id: string
  status: string
  mode: string
  section: string
  task: ArenaTask
  participants: Participant[]
  started_at: string
}

export function useArenaMatchQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['arena', 'match', id],
    queryFn: () => api<ArenaMatch>(`/arena/match/${id}`),
    enabled: !!id,
  })
}
