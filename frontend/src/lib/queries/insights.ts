// /lib/queries/insights.ts — typed react-query hooks для Insight stream.
//
// Reads the same Connect endpoint Hone uses. We render insights as
// atomic cards (one fact + lever) on /today and as a chip strip on
// arena. Mutations: AckInsight (follow / dismiss) — optimistic-removed
// from cache so the card disappears instantly on click.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type InsightSeverity =
  | 'INSIGHT_SEVERITY_CRUISE'
  | 'INSIGHT_SEVERITY_NUDGE'
  | 'INSIGHT_SEVERITY_WARN'
  | 'INSIGHT_SEVERITY_CRITICAL'

export interface Insight {
  id: string
  surface: string
  severity: InsightSeverity
  anchor: string
  headline: string
  evidence: string
  interpret: string
  lever: string
  deep_link: string
  event_id?: string
  skill_key?: string
  codex_slug?: string
  track_id?: string
  generated_at?: string
  expires_at?: string
}

interface ListInsightsResponse {
  items: Insight[]
}

const keys = {
  surface: (s: string, limit: number) => ['intelligence', 'insights', s, limit] as const,
}

export function useInsightsQuery(surface = 'today', limit = 8) {
  return useQuery({
    queryKey: keys.surface(surface, limit),
    queryFn: () =>
      api<ListInsightsResponse>(
        `/intelligence/insights?surface=${encodeURIComponent(surface)}&limit=${limit}`,
      ),
    staleTime: 60_000,
  })
}

export function useAckInsightMutation(surface = 'today') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'follow' | 'dismiss' }) =>
      api<{ ok: boolean }>(`/intelligence/insights/${encodeURIComponent(id)}/ack`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      }),
    onMutate: async ({ id }) => {
      // Optimistically remove the card so the user sees instant
      // disappearance. Server's MarkActed/MarkDismissed is idempotent,
      // so the worst case (mutation fails) we just refetch.
      await qc.cancelQueries({ queryKey: ['intelligence', 'insights', surface] })
      const previous = qc.getQueriesData<ListInsightsResponse>({
        queryKey: ['intelligence', 'insights', surface],
      })
      previous.forEach(([qk, data]) => {
        if (!data) return
        qc.setQueryData(qk, { items: data.items.filter((it) => it.id !== id) })
      })
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      // Restore on failure.
      ctx?.previous.forEach(([qk, data]) => {
        if (data) qc.setQueryData(qk, data)
      })
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['intelligence', 'insights', surface] })
    },
  })
}

// ── helpers ──────────────────────────────────────────────────────────────

export function severityWeight(s: InsightSeverity): number {
  switch (s) {
    case 'INSIGHT_SEVERITY_CRITICAL': return 0
    case 'INSIGHT_SEVERITY_WARN': return 1
    case 'INSIGHT_SEVERITY_NUDGE': return 2
    default: return 3
  }
}

export function severityLabel(s: InsightSeverity): string {
  switch (s) {
    case 'INSIGHT_SEVERITY_CRITICAL': return 'critical'
    case 'INSIGHT_SEVERITY_WARN': return 'warn'
    case 'INSIGHT_SEVERITY_NUDGE': return 'nudge'
    default: return 'cruise'
  }
}
