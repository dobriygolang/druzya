// Cohort bounded-context client.
//
// REST endpoints (see backend/cmd/monolith/services/cohort.go):
//   GET  /cohort/list                  public discovery
//   POST /cohort                       create (auth)
//   GET  /cohort/{slug}                detail with members
//   POST /cohort/{id}/join             (auth)
//   POST /cohort/{id}/leave            (auth)
//   GET  /cohort/{id}/leaderboard      public
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
  // username/display_name/avatar_url denormalised server-side via JOIN
  // with users (cmd/monolith/services/cohort.go::handleGetBySlug). All
  // optional — empty when the joined row is missing or the legacy
  // backend hasn't shipped the JOIN yet.
  username?: string
  display_name?: string
  avatar_url?: string
  /** Legacy MSW-only field kept for backward render compat. */
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

// useCohortListInfiniteQuery — paginated catalogue read for the «load more»
// button. Each fetch returns a CohortListResponse; getNextPageParam advances
// while pages keep returning a full page_size. `filters` excludes `page`
// — that's managed by react-query.
export function useCohortListInfiniteQuery(filters: Omit<CohortListFilters, 'page'> = {}) {
  return useInfiniteQuery({
    queryKey: ['cohort', 'list', 'infinite', filters],
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams()
      if (filters.status) qs.set('status', filters.status)
      if (filters.search) qs.set('search', filters.search)
      if (pageParam > 1) qs.set('page', String(pageParam))
      const suffix = qs.toString() ? `?${qs.toString()}` : ''
      return api<CohortListResponse>(`/cohort/list${suffix}`)
    },
    initialPageParam: 1,
    getNextPageParam: (last) => {
      if (last.items.length < last.page_size) return undefined
      return last.page + 1
    },
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

// ── M5c — owner-only moderation ───────────────────────────────────────────

export type UpdateCohortPayload = {
  cohortID: string
  name?: string
  ends_at?: string
  visibility?: 'public' | 'invite'
}

export function useUpdateCohortMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ cohortID, ...patch }: UpdateCohortPayload) =>
      api<Cohort>(`/cohort/${encodeURIComponent(cohortID)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cohort'] })
    },
  })
}

// useGraduateCohortMutation — owner action that flips status active →
// graduated AND emits CohortGraduated event server-side; achievements
// service awards each member a "cohort_graduated" badge.
export function useGraduateCohortMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cohortID: string) =>
      api<Cohort>(`/cohort/${encodeURIComponent(cohortID)}/graduate`, {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cohort'] })
    },
  })
}

export function useDisbandCohortMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cohortID: string) =>
      api<{ status: string }>(`/cohort/${encodeURIComponent(cohortID)}/disband`, {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cohort'] })
    },
  })
}

export type SetMemberRolePayload = {
  cohortID: string
  userID: string
  role: 'member' | 'coach'
}

export type IssueInvitePayload = {
  cohortID: string
  max_uses: number
  ttl_seconds: number
}

export type IssueInviteResponse = {
  token: string
  url: string
  expires_at?: string
}

export function useIssueInviteMutation() {
  return useMutation({
    mutationFn: ({ cohortID, ...body }: IssueInvitePayload) =>
      api<IssueInviteResponse>(`/cohort/${encodeURIComponent(cohortID)}/invite`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  })
}

export type JoinByTokenResponse = {
  status: string
  cohort_id: string
  slug?: string
}

export function useJoinByTokenMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (token: string) =>
      api<JoinByTokenResponse>('/cohort/join/by-token', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cohort'] })
    },
  })
}

export function useSetMemberRoleMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ cohortID, userID, role }: SetMemberRolePayload) =>
      api<{ status: string }>(
        `/cohort/${encodeURIComponent(cohortID)}/members/${encodeURIComponent(userID)}/role`,
        { method: 'POST', body: JSON.stringify({ role }) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cohort'] })
    },
  })
}
