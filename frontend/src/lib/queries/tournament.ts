import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type BracketMatch = {
  p1: string
  p2: string
  s1?: number
  s2?: number
  live?: boolean
  yours?: boolean
  tbd?: boolean
}

export type TournamentResponse = {
  id: string
  name: string
  tier: string
  format: string
  prize_pool: number
  finals_in: string
  registered: boolean
  participants: number
  total_matches: number
  bracket: { r16: BracketMatch[]; qf: BracketMatch[]; sf: BracketMatch[] }
  next_match: { opponent: string; in: string }
  predictions: { label: string; odds: string[]; yours?: boolean }[]
  standings: { rank: number; name: string; score: string; you?: boolean }[]
}

export function useTournamentQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['tournament', id],
    queryFn: () => api<TournamentResponse>(`/tournament/${id}`),
    enabled: !!id,
  })
}
