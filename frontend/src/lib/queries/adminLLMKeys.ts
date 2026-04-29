// adminLLMKeys.ts — read/write LLM provider API keys через /admin/config
// (dynamic_config table, key='llm_provider_keys').
//
// Backend читает этот же ключ при boot'е monolith'а в
// cmd/monolith/services/admin/llmchain.go::buildLLMChainWithRuntime —
// DB-ключи объединяются с env-CSV (env-keys + db-keys → один MultiKeyDriver
// per provider).
//
// ВАЖНО: изменения требуют рестарта monolith'а. Hot-swap драйверов в
// runtime'е не поддержан (Chain.drivers map без RWMutex).
// Save кладёт значение в DB, на следующем boot'е chain поднимется с
// merged keys. UI показывает баннер «restart required».
//
// Schema: { "groq": ["key1","key2"], "google": ["k1","k2","k3"], ... }
// Empty array == не добавлять для этого провайдера.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'
import { KNOWN_PROVIDERS, type KnownProvider } from './admin-llm-chain'

export type ProviderKeysMap = Partial<Record<KnownProvider, string[]>>

interface ConfigEntry {
  key: string
  value: unknown
  type?: string
  updated_at?: string
}

interface ConfigEntryList {
  items?: ConfigEntry[]
}

const KEY = 'llm_provider_keys'

export const llmKeysQueryKey = ['admin', 'llm_provider_keys'] as const

export function useLLMKeysQuery() {
  return useQuery({
    queryKey: llmKeysQueryKey,
    queryFn: async () => {
      const list = await api<ConfigEntryList>('/admin/config')
      const entry = (list.items ?? []).find((e) => e.key === KEY)
      const out: ProviderKeysMap = {}
      for (const p of KNOWN_PROVIDERS) out[p] = []
      if (entry && entry.value && typeof entry.value === 'object') {
        const v = entry.value as Record<string, unknown>
        for (const p of KNOWN_PROVIDERS) {
          const arr = v[p]
          if (Array.isArray(arr)) {
            out[p] = arr.filter((x): x is string => typeof x === 'string')
          }
        }
      }
      return out
    },
    staleTime: 30_000,
  })
}

export function useUpdateLLMKeysMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (keys: ProviderKeysMap) =>
      api<ConfigEntry>(`/admin/config/${encodeURIComponent(KEY)}`, {
        method: 'PUT',
        body: JSON.stringify({ value: keys, type: 'json' }),
        headers: { 'content-type': 'application/json' },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: llmKeysQueryKey })
    },
  })
}

// Маска для отображения. Безопасно показываем первые 4 + последние 4 символа.
export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 12) return '•'.repeat(key.length)
  return `${key.slice(0, 4)}…${key.slice(-4)} (${key.length})`
}
