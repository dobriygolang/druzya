// status.ts — react-query hook for the PUBLIC /api/v1/status uptime page.
//
// No bearer required — the endpoint is open to anonymous visitors. The
// hook is configured with refetchInterval=30s so the page stays fresh
// without manual reloads.
//
// КОНТРАКТ: бэк отдаёт Connect-RPC protobuf-JSON (camelCase поля +
// опускает пустые массивы / default значения). Поэтому incidents и
// latencyMs могут отсутствовать — читаем через optional chaining + ??.
import { useQueries, useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type StatusServiceState = {
  name: string
  slug: string
  status: 'operational' | 'degraded' | 'down' | string
  uptime30d: string
  latencyMs?: number
}

export type StatusIncident = {
  id: string
  title: string
  description: string
  severity: 'minor' | 'major' | 'critical' | string
  startedAt: string
  endedAt?: string | null
  affectedServices: string[]
}

export type StatusPage = {
  overallStatus: 'operational' | 'degraded' | 'down' | string
  uptime90d: string
  services: StatusServiceState[]
  incidents?: StatusIncident[]
  generatedAt: string
}

export type StatusHistoryDay = {
  day: string // YYYY-MM-DD (UTC)
  status: 'operational' | 'degraded' | 'down' | string
}

export type StatusHistoryResp = {
  service: string
  days: number
  buckets: StatusHistoryDay[]
}

export const statusQueryKeys = {
  all: ['status'] as const,
  page: () => ['status', 'page'] as const,
  history: (slug: string, days: number) =>
    ['status', 'history', slug, days] as const,
}

const STATUS_REFETCH_MS = 30_000

export function useStatusPageQuery() {
  return useQuery({
    queryKey: statusQueryKeys.page(),
    queryFn: () => api<StatusPage>('/status'),
    staleTime: STATUS_REFETCH_MS,
    gcTime: 5 * 60_000,
    refetchInterval: STATUS_REFETCH_MS,
    refetchOnWindowFocus: true,
  })
}

// Per-service spark bars on /status. The endpoint derives day buckets
// from the incidents log; cache is 60s server-side, 60s client-side.
export function useStatusHistoriesQuery(slugs: string[], days = 30) {
  return useQueries({
    queries: slugs.map((slug) => ({
      queryKey: statusQueryKeys.history(slug, days),
      queryFn: () =>
        api<StatusHistoryResp>(
          `/status/history?service=${encodeURIComponent(slug)}&days=${days}`,
        ),
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    })),
  })
}
