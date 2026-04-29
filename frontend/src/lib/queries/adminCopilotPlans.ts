// adminCopilotPlans.ts — read/write copilot plans config через /admin/config
// (dynamic_config table, key='copilot_plans').
//
// Backend читает этот же ключ через DynamicConfigProvider.PlanForTier
// (services/copilot/infra/config.go), там же CopilotPlanConfig schema.
// Изменения подхватываются на лету через TTL-cache; рестарт не нужен.
//
// Schema (full document):
//   {
//     "default_model_id": "druz9/turbo",
//     "order": ["free", "pro", "max"],
//     "plans": {
//       "free": { id, display_name, price_label, tagline, bullets[],
//                 cta_label, subscribe_url, requests_cap, models_allowed[] },
//       "pro":  { ... },
//       "max":  { ... }
//     }
//   }
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type PlanTier = 'free' | 'pro' | 'max'

export interface CopilotPlanConfig {
  id: string
  display_name: string
  price_label: string
  tagline: string
  bullets: string[]
  cta_label: string
  subscribe_url: string
  requests_cap: number // -1 = unlimited
  models_allowed: string[] // empty = no restriction
}

export interface CopilotPlansConfig {
  default_model_id: string
  order: string[]
  plans: Record<string, CopilotPlanConfig>
}

interface ConfigEntry {
  key: string
  value: unknown
  type?: string
  updated_at?: string
}

interface ConfigEntryList {
  items?: ConfigEntry[]
}

// Hardcoded дефолты — должны совпадать с copilot/infra/config.go
// DefaultPlanConfigs(). При расхождении бэк win'ит (UI читает
// dynamic_config, fallback на свои дефолты только если строки нет).
export const COPILOT_PLAN_DEFAULTS: CopilotPlansConfig = {
  default_model_id: 'druz9/turbo',
  order: ['free', 'pro', 'max'],
  plans: {
    free: {
      id: 'free',
      display_name: 'Free',
      price_label: 'Бесплатно',
      tagline: 'Для знакомства с продуктом',
      bullets: ['20 запросов в день', 'Только Турбо-цепочка', 'Только macOS'],
      cta_label: 'Текущий план',
      subscribe_url: '',
      requests_cap: 20,
      models_allowed: ['druz9/turbo'],
    },
    pro: {
      id: 'pro',
      display_name: 'Pro',
      price_label: '499 ₽/мес',
      tagline: 'Для ежедневной работы',
      bullets: [
        '200 запросов в день',
        'Расширенные модели',
        'История с облачной синхронизацией',
      ],
      cta_label: 'Оформить подписку',
      subscribe_url: '',
      requests_cap: 200,
      models_allowed: [],
    },
    max: {
      id: 'max',
      display_name: 'Max',
      price_label: '1490 ₽/мес',
      tagline: 'Для интенсивной работы',
      bullets: ['Безлимит запросов', 'Все модели включая Reasoning', 'Приоритет support'],
      cta_label: 'Оформить Max',
      subscribe_url: '',
      requests_cap: -1,
      models_allowed: [],
    },
  },
}

const KEY = 'copilot_plans'

export const copilotPlansQueryKey = ['admin', 'copilot_plans'] as const

export function useCopilotPlansQuery() {
  return useQuery({
    queryKey: copilotPlansQueryKey,
    queryFn: async () => {
      const list = await api<ConfigEntryList>('/admin/config')
      const entry = (list.items ?? []).find((e) => e.key === KEY)
      if (!entry || !entry.value || typeof entry.value !== 'object') {
        return structuredClone(COPILOT_PLAN_DEFAULTS)
      }
      // Merge с defaults — заполняем missing-tier'ы baked-дефолтами
      // чтобы UI всегда отрисовывал 3 карточки.
      const v = entry.value as Partial<CopilotPlansConfig>
      const out = structuredClone(COPILOT_PLAN_DEFAULTS)
      if (v.default_model_id) out.default_model_id = v.default_model_id
      if (Array.isArray(v.order) && v.order.length > 0) out.order = v.order
      if (v.plans && typeof v.plans === 'object') {
        for (const [k, p] of Object.entries(v.plans)) {
          if (p && typeof p === 'object') {
            out.plans[k] = { ...out.plans[k], ...(p as Partial<CopilotPlanConfig>) }
          }
        }
      }
      return out
    },
    staleTime: 30_000,
  })
}

// Сохраняем ВЕСЬ document (free+pro+max сразу) — backend хранит JSON
// одним value. Отдельный per-tier save был бы чище но требовал бы
// merge-логики на бэкенде; держим контракт простым.
export function useUpdateCopilotPlansMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (cfg: CopilotPlansConfig) =>
      api<ConfigEntry>(`/admin/config/${encodeURIComponent(KEY)}`, {
        method: 'PUT',
        body: JSON.stringify({ value: cfg, type: 'json' }),
        headers: { 'content-type': 'application/json' },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: copilotPlansQueryKey })
    },
  })
}
