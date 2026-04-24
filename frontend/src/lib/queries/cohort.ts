// Cohort bounded-context client. Talks to /api/v1/cohort/* (transcoded from
// the Connect CohortService) plus the bare /api/v1/cohorts/top REST endpoint
// (added in Phase 4-B as a Connect-RPC migration is pending).
//
// Phase 4-B introduces:
//   - useTopCohortsQuery     — global cohort leaderboard (used when the user
//                              has no cohort yet)
//   - explicit cohort lookup — useCohortQuery(cohortId) for /cohort/:cohortId
//   - widened types          — TopCohortSummary mirrors the planned Connect
//                              shape so a future migration is mechanical.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type CohortMember = {
  user_id: string
  username: string
  role: string
  joined_at: string
  assigned_section: string
}

export type Cohort = {
  id: string
  name: string
  emblem: string
  cohort_elo: number
  members: CohortMember[]
  current_war_id: string | null
}

export type WarLine = {
  section: string
  score_a: number
  score_b: number
  contributors: unknown[]
}

export type CohortWar = {
  id: string
  week_start: string
  week_end: string
  cohort_a: { id: string; name: string; emblem: string }
  cohort_b: { id: string; name: string; emblem: string }
  lines: WarLine[]
  winner_cohort_id: string | null
}

// TopCohortSummary mirrors the JSON wire shape served by GET /api/v1/cohorts/top.
// Fields line up with the planned proto contract (members_count, elo_total,
// wars_won, rank) so a Connect-RPC migration will be a drop-in replacement.
export type TopCohortSummary = {
  cohort_id: string
  name: string
  emblem: string
  members_count: number
  elo_total: number
  wars_won: number
  rank: number
}

export type TopCohortsResponse = {
  items: TopCohortSummary[]
}

// useMyCohortQuery — current user's cohort detail.
//
// Backend (Wave-13 sanctum-bug fix): GetMyCohort now returns an empty
// Cohort envelope (id === "") when the user has no membership instead of
// throwing 404 — eliminates the noisy console error on /sanctum for new
// users. Legacy 404 path kept for older deployments.
export function useMyCohortQuery() {
  return useQuery({
    queryKey: ['cohort', 'my'],
    queryFn: async () => {
      try {
        const g = await api<Cohort>('/cohort/my')
        // Empty Cohort envelope ⇒ user has no cohort yet. Treat as null so
        // existing callsites' `if (!cohort)` empty-state path triggers.
        if (!g || !g.id) return null
        return g
      } catch (err) {
        // Backwards compat: legacy backends still throw 404 for "no cohort".
        if (err instanceof Error && /\b404\b/.test(err.message)) {
          return null
        }
        throw err
      }
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

// useCohortQuery — public cohort detail by id, consumed by /cohort/:cohortId.
// Disabled when cohortId is undefined so callers can drive it conditionally.
export function useCohortQuery(cohortId: string | undefined) {
  return useQuery({
    queryKey: ['cohort', 'by-id', cohortId],
    queryFn: () => api<Cohort>(`/cohort/${cohortId}`),
    enabled: !!cohortId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

// useCohortWarQuery — current war for a given cohort.
export function useCohortWarQuery(cohortId: string | undefined) {
  return useQuery({
    queryKey: ['cohort', cohortId, 'war'],
    queryFn: () => api<CohortWar>(`/cohort/${cohortId}/war`),
    enabled: !!cohortId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

// useTopCohortsQuery — global cohort leaderboard. The backend caches at 5
// minutes; we mirror that with staleTime=5min so React Query doesn't
// hammer the API beyond what's useful.
export function useTopCohortsQuery(limit: number = 20) {
  return useQuery({
    queryKey: ['cohort', 'top', limit],
    queryFn: () =>
      api<TopCohortsResponse>(`/cohorts/top?limit=${encodeURIComponent(limit)}`),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

// ── discovery (Wave 3) ────────────────────────────────────────────────────
//
// Lives behind /api/v1/cohort/list, /api/v1/cohort (POST), /join, /leave —
// chi REST handlers added in services/cohort/ports/discovery_handler.go.

export type PublicCohort = {
  id: string
  name: string
  emblem: string
  description: string
  tier: string
  cohort_elo: number
  members_count: number
  max_members: number
  join_policy: 'open' | 'invite' | 'closed' | string
  is_public: boolean
  wars_won: number
}

export type CohortListResponse = {
  items: PublicCohort[]
  total: number
  page: number
  page_size: number
}

export type CohortListFilters = {
  search?: string
  tier?: string
  page?: number
}

export function useCohortListQuery(filters: CohortListFilters) {
  const qs = new URLSearchParams()
  if (filters.search) qs.set('search', filters.search)
  if (filters.tier) qs.set('tier', filters.tier)
  if (filters.page && filters.page > 1) qs.set('page', String(filters.page))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return useQuery({
    queryKey: ['cohort', 'list', filters],
    queryFn: () => api<CohortListResponse>(`/cohort/list${suffix}`),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  })
}

export type CohortJoinResponse = {
  status: 'joined' | 'pending' | string
  cohort_id: string
  pending?: boolean
}

export function useJoinCohortMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cohortID: string) =>
      api<CohortJoinResponse>(`/cohort/${encodeURIComponent(cohortID)}/join`, {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cohort'] })
    },
  })
}

export type CohortLeaveResponse = {
  status: 'left' | 'disbanded' | 'transferred' | string
  cohort_id: string
  // Set when status === 'transferred' — the auto-promoted heir.
  new_captain_id?: string
}

export function useLeaveCohortMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cohortID: string) =>
      api<CohortLeaveResponse>(
        `/cohort/${encodeURIComponent(cohortID)}/leave`,
        { method: 'POST', body: '{}' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cohort'] })
    },
  })
}

export type CreateCohortInput = {
  name: string
  description?: string
  tier?: string
  max_members?: number
  join_policy?: 'open' | 'invite' | 'closed'
}

export type CreateCohortResponse = {
  cohort: PublicCohort
}

export function useCreateCohortMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateCohortInput) =>
      api<CreateCohortResponse>('/cohort', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cohort'] })
    },
  })
}
