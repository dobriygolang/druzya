import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type SysDesignSession = {
  id: string
  problem: { title: string; description: string }
  functional: { ok: boolean; text: string }[]
  non_functional: { l: string; v: string; tone: string }[]
  constraints: { l: string; v: string }[]
  evaluation: { l: string; v: number; tone: string }[]
  phases: { t: string; s: string }[]
  ai_credits_used: number
  ai_credits_max: number
  time_elapsed_sec: number
  time_total_sec: number
  current_phase: string
}

export function useSysDesignSessionQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['sysdesign', 'session', id],
    queryFn: () => api<SysDesignSession>(`/sysdesign/session/${id}`),
    enabled: !!id,
  })
}
