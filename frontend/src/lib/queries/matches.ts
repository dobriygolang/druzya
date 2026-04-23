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

// ── /api/v1/arena/match/{id} adapter for /match/:id/end ──────────────────
//
// MatchEndPage больше не зовёт legacy /matches/:id/end mock. Вместо этого
// она тянет канонический GetMatch (ArenaService) и адаптирует поля
// final_xp / xp_breakdown / tier_label / next_tier_label, добавленные в
// arena.proto.

export type ArenaParticipantWire = {
  user_id: string
  username: string
  team: number
  elo_before: number
  elo_after: number
  solve_time_ms: number
  suspicion_score: number
  final_xp: number
  xp_breakdown: { label: string; amount: number }[]
  tier_label: string
  next_tier_label: string
}

export type ArenaMatchWire = {
  id: string
  status: string
  mode: string
  section: string
  task?: { id: string; title: string }
  participants: ArenaParticipantWire[]
  started_at?: string
  finished_at?: string
  winner_user_id?: string
}

function fmtSolveTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function adaptMatchEnd(raw: ArenaMatchWire, currentUserID: string | undefined): MatchEndResponse {
  const me = raw.participants.find((p) => p.user_id === currentUserID) ?? raw.participants[0]
  const opp = raw.participants.find((p) => p !== me)
  const won = !!raw.winner_user_id && raw.winner_user_id === me?.user_id
  const lpDelta = me ? me.elo_after - me.elo_before : 0
  const lpTotal = me?.elo_after ?? 0
  return {
    id: raw.id,
    result: won ? 'W' : 'L',
    verdict: won ? 'Чисто, быстро, красиво' : 'В следующий раз',
    task: raw.task?.title ?? '',
    sub: opp ? `vs @${opp.username || opp.user_id.slice(0, 6)}` : '',
    lp_delta: lpDelta,
    lp_total: lpTotal,
    tier: me?.tier_label ?? '',
    next_tier: me?.next_tier_label ?? '',
    tier_progress: 0,
    stats: {
      time: me ? fmtSolveTime(me.solve_time_ms) : '—',
      tests: '—',
      complexity: '—',
      lines: '—',
    },
    xp: {
      total: me?.final_xp ?? 0,
      breakdown: (me?.xp_breakdown ?? []).map((b) => ({
        l: b.label,
        v: `${b.amount >= 0 ? '+' : ''}${b.amount}`,
      })),
      level: 0,
      progress: 0,
      next_level_xp: 0,
      progress_pct: 0,
    },
    streak_bonus: '',
    your_code: '',
    their_code: '',
    your_label: me ? `@you · ${me.tier_label}` : '@you',
    their_label: opp ? `@${opp.username || 'opponent'}` : '',
    your_meta: '',
    their_meta: '',
  }
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

export function useMatchEndQuery(id: string | undefined, currentUserID?: string) {
  return useQuery({
    queryKey: ['arena', 'match', id, 'end', currentUserID ?? ''],
    queryFn: async () => {
      // Канонический канал — GetMatch (ArenaService). Адаптируем поля для
      // существующего UI; см. adaptMatchEnd. Если бэк ещё не отдаёт
      // ArenaMatch (например, в legacy-демо), фронт сейчас просто увидит
      // network-error и покажет ErrorChip.
      const raw = await api<ArenaMatchWire>(`/arena/match/${id}`)
      return adaptMatchEnd(raw, currentUserID)
    },
    enabled: !!id,
    staleTime: 30_000,
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
