// AI/LLM model catalogue. Single source of truth for which neural-models
// the backend can actually dispatch via OpenRouter.
//
// Replaces the hardcoded NEURAL_MODELS array in lib/queries/arena.ts — the
// arena enum is kept for backwards compatibility (CustomLobby still imports
// it) but the dynamic picker on ArenaPage now consumes useAIModelsQuery so
// new models added on the backend appear in the UI without a frontend
// release.
//
// Backend: GET /api/v1/ai/models → { available, items[] }. Public read; no
// auth required. When the backend has no OPENROUTER_API_KEY set, items is
// empty and available=false — the UI hides the AI panel in that case
// (anti-fallback policy: never show fake models the backend can't route).
//
// Wave-9 additions:
//   - Admin CRUD hooks (useAIAdminModelsQuery, useCreate/Update/Toggle/Delete
//     mutations) back the "AI Modельки" tab on AdminPage. The catalogue is
//     now stored in the llm_models DB table (migration 00033) so admins can
//     add a new OpenRouter id without a frontend release either.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type AIModelTier = 'free' | 'premium'

export type AIModel = {
  id: string
  label: string
  provider: string
  tier: AIModelTier
  available: boolean
  // is_virtual = true for chain-level pseudo-models (today only
  // "druz9/turbo"). Backend sends `is_virtual` (snake_case) on the wire;
  // the picker rows render a ⚡ badge when true and sort these to the
  // top. Omitted from the response body when false — treat `undefined`
  // as false at every call site.
  is_virtual?: boolean
}

export type AIModelsResponse = {
  available: boolean
  items: AIModel[]
}

// `use` narrows the catalogue to models flagged for a specific feature
// surface via the use_for_{arena,insight,mock,vacancies} columns in
// llm_models. Omit for the full list. Backend validates the value and
// returns 400 on unknown strings — we don't enforce client-side.
export type AIModelUse = 'arena' | 'insight' | 'mock' | 'vacancies'

export function useAIModelsQuery(use?: AIModelUse) {
  const path = use ? `/ai/models?use=${encodeURIComponent(use)}` : '/ai/models'
  return useQuery({
    queryKey: ['ai', 'models', use ?? 'all'],
    queryFn: () => api<AIModelsResponse>(path),
    // Catalogue changes only on backend deploys — cache aggressively.
    staleTime: 5 * 60 * 1000,
  })
}

// ─── Admin CMS surface ───────────────────────────────────────────────────

// Full row shape — matches adminModelDTO in backend
// services/ai_native/ports/admin_models.go.
export type AdminLLMModel = {
  id: number
  model_id: string
  label: string
  provider: string
  tier: AIModelTier
  is_enabled: boolean
  context_window?: number | null
  cost_per_1k_input_usd?: number | null
  cost_per_1k_output_usd?: number | null
  use_for_arena: boolean
  use_for_insight: boolean
  use_for_mock: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type AdminLLMModelsResponse = {
  items: AdminLLMModel[]
}

// UpsertBody mirrors adminModelUpsertBody on the backend. Every field is
// optional on PATCH; POST needs at minimum model_id, label, provider, tier.
export type AdminLLMModelUpsertBody = Partial<
  Omit<AdminLLMModel, 'id' | 'created_at' | 'updated_at'>
>

export const aiAdminQueryKeys = {
  all: ['ai', 'admin', 'models'] as const,
}

// Full list (includes is_enabled=false rows) for the admin grid.
export function useAIAdminModelsQuery() {
  return useQuery({
    queryKey: aiAdminQueryKeys.all,
    queryFn: () => api<AdminLLMModelsResponse>('/admin/ai/models'),
    staleTime: 30 * 1000,
  })
}

export function useCreateLLMModelMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AdminLLMModelUpsertBody) =>
      api<AdminLLMModel>('/admin/ai/models', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiAdminQueryKeys.all })
      void qc.invalidateQueries({ queryKey: ['ai', 'models'] })
    },
  })
}

export function useUpdateLLMModelMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ modelId, body }: { modelId: string; body: AdminLLMModelUpsertBody }) =>
      api<AdminLLMModel>(`/admin/ai/models/${encodeURIComponent(modelId)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiAdminQueryKeys.all })
      void qc.invalidateQueries({ queryKey: ['ai', 'models'] })
    },
  })
}

// Cheap inline flip for the admin grid. Returns the post-flip row.
export function useToggleLLMModelMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (modelId: string) =>
      api<AdminLLMModel>(`/admin/ai/models/${encodeURIComponent(modelId)}/toggle`, {
        method: 'PATCH',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiAdminQueryKeys.all })
      void qc.invalidateQueries({ queryKey: ['ai', 'models'] })
    },
  })
}

export function useDeleteLLMModelMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (modelId: string) =>
      api<void>(`/admin/ai/models/${encodeURIComponent(modelId)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiAdminQueryKeys.all })
      void qc.invalidateQueries({ queryKey: ['ai', 'models'] })
    },
  })
}
