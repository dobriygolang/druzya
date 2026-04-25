// adminQuotas.ts — read/write subscription quota policy через
// /admin/config endpoints (dynamic_config table).
//
// Backend keys: `quota_policy.free`, `quota_policy.seeker`,
// `quota_policy.ascended`. Value — JSON {synced_notes, active_shared_boards,
// active_shared_rooms, shared_ttl_seconds, ai_monthly}. -1 = unlimited.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type Tier = 'free' | 'seeker' | 'ascended'

export interface QuotaPolicy {
  synced_notes: number
  active_shared_boards: number
  active_shared_rooms: number
  shared_ttl_seconds: number
  ai_monthly: number
}

const DEFAULTS: Record<Tier, QuotaPolicy> = {
  free: {
    synced_notes: 10,
    active_shared_boards: 1,
    active_shared_rooms: 1,
    shared_ttl_seconds: 24 * 3600,
    ai_monthly: -1,
  },
  seeker: {
    synced_notes: 100,
    active_shared_boards: 5,
    active_shared_rooms: 5,
    shared_ttl_seconds: 0,
    ai_monthly: 100,
  },
  ascended: {
    synced_notes: -1,
    active_shared_boards: -1,
    active_shared_rooms: -1,
    shared_ttl_seconds: 0,
    ai_monthly: 1000,
  },
}

interface ConfigEntry {
  key: string
  value: unknown
  type: string
  description?: string
}

interface ConfigEntryList {
  items: ConfigEntry[]
}

const KEY_PREFIX = 'quota_policy.'

export const quotaPoliciesQueryKey = ['admin', 'quota_policies'] as const

/** Loads all three tiers in one /admin/config GET, fills missing/invalid with defaults. */
export function useQuotaPoliciesQuery() {
  return useQuery({
    queryKey: quotaPoliciesQueryKey,
    queryFn: async () => {
      const list = await api<ConfigEntryList>('/admin/config')
      const map: Record<Tier, QuotaPolicy> = {
        free: { ...DEFAULTS.free },
        seeker: { ...DEFAULTS.seeker },
        ascended: { ...DEFAULTS.ascended },
      }
      for (const entry of list.items ?? []) {
        if (!entry.key.startsWith(KEY_PREFIX)) continue
        const tier = entry.key.slice(KEY_PREFIX.length) as Tier
        if (tier !== 'free' && tier !== 'seeker' && tier !== 'ascended') continue
        const v = entry.value as Partial<QuotaPolicy> | null
        if (v && typeof v === 'object') {
          map[tier] = { ...map[tier], ...v }
        }
      }
      return map
    },
    staleTime: 30_000,
  })
}

export function useUpdateQuotaPolicyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ tier, policy }: { tier: Tier; policy: QuotaPolicy }) => {
      const key = `${KEY_PREFIX}${tier}`
      // PUT /admin/config/{key} with body { value: <json>, type: 'json' }.
      // The backend transcoder accepts an opaque structpb.Value via a
      // JSON object — we pass the policy directly.
      return await api<ConfigEntry>(`/admin/config/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value: policy, type: 'json' }),
        headers: { 'content-type': 'application/json' },
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: quotaPoliciesQueryKey })
    },
  })
}

export const QUOTA_DEFAULTS = DEFAULTS
