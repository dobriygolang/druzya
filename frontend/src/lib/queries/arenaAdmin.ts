// arenaAdmin.ts — TanStack hooks для /admin/arena/tasks (chi-direct).
// Backend: cmd/monolith/services/admin_arena_tasks.go.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type ArenaTaskSection = 'algorithms' | 'sql' | 'go' | 'system_design' | 'behavioral'
export type ArenaTaskDifficulty = 'easy' | 'medium' | 'hard'

export type ArenaTask = {
  id: string
  slug: string
  title_ru: string
  title_en: string
  description_ru: string
  description_en: string
  difficulty: ArenaTaskDifficulty
  section: ArenaTaskSection
  time_limit_sec: number
  memory_limit_mb: number
  solution_hint: string
  version: number
  is_active: boolean
  avg_rating: number
}

export type ArenaTaskUpsertBody = {
  slug: string
  title_ru: string
  title_en: string
  description_ru: string
  description_en: string
  difficulty: ArenaTaskDifficulty
  section: ArenaTaskSection
  time_limit_sec?: number
  memory_limit_mb?: number
  solution_hint?: string
  is_active?: boolean
}

export type ArenaTasksFilter = {
  section?: ArenaTaskSection
  difficulty?: ArenaTaskDifficulty
  active?: boolean
}

const KEY = ['admin', 'arena', 'tasks'] as const

export function useArenaTasksQuery(f: ArenaTasksFilter = {}) {
  const qs = new URLSearchParams()
  if (f.section) qs.set('section', f.section)
  if (f.difficulty) qs.set('difficulty', f.difficulty)
  if (typeof f.active === 'boolean') qs.set('active', String(f.active))
  const search = qs.toString()
  return useQuery({
    queryKey: [...KEY, f],
    queryFn: () =>
      api<{ items: ArenaTask[] }>(`/admin/arena/tasks${search ? `?${search}` : ''}`),
    staleTime: 30_000,
  })
}

export function useArenaTaskQuery(id: string | null) {
  return useQuery({
    queryKey: ['admin', 'arena', 'task', id],
    queryFn: () => api<ArenaTask>(`/admin/arena/tasks/${encodeURIComponent(id!)}`),
    enabled: !!id,
    staleTime: 15_000,
  })
}

export function useCreateArenaTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ArenaTaskUpsertBody) =>
      api<ArenaTask>('/admin/arena/tasks', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useUpdateArenaTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ArenaTaskUpsertBody }) =>
      api<ArenaTask>(`/admin/arena/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: KEY })
      void qc.invalidateQueries({ queryKey: ['admin', 'arena', 'task', id] })
    },
  })
}

export function useToggleArenaTaskActiveMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api<{ ok: boolean }>(`/admin/arena/tasks/${encodeURIComponent(id)}/active`, {
        method: 'POST',
        body: JSON.stringify({ active }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteArenaTaskMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/admin/arena/tasks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  })
}
