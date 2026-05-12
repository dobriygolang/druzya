// queries/tier.ts — Stream-C tier-info hooks. Source-aware projection
// (free/pro/byok/tutor) для paywall-gates + BYOK form.
//
// Endpoints (REST aliases на subscription Connect-RPC):
//   GET    /api/v1/subscription/tier-info  → TierInfo
//   POST   /api/v1/subscription/byok       → TierInfo (after validate+save)
//   DELETE /api/v1/subscription/byok       → TierInfo

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type TierKind = 'free' | 'pro' | 'max'
export type TierSource = 'free' | 'pro' | 'byok' | 'tutor'
export type BYOKProvider = 'openrouter' | 'groq' | 'cerebras' | 'anthropic' | 'openai'

export type TierInfo = {
  tier: TierKind
  source: TierSource
  // ISO-8601 для paid Pro; пусто иначе.
  expires_at?: string
  // BYOK provider если source='byok'; пусто иначе.
  byok_provider?: BYOKProvider | ''
}

// Stable query keys для invalidation.
export const tierQueryKeys = {
  all: ['subscription', 'tier-info'] as const,
}

// useTierQuery — основная projection источника tier'а. Используется и
// BillingTab, и ProGate; одна query, кешируется 60s. Backend cache даёт
// тот же TTL — больше не имеет смысла.
export function useTierQuery() {
  return useQuery({
    queryKey: tierQueryKeys.all,
    queryFn: () => api<TierInfo>('/subscription/tier-info'),
    staleTime: 60_000,
    retry: false,
  })
}

// useSetBYOKKeyMutation — подключить свой LLM ключ. Backend валидирует
// против test-endpoint провайдера; throws на validation failure.
export function useSetBYOKKeyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ provider, api_key }: { provider: BYOKProvider; api_key: string }) =>
      api<TierInfo>('/subscription/byok', {
        method: 'POST',
        body: JSON.stringify({ provider, api_key }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tierQueryKeys.all })
      void qc.invalidateQueries({ queryKey: ['subscription', 'quota'] })
    },
  })
}

// useRemoveBYOKKeyMutation — снять BYOK-ключ. Idempotent: ok если уже
// удалён. После success tier откатывается к prior source (free/paid).
export function useRemoveBYOKKeyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api<TierInfo>('/subscription/byok', {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tierQueryKeys.all })
      void qc.invalidateQueries({ queryKey: ['subscription', 'quota'] })
    },
  })
}

// hasProAccess — utility: правда если юзер видит Pro features (paid OR BYOK).
// Tutor-mode не даёт Pro (он информационный); free значит «без Pro».
export function hasProAccess(info: TierInfo | undefined): boolean {
  if (!info) return false
  return info.source === 'pro' || info.source === 'byok'
}
