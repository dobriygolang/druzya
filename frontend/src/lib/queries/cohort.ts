// Cohort bounded-context client.
//
// REST endpoints (see backend/cmd/monolith/services/cohort.go):
//   GET  /cohort/list                  public discovery
//   POST /cohort                       create (auth)
//   GET  /cohort/{slug}                detail with members
//   POST /cohort/{id}/join             (auth)
//   POST /cohort/{id}/leave            (auth)
//   GET  /cohort/{id}/leaderboard      public
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../apiClient'

export type CohortStatus = 'active' | 'graduated' | 'cancelled' | string

export type Cohort = {
  id: string
  slug: string
  name: string
  owner_id: string
  starts_at: string
  ends_at: string
  status: CohortStatus
  visibility: 'public' | 'invite' | string
  created_at: string
  members_count: number
  // is_member is hydrated server-side when the caller is authed
  // (cmd/monolith/services/cohort.go handleList). Anonymous reads always
  // see false.
  is_member?: boolean
  // capacity surfaces the soft cap (currently MaxMembersPhase1 = 50) so
  // the catalogue UI doesn't hard-code it client-side.
  capacity?: number
}

export type CohortMember = {
  user_id: string
  role: 'member' | 'coach' | 'owner' | string
  joined_at: string
  // display_name + avatar_seed are hydrated by the MSW mock today; the
  // real backend handler currently only returns user_id (TODO M5d when
  // we migrate to ConnectRPC + denormalize username).
  display_name?: string
  avatar_seed?: string
}

export type CohortDetail = {
  cohort: Cohort
  members: CohortMember[]
}

export type CohortListResponse = {
  items: Cohort[]
  total: number
  page: number
  page_size: number
}

export type CohortListFilters = {
  status?: string
  search?: string
  page?: number
}

export function useCohortListQuery(filters: CohortListFilters = {}) {
  const qs = new URLSearchParams()
  if (filters.status) qs.set('status', filters.status)
  if (filters.search) qs.set('search', filters.search)
  if (filters.page && filters.page > 1) qs.set('page', String(filters.page))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return useQuery({
    queryKey: ['cohort', 'list', filters],
    queryFn: () => api<CohortListResponse>(`/cohort/list${suffix}`),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  })
}

// useCohortQuery — detail by slug. 404 is surfaced as null so the page can
// render a dedicated not-found state (anti-fallback: never invent a cohort).
export function useCohortQuery(slug: string | undefined) {
  return useQuery({
    queryKey: ['cohort', 'by-slug', slug],
    queryFn: async () => {
      try {
        return await api<CohortDetail>(`/cohort/${encodeURIComponent(slug ?? '')}`)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
    enabled: !!slug,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export type CohortLeaderboardRow = {
  user_id: string
  display_name: string
  overall_elo: number
  weekly_xp: number
}

export function useCohortLeaderboardQuery(cohortID: string | undefined) {
  return useQuery({
    queryKey: ['cohort', 'leaderboard', cohortID],
    queryFn: () =>
      api<{ items: CohortLeaderboardRow[] }>(
        `/cohort/${encodeURIComponent(cohortID ?? '')}/leaderboard`,
      ),
    enabled: !!cohortID,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

export type CohortJoinResponse = { status: string; cohort_id: string }
export type CohortLeaveResponse = { status: 'left' | 'disbanded' | string; cohort_id: string }

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

export function useLeaveCohortMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cohortID: string) =>
      api<CohortLeaveResponse>(`/cohort/${encodeURIComponent(cohortID)}/leave`, {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cohort'] })
    },
  })
}

export type CreateCohortPayload = {
  name: string
  slug?: string
  starts_at?: string
  ends_at?: string
  visibility?: 'public' | 'invite'
}

export function useCreateCohortMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateCohortPayload) =>
      api<{ id: string }>('/cohort', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cohort', 'list'] })
    },
  })
}
