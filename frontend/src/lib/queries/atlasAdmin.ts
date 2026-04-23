// atlasAdmin.ts — react-query hooks for the admin Atlas CMS.
//
// Mirrors backend/services/profile/ports/atlas_admin_handler.go. All
// endpoints sit behind the role=admin gate on the backend; render-time
// guard in AdminPage already redirects non-admins.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type AtlasAdminNode = {
  id: string
  title: string
  section: string // algorithms / sql / go / system_design / behavioral / ...
  kind: string // normal | keystone | ascendant | center
  description: string
  total_count: number
  pos_x?: number | null
  pos_y?: number | null
  sort_order: number
  is_active: boolean
}

export type AtlasAdminEdge = {
  id: number
  from: string
  to: string
}

export type AtlasNodeListResp = { items: AtlasAdminNode[] }
export type AtlasEdgeListResp = { items: AtlasAdminEdge[] }

export const atlasAdminKeys = {
  nodes: () => ['admin', 'atlas', 'nodes'] as const,
  edges: () => ['admin', 'atlas', 'edges'] as const,
}

const STALE = 30_000
const GC = 5 * 60_000

export function useAtlasAdminNodesQuery() {
  return useQuery({
    queryKey: atlasAdminKeys.nodes(),
    queryFn: () => api<AtlasNodeListResp>('/admin/atlas/nodes'),
    staleTime: STALE,
    gcTime: GC,
  })
}

export function useAtlasAdminEdgesQuery() {
  return useQuery({
    queryKey: atlasAdminKeys.edges(),
    queryFn: () => api<AtlasEdgeListResp>('/admin/atlas/edges'),
    staleTime: STALE,
    gcTime: GC,
  })
}

export type UpsertNodePayload = {
  id: string
  title: string
  section: string
  kind: string
  description?: string
  total_count: number
  pos_x?: number | null
  pos_y?: number | null
  sort_order?: number
  is_active?: boolean
}

export function useCreateAtlasNodeMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertNodePayload) =>
      api<AtlasAdminNode>('/admin/atlas/nodes', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: atlasAdminKeys.nodes() })
      qc.invalidateQueries({ queryKey: ['profile', 'me', 'atlas'] })
    },
  })
}

export function useUpdateAtlasNodeMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertNodePayload) =>
      api<AtlasAdminNode>(`/admin/atlas/nodes/${encodeURIComponent(input.id)}`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: atlasAdminKeys.nodes() })
      qc.invalidateQueries({ queryKey: ['profile', 'me', 'atlas'] })
    },
  })
}

export type UpdatePositionPayload = {
  id: string
  pos_x: number | null
  pos_y: number | null
}

export function useUpdateAtlasPositionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdatePositionPayload) => {
      await api<void>(`/admin/atlas/nodes/${encodeURIComponent(input.id)}/position`, {
        method: 'PATCH',
        body: JSON.stringify({ pos_x: input.pos_x, pos_y: input.pos_y }),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: atlasAdminKeys.nodes() })
      qc.invalidateQueries({ queryKey: ['profile', 'me', 'atlas'] })
    },
  })
}

export function useDeleteAtlasNodeMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await api<void>(`/admin/atlas/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: atlasAdminKeys.nodes() })
      qc.invalidateQueries({ queryKey: atlasAdminKeys.edges() })
      qc.invalidateQueries({ queryKey: ['profile', 'me', 'atlas'] })
    },
  })
}

export function useCreateAtlasEdgeMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { from: string; to: string }) =>
      api<AtlasAdminEdge>('/admin/atlas/edges', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: atlasAdminKeys.edges() })
      qc.invalidateQueries({ queryKey: ['profile', 'me', 'atlas'] })
    },
  })
}

export function useDeleteAtlasEdgeMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api<void>(`/admin/atlas/edges/${id}`, { method: 'DELETE' })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: atlasAdminKeys.edges() })
      qc.invalidateQueries({ queryKey: ['profile', 'me', 'atlas'] })
    },
  })
}
