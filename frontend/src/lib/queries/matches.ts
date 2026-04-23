import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { api } from '../apiClient'

// ── legacy /matches/history (kept for the existing detail-pane / mock data) ──

export type MatchSummary = {
  id: string
  user: string
  result: 'W' | 'L'
  lp: number
  task: string
  time: string
  initial: string
}

export type MatchDetail = {
  id: string
  opponent: string
  task: string
  difficulty: string
  time_ago: string
  result: 'W' | 'L'
  lp: number
  your_time: string
  their_time: string
  tests: string
  your_code: string[]
  your_highlight: number[]
  their_code: string[]
  their_highlight: number[]
  your_lines: number
  your_complexity: string
  their_lines: number
  their_complexity: string
  ai_summary: string
}

export type MatchHistoryResponse = {
  total_wins: number
  total_losses: number
  avg_lp: number
  matches: MatchSummary[]
  selected_id: string
  detail: MatchDetail
}

export type MatchEndResponse = {
  id: string
  result: 'W' | 'L'
  verdict: string
  task: string
  sub: string
  lp_delta: number
  lp_total: number
  tier: string
  next_tier: string
  tier_progress: number
  stats: { time: string; tests: string; complexity: string; lines: string }
  xp: {
    total: number
    breakdown: { l: string; v: string }[]
    level: number
    progress: number
    next_level_xp: number
    progress_pct: number
  }
  streak_bonus: string
  your_code: string
  their_code: string
  your_label: string
  their_label: string
  your_meta: string
  their_meta: string
}

// Legacy hook — returns the bundled history+detail mock payload. Kept so the
// existing diff/AI-banner UI keeps rendering until those pieces switch over
// to the real arena services.
export function useMatchHistoryQuery() {
  return useQuery({
    queryKey: ['matches', 'history'],
    queryFn: () => api<MatchHistoryResponse>('/matches/history'),
  })
}

export function useMatchEndQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['matches', id, 'end'],
    queryFn: () => api<MatchEndResponse>(`/matches/${id}/end`),
    enabled: !!id,
  })
}

// ── /api/v1/arena/matches/my (Phase 4-A) ─────────────────────────────────

// Wire types must match ports/history.go MatchHistoryEntryDTO + envelope.
// All enum-shaped strings are kept as plain string here so the page works
// even when the backend later adds a new mode/section variant.
export type ArenaHistoryEntry = {
  match_id: string
  finished_at: string
  mode: string
  section: string
  opponent_user_id: string
  opponent_username: string
  opponent_avatar_url: string
  result: 'win' | 'loss' | 'draw' | 'abandoned'
  lp_change: number
  duration_seconds: number
}

export type ArenaHistoryResponse = {
  items: ArenaHistoryEntry[]
  total: number
}

export type ArenaHistoryFilters = {
  limit?: number
  offset?: number
  mode?: string
  section?: string
}

// useArenaHistoryQuery hits GET /arena/matches/my with the given filters.
// staleTime mirrors the backend cache TTL; placeholderData makes pagination
// feel snappy by holding the previous page while the next one loads.
export function useArenaHistoryQuery(filters: ArenaHistoryFilters = {}) {
  const params = new URLSearchParams()
  if (filters.limit != null) params.set('limit', String(filters.limit))
  if (filters.offset != null) params.set('offset', String(filters.offset))
  if (filters.mode) params.set('mode', filters.mode)
  if (filters.section) params.set('section', filters.section)
  const qs = params.toString()
  const path = qs ? `/arena/matches/my?${qs}` : '/arena/matches/my'

  return useQuery({
    queryKey: ['arena', 'history', filters],
    queryFn: () => api<ArenaHistoryResponse>(path),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}
