// queries/notificationTemplates.ts — Admin Phase 2: notification template CRUD.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '../apiClient'

export type NotificationChannel = 'email' | 'tg' | 'push' | 'in_app'

export interface NotificationTemplate {
  id: string
  slug: string
  channel: NotificationChannel
  subject_template: string
  body_template: string
  variables: string[]
  description: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CreateNotificationTemplateBody {
  slug: string
  channel: NotificationChannel
  subject_template?: string
  body_template: string
  variables?: string[]
  description?: string
  is_active?: boolean
}

export interface UpdateNotificationTemplateBody {
  channel?: NotificationChannel
  subject_template?: string
  body_template?: string
  variables?: string[]
  description?: string
  is_active?: boolean
}

type ListResp = { items: NotificationTemplate[] }

const KEY = ['notification-templates', 'admin'] as const

export function useAdminNotificationTemplatesQuery(channel?: NotificationChannel) {
  const query = channel ? `?channel=${channel}` : ''
  return useQuery({
    queryKey: [...KEY, channel ?? 'all'],
    queryFn: async (): Promise<NotificationTemplate[]> => {
      const r = await api<ListResp>(`/admin/notification-templates${query}`)
      return r.items ?? []
    },
    staleTime: 30_000,
  })
}

export function useCreateNotificationTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateNotificationTemplateBody) =>
      api<NotificationTemplate>('/admin/notification-templates', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
    },
  })
}

export function useUpdateNotificationTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateNotificationTemplateBody }) =>
      api<NotificationTemplate>(`/admin/notification-templates/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
    },
  })
}

export function useDeactivateNotificationTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean }>(`/admin/notification-templates/${encodeURIComponent(id)}/deactivate`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY })
    },
  })
}
