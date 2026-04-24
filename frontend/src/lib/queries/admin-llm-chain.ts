// Admin LLM chain runtime config queries.
//
// Backend: migration 00021 + cmd/monolith/services/llmchain_admin.go. Endpoints
//   GET  /api/v1/admin/llm/config
//   PUT  /api/v1/admin/llm/config  { version, chain_order, task_map, virtual_chains }
//
// Flow:
//   1. useLLMChainConfigQuery() подтягивает текущий config (с version).
//   2. Оператор правит в UI (drag/drop порядка, inline-edit моделей).
//   3. useSaveLLMChainConfigMutation() → PUT. Если 409 — значит версия
//      устарела (другой админ поменял). UI делает refetch и предлагает
//      ре-аплай изменений поверх свежего baseline.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type VirtualCandidate = {
  provider: string
  model: string
}

export type LLMChainConfig = {
  version: number
  chain_order: string[]
  task_map: Record<string, Record<string, string>> // task → provider → model_id
  virtual_chains: Record<string, VirtualCandidate[]> // "druz9/turbo" → [...]
}

const keys = {
  all: ['admin', 'llm-chain'] as const,
  config: () => ['admin', 'llm-chain', 'config'] as const,
}

export function useLLMChainConfigQuery() {
  return useQuery({
    queryKey: keys.config(),
    queryFn: () => api<LLMChainConfig>('/admin/llm/config'),
    // Сетевой кеш 10с — админ видит "свежие" данные при переходе между табами,
    // но не дёргает API на каждый ре-рендер.
    staleTime: 10_000,
    gcTime: 5 * 60_000,
  })
}

export function useSaveLLMChainConfigMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: LLMChainConfig) =>
      api<LLMChainConfig>('/admin/llm/config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
    onSuccess: (fresh) => {
      // Обновляем кеш сразу свежим значением — UI сразу покажет incremented
      // version и не ждёт refetch'а.
      qc.setQueryData(keys.config(), fresh)
    },
  })
}

// Constants — список провайдеров / виртуалок, которые фронт знает. Нужны
// для валидации формы и подсказок выпадающих списков. Если backend заведёт
// новый provider — нужно обновить константу И сделать commit'ом модели в
// БД через PUT. Это сознательное решение: hardcode keeps the UI strict.
export const KNOWN_PROVIDERS = [
  'groq',
  'cerebras',
  'mistral',
  'openrouter',
  'deepseek',
  'ollama',
] as const

export type KnownProvider = (typeof KNOWN_PROVIDERS)[number]

export const VIRTUAL_IDS = [
  'druz9/turbo',
  'druz9/pro',
  'druz9/ultra',
  'druz9/reasoning',
] as const

export const KNOWN_TASKS = [
  'vacancies_json',
  'insight_prose',
  'copilot_stream',
  'reasoning',
  'coding_hint',
  'code_review',
  'sysdesign_critique',
  'summarize',
] as const
