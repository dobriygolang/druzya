// Personas admin queries — mirrors ai.ts admin surface.
// Backend: GET /api/v1/personas (public) + GET/POST/PATCH/DELETE
// /api/v1/admin/personas/* (admin). Migration 00051.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

// Full row shape — matches the backend adminPersonaDTO.
export type AdminPersona = {
  id: string
  label: string
  hint: string
  icon_emoji: string
  brand_gradient: string
  suggested_task: string
  system_prompt: string
  sort_order: number
  is_enabled: boolean
  created_at: string
  updated_at: string
}

export type AdminPersonasResponse = {
  items: AdminPersona[]
}

// Upsert body — every field optional on PATCH; POST needs at minimum
// `id` and `label` (repo enforces server-side).
export type AdminPersonaUpsertBody = Partial<
  Omit<AdminPersona, 'created_at' | 'updated_at'>
>

export const personaAdminKeys = {
  all: ['admin', 'personas'] as const,
}

export function useAdminPersonasQuery() {
  return useQuery({
    queryKey: personaAdminKeys.all,
    queryFn: () => api<AdminPersonasResponse>('/admin/personas'),
    staleTime: 30 * 1000,
  })
}

export function useCreatePersonaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AdminPersonaUpsertBody) =>
      api<AdminPersona>('/admin/personas', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: personaAdminKeys.all })
    },
  })
}

export function useUpdatePersonaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AdminPersonaUpsertBody }) =>
      api<AdminPersona>(`/admin/personas/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: personaAdminKeys.all })
    },
  })
}

export function useTogglePersonaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<AdminPersona>(`/admin/personas/${encodeURIComponent(id)}/toggle`, {
        method: 'PATCH',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: personaAdminKeys.all })
    },
  })
}

export function useDeletePersonaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/admin/personas/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: personaAdminKeys.all })
    },
  })
}
