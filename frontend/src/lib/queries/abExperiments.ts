// queries/abExperiments.ts — Admin Phase 2: A/B experiment scaffold.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../apiClient'

export type ABStatus = 'draft' | 'running' | 'paused' | 'completed'

export interface ABVariant {
  name: string
  weight: number
}

export interface ABExperiment {
  id: string
  slug: string
  hypothesis: string
  variants: ABVariant[]
  metric_slug: string
  status: ABStatus
  starts_at?: string | null
  ends_at?: string | null
  created_at: string
  updated_at: string
}

export interface CreateABExperimentBody {
  slug: string
  hypothesis: string
  variants: ABVariant[]
  metric_slug: string
  status?: ABStatus
  starts_at?: string | null
  ends_at?: string | null
}

type ListResp = { items: ABExperiment[] }

const KEY = ['ab-experiments', 'admin'] as const

export function useAdminABExperimentsQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<ABExperiment[]> => {
      const r = await api<ListResp>('/admin/ab-experiments')
      return r.items ?? []
    },
    staleTime: 30_000,
  })
}

export function useCreateABExperimentMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateABExperimentBody) =>
      api<ABExperiment>('/admin/ab-experiments', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
    },
  })
}

export function useSetABExperimentStatusMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ABStatus }) =>
      api<ABExperiment>(`/admin/ab-experiments/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
    },
  })
}
