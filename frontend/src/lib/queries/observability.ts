// observability.ts — react-query hooks for the three Wave 3.5.x admin
// panels (Tracks / English HR / Mock-block). Backend is chi-direct
// (services/admin/ports/observability_handler.go), no proto stubs.
//
// All endpoints gate on role=admin server-side; the hooks don't add
// retries on 403 — they just propagate the error so AdminPage's role
// guard handles redirect.
import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

const STALE_MS = 60_000

// ── Tracks ────────────────────────────────────────────────────────────

export type TrackDistributionRow = {
  track: string // dev | dev_senior | sysanalyst | product_analyst | qa | english
  total: number
  primary_count: number
  active_30d: number
}

export type TrackDistributionResp = { items: TrackDistributionRow[] }

export function useTracksDistributionQuery() {
  return useQuery({
    queryKey: ['admin', 'observability', 'tracks'] as const,
    queryFn: () => api<TrackDistributionResp>('/admin/observability/tracks'),
    staleTime: STALE_MS,
    retry: false,
  })
}

// ── English HR ────────────────────────────────────────────────────────

export type EnglishHRRecent = {
  session_id: string
  user_hash: string // 8 hex chars; not full UUID
  finished_at: string // RFC3339
  score: number
  errored: boolean // ai_report IS NULL
}

export type EnglishHRStatsResp = {
  window_days: number
  total_sessions: number
  with_report: number
  avg_score: number
  error_rate: number // 0..100
  recent: EnglishHRRecent[]
}

export function useEnglishHRStatsQuery() {
  return useQuery({
    queryKey: ['admin', 'observability', 'english-hr'] as const,
    queryFn: () => api<EnglishHRStatsResp>('/admin/observability/english-hr'),
    staleTime: STALE_MS,
    retry: false,
  })
}

// ── Mock-block ────────────────────────────────────────────────────────

export type MockBlockMetricsResp = {
  window_days: number
  total_sessions: number
  ai_assist_sessions: number
  strict_sessions: number
  strict_pct: number // 0..100
}

export function useMockBlockMetricsQuery() {
  return useQuery({
    queryKey: ['admin', 'observability', 'mock-block'] as const,
    queryFn: () => api<MockBlockMetricsResp>('/admin/observability/mock-block'),
    staleTime: STALE_MS,
    retry: false,
  })
}

// ── Coach intelligence stats (Phase 5) ────────────────────────────────

export type CoachAdminStatsResp = {
  window_days: number
  total_briefs: number
  total_recommendations: number
  severity_distribution: { cruise: number; nudge: number; warn: number; critical: number }
  follow_count: number
  dismiss_count: number
  follow_rate_pct: number // 0..100; -1 если нет ack-эпизодов
  abandoned_mock_count: number
  persona: string // "" / strict / warm / sparring
  prompt_variant: string // default / terse / sharp
  reflective_enabled: boolean
}

export function useCoachAdminStatsQuery(days = 30) {
  return useQuery({
    queryKey: ['admin', 'intelligence', 'stats', days] as const,
    queryFn: () => api<CoachAdminStatsResp>(`/admin/intelligence/stats?days=${days}`),
    staleTime: STALE_MS,
    retry: false,
  })
}
