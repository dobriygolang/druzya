// Rating bounded-context client. Talks to /api/v1/rating/* (transcoded
// from the Connect RatingService). Phase 2 added the /rating page so
// useLeaderboardQuery now supports section + limit filters; useMyRatingsQuery
// still hits /rating/me but its staleTime is tuned (30s) to feel snappy
// after a match completes.

import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type SectionKey =
  | 'algorithms'
  | 'sql'
  | 'go'
  | 'system_design'
  | 'behavioral'

export type ModeKey = 'all' | 'solo_1v1' | 'ranked' | 'hardcore' | 'cursed'

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
  history?: { week_start: string; global_power_score: number }[]
}

export type LeaderboardEntry = {
  rank: number
  user_id: string
  username: string
  elo: number
  title: string | null
  cohort_emblem?: string | null
}

export type Leaderboard = {
  section: SectionKey
  updated_at: string
  my_rank: number
  entries: LeaderboardEntry[]
}

const SECTION_PROTO: Record<SectionKey, string> = {
  algorithms: 'SECTION_ALGORITHMS',
  sql: 'SECTION_SQL',
  go: 'SECTION_GO',
  system_design: 'SECTION_SYSTEM_DESIGN',
  behavioral: 'SECTION_BEHAVIORAL',
}

export type LeaderboardFilters = {
  section?: SectionKey
  mode?: ModeKey
  limit?: number
}

export function useRatingMeQuery() {
  return useQuery({
    queryKey: ['rating', 'me'],
    queryFn: () => api<RatingMe>('/rating/me'),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useMyRatingsQuery() {
  // Alias kept for the new /rating page so future UI doesn't carry the
  // legacy "Me" suffix.
  return useRatingMeQuery()
}

export function useLeaderboardQuery(arg: LeaderboardFilters | SectionKey = {}) {
  // Backward-compat: legacy callers pass a bare SectionKey string. Normalize.
  const filters: LeaderboardFilters =
    typeof arg === 'string' ? { section: arg } : arg
  const section = filters.section ?? 'algorithms'
  const limit = filters.limit ?? 100
  // Mode is NOT yet plumbed end-to-end on the backend (single "all" bucket)
  // — we pass it through queryKey so the cache fragments correctly when
  // the server starts honouring it.
  const mode = filters.mode ?? 'all'
  return useQuery({
    queryKey: ['rating', 'leaderboard', section, mode, limit],
    queryFn: () => {
      const params = new URLSearchParams({
        section: SECTION_PROTO[section],
        limit: String(limit),
      })
      return api<Leaderboard>(`/rating/leaderboard?${params.toString()}`)
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}
