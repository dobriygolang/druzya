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

import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type AIModelTier = 'free' | 'premium'

export type AIModel = {
  id: string
  label: string
  provider: string
  tier: AIModelTier
  available: boolean
}

export type AIModelsResponse = {
  available: boolean
  items: AIModel[]
}

export function useAIModelsQuery() {
  return useQuery({
    queryKey: ['ai', 'models'],
    queryFn: () => api<AIModelsResponse>('/ai/models'),
    // Catalogue changes only on backend deploys — cache aggressively.
    staleTime: 5 * 60 * 1000,
  })
}
