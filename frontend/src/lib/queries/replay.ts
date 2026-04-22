import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type ReplayEvent = {
  id: string
  color: string
  label: string
  sub: string
  time: string
}

export type ReplayResponse = {
  session_id: string
  title: string
  status: string
  total_frames: number
  current_frame: number
  duration: string
  events: ReplayEvent[]
}

export function useMockReplayQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['mock', id, 'replay'],
    queryFn: () => api<ReplayResponse>(`/mock/session/${id}/replay`),
    enabled: !!id,
  })
}
