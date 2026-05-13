// A reading path = ordered atlas-node-keys + resource-ids the tutor
// curates for a student/cohort. Complements `tutorSharedReading`
// (one-off broadcast); paths are reusable curricula.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../apiClient'

// ── Wire types ────────────────────────────────────────────────────────

// All timestamps come back as RFC3339 strings via the vanguard transcoder.
// Empty Timestamp protos surface as `undefined`.
export type TutorReadingPath = {
  id: string
  tutor_id: string
  name: string
  description: string
  atlas_node_keys: string[]
  resource_ids: string[]
  assigned_count: number
  archived_at?: string
  created_at?: string
  updated_at?: string
}

// ── Read ─────────────────────────────────────────────────────────────

export function useTutorReadingPathsQuery(limit = 50) {
  return useQuery({
    queryKey: ['tutor', 'paths', limit] as const,
    queryFn: () =>
      api<{ items: TutorReadingPath[]; next_cursor?: string }>(
        `/tutor/paths?limit=${limit}`,
      ),
    staleTime: 30_000,
  })
}

// ── Mutations ────────────────────────────────────────────────────────

type CreateVars = {
  name: string
  description?: string
  atlas_node_keys?: string[]
  resource_ids?: string[]
}

export function useCreateReadingPathMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: CreateVars) =>
      api<TutorReadingPath>('/tutor/paths', {
        method: 'POST',
        body: JSON.stringify({
          name: vars.name,
          description: vars.description ?? '',
          atlas_node_keys: vars.atlas_node_keys ?? [],
          resource_ids: vars.resource_ids ?? [],
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'paths'] })
    },
  })
}

type UpdateVars = CreateVars & { path_id: string }

export function useUpdateReadingPathMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: UpdateVars) =>
      api<TutorReadingPath>(`/tutor/paths/${encodeURIComponent(vars.path_id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          path_id: vars.path_id,
          name: vars.name,
          description: vars.description ?? '',
          atlas_node_keys: vars.atlas_node_keys ?? [],
          resource_ids: vars.resource_ids ?? [],
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'paths'] })
    },
  })
}

export function useArchiveReadingPathMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pathId: string) =>
      api<Record<string, never>>(
        `/tutor/paths/${encodeURIComponent(pathId)}/archive`,
        {
          method: 'POST',
          body: JSON.stringify({ path_id: pathId }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tutor', 'paths'] })
    },
  })
}


export type TutorPathAssignment = {
  id: string
  path_id: string
  tutor_id: string
  student_id: string
  current_step: number
  total_steps: number
  assigned_at?: string
  completed_at?: string
  archived_at?: string
  snapshot_atlas_node_keys: string[]
  snapshot_resource_ids: string[]
  path_name: string
  tutor_display_name: string
}

type AssignVars = {
  path_id: string
  student_id: string
  starting_step?: number
}

type AssignResponse = {
  assignment: TutorPathAssignment
  assignments_created: number
}

export function useAssignReadingPathMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: AssignVars) =>
      api<AssignResponse>(`/tutor/paths/${encodeURIComponent(vars.path_id)}/assign`, {
        method: 'POST',
        body: JSON.stringify({
          path_id: vars.path_id,
          student_id: vars.student_id,
          starting_step: vars.starting_step ?? 0,
        }),
      }),
    onSuccess: () => {
      // Bump assigned_count on the source path → invalidate path list.
      qc.invalidateQueries({ queryKey: ['tutor', 'paths'] })
      // Student's pending assignments list will refresh on their next
      // page load — no shared cache key between tutor + student sessions.
    },
  })
}
