// Public platform metrics — used by the marketing welcome page.
//
// Backed by GET /api/v1/stats/public (no auth). The endpoint returns
// integer counts; we type the shape exhaustively here so call sites get
// completion + protection against drift.

import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type PublicStats = {
  users_count: number
  active_today: number
  matches_total: number
}

export function fetchPublicStats(): Promise<PublicStats> {
  return api<PublicStats>('/stats/public')
}

export function usePublicStats() {
  return useQuery<PublicStats>({
    queryKey: ['stats', 'public'],
    queryFn: fetchPublicStats,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
}
