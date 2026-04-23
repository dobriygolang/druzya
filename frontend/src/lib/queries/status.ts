// status.ts — react-query hook for the PUBLIC /api/v1/status uptime page.
//
// No bearer required — the endpoint is open to anonymous visitors. The
// hook is configured with refetchInterval=30s so the page stays fresh
// without manual reloads.
import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type StatusServiceState = {
  name: string
  slug: string
  status: 'operational' | 'degraded' | 'down' | string
  uptime_30d: string
  latency_ms: number
}

export type StatusIncident = {
  id: string
  title: string
  description: string
  severity: 'minor' | 'major' | 'critical' | string
  started_at: string
  ended_at?: string | null
  affected_services: string[]
}

export type StatusPage = {
  overall_status: 'operational' | 'degraded' | 'down' | string
  uptime_90d: string
  services: StatusServiceState[]
  incidents: StatusIncident[]
  generated_at: string
}

export const statusQueryKeys = {
  all: ['status'] as const,
  page: () => ['status', 'page'] as const,
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
