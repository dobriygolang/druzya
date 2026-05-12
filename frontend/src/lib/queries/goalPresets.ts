// queries/goalPresets.ts — Admin Phase 2: goal preset CRUD + public read.
//
// Two surfaces share the same DTO:
//   - /api/v1/admin/goal-presets — admin CMS (list/create/update/deactivate).
//   - /api/v1/goal-presets       — PUBLIC active-only read для GoalWizard
//                                   quick-start pills.
//
// Anti-fallback: useActiveGoalPresetsQuery silently returns [] на ошибке
// чтобы GoalWizard просто скрыл «Quick start» секцию без user-facing
// breakage. Admin queries наоборот пропускают ошибки наверх (UI показывает
// ErrorBox).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../apiClient'

export type GoalPresetKind =
  | 'GOAL_KIND_TOP_TIER_CO'
  | 'GOAL_KIND_ANY_SENIOR'
  | 'GOAL_KIND_ML_OFFER'
  | 'GOAL_KIND_ENGLISH_TARGET'
  | 'GOAL_KIND_CUSTOM'

export interface GoalPreset {
  id: string
  slug: string
  title: string
  kind: GoalPresetKind
  target_company: string
  target_level: string
  target_text: string
  default_target_days?: number | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface CreateGoalPresetBody {
  slug: string
  title: string
  kind: GoalPresetKind
  target_company?: string
  target_level?: string
  target_text?: string
  default_target_days?: number | null
  is_active?: boolean
  sort_order?: number
}

export interface UpdateGoalPresetBody {
  title?: string
  kind?: GoalPresetKind
  target_company?: string
  target_level?: string
  target_text?: string
  default_target_days?: number | null // -1 → clears NULL backend-side
  is_active?: boolean
  sort_order?: number
}

type ListResp = { items: GoalPreset[] }

const KEY_ADMIN = ['goal-presets', 'admin'] as const
const KEY_PUBLIC = ['goal-presets', 'public'] as const

// ── Public (used by GoalWizard) ──────────────────────────────────────────

/**
 * GET /api/v1/goal-presets — active-only public read.
 * Silent-fallback: returns [] on error so the wizard simply hides the
 * Quick-start section instead of breaking.
 */
export function useGoalPresetsQuery() {
  return useQuery({
    queryKey: KEY_PUBLIC,
    queryFn: async (): Promise<GoalPreset[]> => {
      try {
        const r = await api<ListResp>('/goal-presets')
        return r.items ?? []
      } catch {
        return []
      }
    },
    staleTime: 5 * 60_000, // 5 min — presets rarely change
  })
}

// ── Admin CRUD ───────────────────────────────────────────────────────────

/** GET /api/v1/admin/goal-presets — admin sees all (active + inactive). */
export function useAdminGoalPresetsQuery() {
  return useQuery({
    queryKey: KEY_ADMIN,
    queryFn: async (): Promise<GoalPreset[]> => {
      const r = await api<ListResp>('/admin/goal-presets')
      return r.items ?? []
    },
    staleTime: 30_000,
  })
}

/** POST /api/v1/admin/goal-presets. */
export function useCreateGoalPresetMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateGoalPresetBody) =>
      api<GoalPreset>('/admin/goal-presets', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY_ADMIN })
      void qc.invalidateQueries({ queryKey: KEY_PUBLIC })
    },
  })
}

/** PATCH /api/v1/admin/goal-presets/{id}. */
export function useUpdateGoalPresetMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateGoalPresetBody }) =>
      api<GoalPreset>(`/admin/goal-presets/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY_ADMIN })
      void qc.invalidateQueries({ queryKey: KEY_PUBLIC })
    },
  })
}

/** POST /api/v1/admin/goal-presets/{id}/deactivate. */
export function useDeactivateGoalPresetMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/admin/goal-presets/${encodeURIComponent(id)}/deactivate`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY_ADMIN })
      void qc.invalidateQueries({ queryKey: KEY_PUBLIC })
    },
  })
}
