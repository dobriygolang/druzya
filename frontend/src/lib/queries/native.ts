import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type NativeScore = {
  session_id: string
  status: string
  ai_fraction: number
  human_fraction: number
  scores: {
    authorship: number
    comprehension: number
    refactor_quality: number
    coverage: number
  }
  gates: { key: string; passed: boolean; note?: string }[]
  overall: number
}

export type ProvenanceNode = {
  id: string
  kind: 'ai' | 'human' | 'test' | 'merge'
  label: string
  parents: string[]
  timestamp: string
}

export type Provenance = {
  session_id: string
  nodes: ProvenanceNode[]
}

export function useNativeScoreQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['native', id, 'score'],
    queryFn: () => api<NativeScore>(`/native/session/${id}/score`),
    enabled: !!id,
  })
}

export function useProvenanceQuery(id: string | undefined) {
  return useQuery({
    queryKey: ['native', id, 'provenance'],
    queryFn: () => api<Provenance>(`/native/session/${id}/provenance`),
    enabled: !!id,
  })
}
