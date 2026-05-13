// Wraps backend `IntelligenceService.{CreateGoal,GetActiveGoal,UpdateGoal,
// DeactivateGoal}` через chi-direct REST (google.api.http transcoding).
//
// Wire shape совпадает с frontend localStorage UserGoal (lib/goal.ts):
// kind enum strings, ISO target_date, optional target_company/level/text.
// При backend ship: localStorage layer становится offline cache, не
// единственный источник истины.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError } from '../apiClient'

// Backend enum strings (proto3 JSON serialization).
export type PrimaryGoalKind =
  | 'GOAL_KIND_TOP_TIER_CO'
  | 'GOAL_KIND_ANY_SENIOR'
  | 'GOAL_KIND_ML_OFFER'
  | 'GOAL_KIND_ENGLISH_TARGET'
  | 'GOAL_KIND_CUSTOM'

export interface PrimaryGoal {
  id: string
  kind: PrimaryGoalKind
  target_company?: string
  target_level?: string
  target_text?: string
  target_date?: string // ISO yyyy-mm-dd
  active: boolean
  created_at?: string // RFC3339
  updated_at?: string // RFC3339
}

export interface CreatePrimaryGoalBody {
  kind: PrimaryGoalKind
  target_company?: string
  target_level?: string
  target_text?: string
  target_date?: string
}

export interface UpdatePrimaryGoalBody extends CreatePrimaryGoalBody {
  id: string
}

const primaryGoalKeys = {
  active: () => ['intelligence', 'goals', 'primary', 'active'] as const,
}

/**
 * GET /api/v1/intelligence/goals/primary/active.
 * Returns null когда юзер ещё не поставил goal (404 from backend).
 */
export function useActivePrimaryGoalQuery() {
  return useQuery({
    queryKey: primaryGoalKeys.active(),
    queryFn: async (): Promise<PrimaryGoal | null> => {
      try {
        return await api<PrimaryGoal>('/intelligence/goals/primary/active')
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null
        throw e
      }
    },
    staleTime: 60_000,
  })
}

/** POST /api/v1/intelligence/goals/primary — create new active goal. */
export function useCreatePrimaryGoalMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreatePrimaryGoalBody) =>
      api<PrimaryGoal>('/intelligence/goals/primary', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (goal) => {
      qc.setQueryData(primaryGoalKeys.active(), goal)
    },
  })
}

/** POST /api/v1/intelligence/goals/primary/update. */
export function useUpdatePrimaryGoalMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdatePrimaryGoalBody) =>
      api<PrimaryGoal>('/intelligence/goals/primary/update', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (goal) => {
      qc.setQueryData(primaryGoalKeys.active(), goal)
    },
  })
}

/** POST /api/v1/intelligence/goals/primary/deactivate. */
export function useDeactivatePrimaryGoalMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<Record<string, never>>('/intelligence/goals/primary/deactivate', {
        method: 'POST',
        body: JSON.stringify({ id }),
      }),
    onSuccess: () => {
      qc.setQueryData(primaryGoalKeys.active(), null)
    },
  })
}
