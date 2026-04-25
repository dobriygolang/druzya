// intelligence.ts — react-query hook для AI Coach (services/intelligence).
//
// Endpoint: POST /api/v1/intelligence/daily-brief — возвращает synthesised
// brief из cross-product сигналов (Hone focus, mock-interview scores, arena
// outcomes, kata streak, weak skills, today's queue).
//
// Cache: backend кеширует на сутки. Frontend дополнительно держит
// staleTime 10 мин чтобы не дёргать на каждый mount InsightsPage.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type RecommendationKind =
  | 'tiny_task'
  | 'schedule'
  | 'review_note'
  | 'unblock'
  | 'practice_skill'
  | 'drill_mock'
  | 'drill_kata'

export interface BriefRecommendation {
  kind: RecommendationKind
  title: string
  rationale: string
  target_id?: string
}

export interface DailyBrief {
  brief_id?: string
  headline: string
  narrative: string
  recommendations: BriefRecommendation[]
  generated_at?: string
}

const STALE_MS = 10 * 60 * 1000

export const intelligenceKeys = {
  brief: () => ['intelligence', 'daily-brief'] as const,
}

export function useDailyBriefQuery() {
  return useQuery({
    queryKey: intelligenceKeys.brief(),
    queryFn: () =>
      api<DailyBrief>('/intelligence/daily-brief', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }),
    staleTime: STALE_MS,
    // 503 (LLM unavailable) — частая в dev'е без OpenRouter ключа. Не
    // ретраим, показываем placeholder card.
    retry: false,
  })
}

export function useRegenerateDailyBriefMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api<DailyBrief>('/intelligence/daily-brief', {
        method: 'POST',
        body: JSON.stringify({ force: true }),
        headers: { 'content-type': 'application/json' },
      }),
    onSuccess: (data) => {
      qc.setQueryData(intelligenceKeys.brief(), data)
    },
  })
}
