// queries/coachPrompts.ts — Admin Phase 2: coach prompt CRUD.
//
// Admin-only surface (role gate enforced server-side). Variables — array
// документированных placeholder'ов вида '{{name}}'; UI рендерит как
// chips-hint, реальная подстановка делается backend templating layer'ом.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../apiClient'

export type CoachPromptCategory =
  | 'daily_brief'
  | 'insight'
  | 'mock_grade'
  | 'reflection_grade'
  | 'cue_summary'
  | 'milestones_gen'
  // Phase K, M5 (2026-05-13) — ML-axis-specific drill recommender. Backend
  // allowedCoachCategories whitelist mirror.
  | 'ml_drill'

export interface CoachPrompt {
  id: string
  slug: string
  category: CoachPromptCategory
  template: string
  variables: string[]
  description: string
  is_active: boolean
  version: number
  created_at: string
  updated_at: string
}

export interface CreateCoachPromptBody {
  slug: string
  category: CoachPromptCategory
  template: string
  variables?: string[]
  description?: string
  is_active?: boolean
}

export interface UpdateCoachPromptBody {
  category?: CoachPromptCategory
  template?: string
  variables?: string[]
  description?: string
  is_active?: boolean
}

type ListResp = { items: CoachPrompt[] }

const KEY = ['coach-prompts', 'admin'] as const

export function useAdminCoachPromptsQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<CoachPrompt[]> => {
      const r = await api<ListResp>('/admin/coach-prompts')
      return r.items ?? []
    },
    staleTime: 30_000,
  })
}

export function useCreateCoachPromptMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateCoachPromptBody) =>
      api<CoachPrompt>('/admin/coach-prompts', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
    },
  })
}

export function useUpdateCoachPromptMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCoachPromptBody }) =>
      api<CoachPrompt>(`/admin/coach-prompts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
    },
  })
}

export function useDeactivateCoachPromptMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/admin/coach-prompts/${encodeURIComponent(id)}/deactivate`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
    },
  })
}
