import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

// STUB: switch to Connect-ES client in follow-up.
// Generated stubs live in src/api/generated/pb/druz9/v1/rating_connect.ts.
// See docs/contract-first-with-buf.md for the migration plan — the backend
// keeps serving /api/v1/rating/* via vanguard transcoding until this file
// is rewritten to use `createPromiseClient(RatingService, transport)`.

export type SectionKey =
  | 'algorithms'
  | 'sql'
  | 'go'
  | 'system_design'
  | 'behavioral'

export type SectionRating = {
  section: SectionKey
  elo: number
  matches_count: number
  percentile: number
  decaying: boolean
}

export type RatingMe = {
  ratings: SectionRating[]
  global_power_score: number
  history: { week_start: string; global_power_score: number }[]
}

export type LeaderboardEntry = {
  rank: number
  user_id: string
  username: string
  elo: number
  title: string | null
  guild_emblem: string | null
}

export type Leaderboard = {
  section: SectionKey
  updated_at: string
  my_rank: number
  entries: LeaderboardEntry[]
}

export function useRatingMeQuery() {
  return useQuery({
    queryKey: ['rating', 'me'],
    queryFn: () => api<RatingMe>('/rating/me'),
  })
}

export function useLeaderboardQuery(section: SectionKey = 'algorithms') {
  return useQuery({
    queryKey: ['rating', 'leaderboard', section],
    queryFn: () =>
      api<Leaderboard>(`/rating/leaderboard?section=${section}`),
  })
}
