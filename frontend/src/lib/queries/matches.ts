import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

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
