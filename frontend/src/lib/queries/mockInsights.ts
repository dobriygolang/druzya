// mockInsights.ts — react-query hook for the /insights live cards.
//
// One endpoint, three aggregations:
//   - stage_performance   — pass rate per stage_kind (30d)
//   - recurring_patterns  — top recurring missing-points (30d)
//   - score_trajectory    — last 10 finished pipelines, score series
//
// 60s server-side Cache-Control + 60s client-side staleTime — the
// numbers move slowly, no need to refetch on every Insights mount.
import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type StagePerformance = {
  stage_kind: string
  total: number
  passed: number
  pass_rate: number // 0..100
}

export type RecurringPattern = {
  point: string
  count: number
}

export type ScoreTrajectoryPoint = {
  finished_at: string // RFC3339
  score: number // 0..100
  verdict: string // 'pass' | 'fail'
}

export type MockInsightsOverview = {
  window_days: number
  stage_performance: StagePerformance[]
  recurring_patterns: RecurringPattern[]
  score_trajectory: ScoreTrajectoryPoint[]
  total_sessions_30d: number
  pipeline_pass_rate_30d: number // 0..100
  // Single-paragraph LLM-synthesised narrative built from the data
  // above. Empty when LLMChain unavailable or no 30d activity.
  summary?: string
}

const STALE_MS = 60_000

export function useMockInsightsOverviewQuery() {
  return useQuery({
    queryKey: ['mock', 'insights', 'overview'] as const,
    queryFn: () => api<MockInsightsOverview>('/mock/insights/overview'),
    staleTime: STALE_MS,
    gcTime: 5 * 60_000,
    retry: false,
  })
}
