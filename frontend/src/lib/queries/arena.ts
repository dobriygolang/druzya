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
  | 'cursed'

export type ArenaLanguageKey =
  | 'go'
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'sql'

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
}

export type ArenaMatch = {
  id: string
  status: string
  mode: string
  section: string
  task: ArenaTask
  participants: Participant[]
  started_at: string
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

export type FindMatchInput = {
  section: SectionKey
  mode: ArenaModeKey
}

export function useFindMatchMutation() {
  return useMutation({
    mutationFn: (input: FindMatchInput) =>
      api<MatchQueueResponse>('/arena/match/find', {
        method: 'POST',
        body: JSON.stringify({
          section: SECTION_PROTO[input.section],
          mode: MODE_PROTO[input.mode],
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
