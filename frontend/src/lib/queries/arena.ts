// Arena bounded-context client. Talks to /api/v1/arena/* (transcoded from
// the Connect ArenaService). Phase 3 added the matchmaking flow:
//
//   useFindMatchMutation    POST   /arena/match/find
//   useCancelSearchMutation DELETE /arena/match/cancel
//   useArenaMatchQuery      GET    /arena/match/{id}
//   useConfirmReadyMutation POST   /arena/match/{id}/confirm
//   useSubmitCodeMutation   POST   /arena/match/{id}/submit
//
// Section/Mode are passed as the proto enum literal strings (e.g.
// "SECTION_ALGORITHMS") because the JSON transcoder serialises proto
// enums by name, not by lower-case alias.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type SectionKey =
  | 'algorithms'
  | 'sql'
  | 'go'
  | 'system_design'
  | 'behavioral'

export type ArenaModeKey =
  | 'solo_1v1'
  | 'duo_2v2'
  | 'ranked'
  | 'hardcore'
  // 'cursed' wire-mode kept for backward-compat; AI-allowed now lives as a Mock pipeline toggle.
  | 'cursed'

export type ArenaLanguageKey =
  | 'go'
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'sql'

// Neural-model preference for the AI opponent / AI helper. This is purely a
// client-side preference for now: the backend ArenaService doesn't have a
// `neural_model` field on FindMatchRequest yet, so the value is persisted to
// localStorage and forwarded as an extra request body field. The transcoder
// drops unknown fields silently, so this is safe (bible §11 — no leakage,
// just a hint for future server-side AI dispatch).
//
// Wave-4 update: the live catalogue (premium tier, providers) is now
// served by GET /api/v1/ai/models — see lib/queries/ai.ts useAIModelsQuery.
// UI code that wants the dynamic list should consume that query; this enum
// stays only to keep the matchmaking call signature stable.
export type NeuralModelKey = 'random' | 'llama3' | 'claude' | 'gpt4'

export const NEURAL_MODELS: NeuralModelKey[] = ['random', 'llama3', 'claude', 'gpt4']

const NEURAL_MODEL_STORAGE_KEY = 'druz9.arena.neural_model'

export function loadNeuralModel(): NeuralModelKey {
  try {
    const raw =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(NEURAL_MODEL_STORAGE_KEY)
        : null
    if (raw && (NEURAL_MODELS as string[]).includes(raw)) {
      return raw as NeuralModelKey
    }
  } catch {
    /* localStorage unavailable (SSR/private mode) — fall through to default. */
  }
  return 'random'
}

export function saveNeuralModel(key: NeuralModelKey): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(NEURAL_MODEL_STORAGE_KEY, key)
    }
  } catch {
    /* swallow — model still works in-memory for the rest of the session. */
  }
}

const SECTION_PROTO: Record<SectionKey, string> = {
  algorithms: 'SECTION_ALGORITHMS',
  sql: 'SECTION_SQL',
  go: 'SECTION_GO',
  system_design: 'SECTION_SYSTEM_DESIGN',
  behavioral: 'SECTION_BEHAVIORAL',
}

const MODE_PROTO: Record<ArenaModeKey, string> = {
  solo_1v1: 'ARENA_MODE_SOLO_1V1',
  duo_2v2: 'ARENA_MODE_DUO_2V2',
  ranked: 'ARENA_MODE_RANKED',
  hardcore: 'ARENA_MODE_HARDCORE',
  cursed: 'ARENA_MODE_CURSED',
}

const LANGUAGE_PROTO: Record<ArenaLanguageKey, string> = {
  go: 'LANGUAGE_GO',
  python: 'LANGUAGE_PYTHON',
  javascript: 'LANGUAGE_JAVASCRIPT',
  typescript: 'LANGUAGE_TYPESCRIPT',
  sql: 'LANGUAGE_SQL',
}

export type ArenaTask = {
  id: string
  slug: string
  title: string
  description: string
  difficulty: string
  section: string
  time_limit_sec: number
  memory_limit_mb: number
  starter_code: Record<string, string>
  example_cases: { input: string; output: string }[]
}

export type Participant = {
  user_id: string
  username: string
  team: number
  elo_before: number
  // Optional fields populated after a participant submits / the match
  // resolves. Used by the 2v2 page to detect "who has already turned in
  // their solution" — the protobuf source-of-truth fills these with zeros
  // when missing, so the UI checks for `> 0`.
  elo_after?: number
  solve_time_ms?: number
  suspicion_score?: number
}

export type ArenaMatch = {
  id: string
  status: string
  mode: string
  section: string
  task: ArenaTask
  participants: Participant[]
  started_at: string
  finished_at?: string
  winner_user_id?: string
}

export type MatchQueueResponse = {
  status: string // "queued" | "matched"
  queue_position: number
  estimated_wait_sec: number
  match_id?: string
}

export type SubmitResult = {
  passed: boolean
  tests_total: number
  tests_passed: number
  runtime_ms: number
  memory_kb: number
}

export function useArenaMatchQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['arena', 'match', id],
    queryFn: () => api<ArenaMatch>(`/arena/match/${id}`),
    enabled: !!id,
    staleTime: 5_000,
  })
}

// ── Live queue stats ─────────────────────────────────────────────────────
//
// `GET /api/v1/arena/queue-stats` returns ZCard-derived counts per
// (mode × section). The /arena landing card UI only needs the per-mode
// aggregate, so we expose `byMode` directly.
//
// Polling cadence (10s) matches the backend QueueStatsCache TTL — clients
// don't see fresher data than the cache anyway, and the matchmaker tick
// is on a similar order so jitter is fine.

export type QueueStatsRow = {
  mode: ArenaModeKey
  section: SectionKey
  waiting: number
}

export type QueueStatsResponse = {
  items: QueueStatsRow[]
  // Sum across sections per mode. Empty modes are still listed (waiting=0)
  // so the UI can switch from "—" to "0 в очереди" deterministically.
  by_mode: Record<ArenaModeKey, number>
  generated_at: number
}

export function useArenaQueueStatsQuery() {
  return useQuery({
    queryKey: ['arena', 'queue-stats'],
    queryFn: () => api<QueueStatsResponse>('/arena/queue-stats'),
    staleTime: 8_000,
    refetchInterval: 10_000,
    retry: false,
  })
}

export type FindMatchInput = {
  section: SectionKey
  mode: ArenaModeKey
  /**
   * Free-form model id from `GET /api/v1/ai/models` (e.g.
   * "openai/gpt-4o-mini"). Backend rejects ids it doesn't know about, so
   * passing arbitrary strings is safe — no frontend enum to keep in sync.
   * The legacy `NeuralModelKey` enum below is kept only for backward-compat
   * with `Arena2v2Page` / older callers.
   */
  neuralModel?: string
}

export function useFindMatchMutation() {
  return useMutation({
    mutationFn: (input: FindMatchInput) =>
      api<MatchQueueResponse>('/arena/match/find', {
        method: 'POST',
        body: JSON.stringify({
          section: SECTION_PROTO[input.section],
          mode: MODE_PROTO[input.mode],
          ...(input.neuralModel ? { neural_model: input.neuralModel } : {}),
        }),
      }),
  })
}

export function useCancelSearchMutation() {
  return useMutation({
    mutationFn: () =>
      api<unknown>('/arena/match/cancel', {
        method: 'DELETE',
      }),
  })
}

// CurrentMatchResponse mirrors the backend chi-direct
// `GET /api/v1/arena/match/current` shape. 404 → no current match (still
// searching); 200 → there's a match the user can navigate to.
export type CurrentMatchResponse = {
  match_id: string
  status: 'searching' | 'confirming' | 'active'
  mode: string
  section: string
}

// useCurrentMatchQuery — poll while the user is in queue. The `enabled`
// arg gates network traffic; pass `inQueue` from the page.
export function useCurrentMatchQuery(enabled: boolean) {
  return useQuery({
    queryKey: ['arena', 'current-match'],
    queryFn: async () => {
      try {
        return await api<CurrentMatchResponse>('/arena/match/current')
      } catch (err) {
        // 404 means "no current match" — return null so the polling loop
        // keeps quietly going. Any other error propagates to the UI.
        if ((err as { status?: number })?.status === 404) {
          return null
        }
        throw err
      }
    },
    enabled,
    // 2s poll while queued — matches the bible's interactive-feedback target.
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  })
}

export function useConfirmReadyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (matchId: string) =>
      api<unknown>(`/arena/match/${matchId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: (_d, matchId) => {
      void qc.invalidateQueries({ queryKey: ['arena', 'match', matchId] })
    },
  })
}

export type SubmitCodeInput = {
  matchId: string
  code: string
  language: ArenaLanguageKey
}

export function useSubmitCodeMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SubmitCodeInput) =>
      api<SubmitResult>(`/arena/match/${input.matchId}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          code: input.code,
          language: LANGUAGE_PROTO[input.language],
        }),
      }),
    onSuccess: (_d, input) => {
      void qc.invalidateQueries({ queryKey: ['arena', 'match', input.matchId] })
      // Atlas + Insights aggregate arena matches into per-skill
      // progress / decay. Refresh both so /atlas and /insights reflect
      // the submission without a manual reload.
      void qc.invalidateQueries({ queryKey: ['profile', 'me', 'atlas'] })
      void qc.invalidateQueries({ queryKey: ['mock', 'insights', 'overview'] })
    },
  })
}

// Static catalogue used by /arena while we don't yet have a backend
// endpoint for queue counts (the Connect service exposes one but the
// monolith doesn't surface stats per-mode separately yet — see backend
// arena/infra/cache.go QueueStatsCache for the planned hook).
export const ARENA_MODES: { key: ArenaModeKey; section: SectionKey }[] = [
  { key: 'solo_1v1', section: 'algorithms' },
  { key: 'ranked', section: 'algorithms' },
  { key: 'hardcore', section: 'algorithms' },
  { key: 'cursed', section: 'algorithms' },
]

// ── Practice mode (DEPRECATED — Wave-4) ───────────────────────────────────
//
// Practice vs AI был удалён из UI (ArenaPage больше не вызывает
// useStartPracticeMutation): нейронка априори решала задачу быстрее
// человека, плюс созданный матч оказывался в состоянии не ожидаемом
// WS-хабом ("match not in required state", бесконечный Reconnecting).
// Пользовательский use-case "хочу попрактиковаться с AI" покрывается
// Mock Interview — отдельным более продуманным сценарием.
//
// Хук + типы оставлены экспортированными временно чтобы не ломать
// существующие .js-сборки в репо. Backend-эндпоинт /arena/practice +
// app.StartPractice удалит следующая волна (требует proto-regen).
//
// Историческое описание ниже.
//
// The practice endpoint is a chi-direct REST route (NOT the Connect
// transcoder) — see `backend/services/arena/ports/practice.go` for the
// rationale. It creates an instant single-player match with the chosen
// neural-model AI as the simulated opponent and returns the match_id; the
// caller navigates straight to /arena/match/:id.

export type StartPracticeInput = {
  section: SectionKey
  neuralModel?: NeuralModelKey
}

export type StartPracticeResponse = {
  match_id: string
  opponent_label: string
  status: string
  started_at: string
}

export function useStartPracticeMutation() {
  return useMutation({
    mutationFn: (input: StartPracticeInput) =>
      api<StartPracticeResponse>('/arena/practice', {
        method: 'POST',
        body: JSON.stringify({
          section: input.section,
          neural_model: input.neuralModel ?? 'random',
        }),
      }),
  })
}
