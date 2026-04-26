// Admin LLM chain runtime config queries.
//
// Backend: migration 00021 + cmd/monolith/services/llmchain_admin.go. Endpoints
//   GET  /api/v1/admin/llm/config
//   PUT  /api/v1/admin/llm/config  { version, chain_order, task_map, virtual_chains }

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type VirtualCandidate = {
  provider: string
  model: string
}

export type LLMChainConfig = {
  version: number
  chain_order: string[]
  task_map: Record<string, Record<string, string>>
  virtual_chains: Record<string, VirtualCandidate[]>
  // Снимок провайдеров с настроенным API-ключом в env. Шлётся бекендом в
  // GET-response, используется live-preview'ом чтобы пометить звенья,
  // которые реально недостижимы (ключ не настроен).
  registered_providers?: string[]
}

const keys = {
  all: ['admin', 'llm-chain'] as const,
  config: () => ['admin', 'llm-chain', 'config'] as const,
}

export function useLLMChainConfigQuery() {
  return useQuery({
    queryKey: keys.config(),
    queryFn: () => api<LLMChainConfig>('/admin/llm/config'),
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
      qc.setQueryData(keys.config(), fresh)
    },
  })
}

// ─── Constants: known providers / virtual IDs / tasks ──────────────────────

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

// Синхронизируется с backend `shared/pkg/llmchain/provider.go` (Task
// constants). При добавлении новой Task'и на бэке — обязательно
// добавить сюда, иначе админ-таблица её не покажет и hot-swap модели
// (без redeploy'а) для этой задачи не будет работать.
export const KNOWN_TASKS = [
  'vacancies_json',
  'insight_prose',
  'copilot_stream',
  'reasoning',
  'coding_hint',
  'code_review',
  'sysdesign_critique',
  'summarize',
  'daily_plan_synthesis',
  'daily_brief',
  'note_qa',
  'vision',
] as const

// ─── Provider model catalogues ─────────────────────────────────────────────
//
// Hardcoded справочник известных моделей per provider. Используется в
// admin-UI как autocomplete (datalist) + для live-preview'а tier'а.
// Синхронизируется с backend'ом (shared/pkg/llmchain/tier.go).

export type ModelTier = 'free' | 'seeker' | 'ascendant'

export type ProviderModel = {
  id: string
  label: string
  tier: ModelTier
  hint?: string
}

export const PROVIDER_MODELS: Record<KnownProvider, ProviderModel[]> = {
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', tier: 'free', hint: 'general' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B ⚡', tier: 'free', hint: 'fast' },
    { id: 'qwen2.5-coder-32b-instruct', label: 'Qwen 2.5 Coder 32B', tier: 'free', hint: 'code' },
  ],
  cerebras: [
    { id: 'llama3.3-70b', label: 'Llama 3.3 70B', tier: 'free', hint: 'general' },
    { id: 'llama3.1-8b', label: 'Llama 3.1 8B', tier: 'free', hint: 'fast' },
    { id: 'llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B', tier: 'free', hint: 'new' },
  ],
  mistral: [
    { id: 'mistral-small-latest', label: 'Mistral Small', tier: 'free', hint: 'fast' },
    { id: 'mistral-large-latest', label: 'Mistral Large', tier: 'free', hint: 'general' },
    { id: 'codestral-latest', label: 'Codestral', tier: 'free', hint: 'code' },
    { id: 'pixtral-large-latest', label: 'Pixtral Large', tier: 'free', hint: 'vision' },
  ],
  openrouter: [
    { id: 'qwen/qwen3-coder:free', label: 'Qwen3 Coder · free', tier: 'free', hint: 'code' },
    { id: 'openai/gpt-oss-120b:free', label: 'GPT-OSS 120B · free', tier: 'free' },
    { id: 'deepseek/deepseek-chat:free', label: 'DeepSeek V3 · free', tier: 'free' },
    { id: 'minimax/minimax-m2.5:free', label: 'MiniMax M2.5 · free', tier: 'free' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B · free', tier: 'free' },
    { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini', tier: 'seeker', hint: 'fast-paid' },
    { id: 'openai/o3-mini', label: 'o3-mini', tier: 'seeker', hint: 'reasoning' },
    { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5', tier: 'seeker', hint: 'fast-paid' },
    { id: 'openai/gpt-4.1', label: 'GPT-4.1', tier: 'ascendant', hint: 'top' },
    { id: 'openai/gpt-4o', label: 'GPT-4o', tier: 'ascendant', hint: 'top' },
    { id: 'openai/o3', label: 'o3', tier: 'ascendant', hint: 'top reasoning' },
    { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5', tier: 'ascendant', hint: 'top' },
    { id: 'anthropic/claude-opus-4', label: 'Claude Opus 4', tier: 'ascendant', hint: 'top' },
  ],
  deepseek: [
    { id: 'deepseek-chat', label: 'DeepSeek V3', tier: 'seeker', hint: 'cheap paid' },
    { id: 'deepseek-reasoner', label: 'DeepSeek R1', tier: 'seeker', hint: 'reasoning' },
  ],
  ollama: [
    { id: 'qwen2.5:7b-instruct-q4_K_M', label: 'Qwen 2.5 7B', tier: 'free', hint: 'self-host' },
    { id: 'qwen2.5:3b-instruct-q4_K_M', label: 'Qwen 2.5 3B', tier: 'free', hint: 'self-host fast' },
  ],
}

export const VIRTUAL_MIN_TIER: Record<(typeof VIRTUAL_IDS)[number], ModelTier> = {
  'druz9/turbo': 'free',
  'druz9/pro': 'seeker',
  'druz9/ultra': 'ascendant',
  'druz9/reasoning': 'seeker',
}

export function tierRank(t: ModelTier): number {
  if (t === 'seeker') return 1
  if (t === 'ascendant') return 2
  return 0
}

export function tierCovers(user: ModelTier, required: ModelTier): boolean {
  return tierRank(user) >= tierRank(required)
}

export function resolveModelTier(provider: string, modelID: string): ModelTier {
  const list = PROVIDER_MODELS[provider as KnownProvider]
  if (!list) return 'free'
  const match = list.find((m) => m.id === modelID)
  return match?.tier ?? 'free'
}
