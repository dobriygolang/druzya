// notifications.ts — bindings для in-app feed (NotificationsPage + Bell-popup).
//
// REST контракт см. backend/services/notify/ports/user_notifications_handler.go.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type NotificationChannel =
  | 'social'
  | 'match'
  | 'cohort'
  | 'system'
  | 'challenges'
  | 'wins'

export type NotificationItem = {
  id: number
  channel: NotificationChannel | string
  type: string
  title: string
  body: string
  payload: Record<string, unknown> | null
  priority: number
  read_at: string | null
  created_at: string
}

export type NotificationsListResponse = {
  items: NotificationItem[]
}

export type NotificationFilter = {
  channel?: NotificationChannel | ''
  unread?: boolean
}

function buildQueryString(f: NotificationFilter): string {
  const params: string[] = []
  if (f.channel) params.push(`channel=${encodeURIComponent(f.channel)}`)
  if (f.unread) params.push('unread=1')
  return params.length === 0 ? '' : `?${params.join('&')}`
}

export function useNotificationsQuery(f: NotificationFilter = {}) {
  return useQuery({
    queryKey: ['notifications', f],
    queryFn: () => api<NotificationsListResponse>(`/notifications${buildQueryString(f)}`),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
}

export function useUnreadCountQuery() {
  return useQuery({
    queryKey: ['notifications', 'unread_count'],
    queryFn: () => api<{ count: number }>('/notifications/unread_count'),
    refetchInterval: 60_000,
  })
}

export type NotificationPrefs = {
  channel_enabled: Record<string, boolean>
  silence_until: string | null
  updated_at: string
}

export function useNotificationPrefsQuery() {
  return useQuery({
    queryKey: ['notifications', 'prefs'],
    queryFn: () => api<NotificationPrefs>('/notifications/prefs'),
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['notifications'] })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api<void>(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useMarkAllRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<{ updated: number }>('/notifications/read_all', { method: 'POST' }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpdatePrefs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { channel_enabled: Record<string, boolean>; silence_until?: string | null }) =>
      api<NotificationPrefs>('/notifications/prefs', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', 'prefs'] }),
  })
}

// ── selectors / formatters ─────────────────────────────────────────────────

export type Bucket = 'today' | 'yesterday' | 'this_week' | 'older'

export function bucketOf(iso: string, now: Date = new Date()): Bucket {
  const d = new Date(iso)
  const startToday = new Date(now)
  startToday.setHours(0, 0, 0, 0)
  if (d >= startToday) return 'today'
  const startYesterday = new Date(startToday)
  startYesterday.setDate(startYesterday.getDate() - 1)
  if (d >= startYesterday) return 'yesterday'
  const startWeek = new Date(startToday)
  startWeek.setDate(startWeek.getDate() - 7)
  if (d >= startWeek) return 'this_week'
  return 'older'
}

export type Grouped = {
  today: NotificationItem[]
  yesterday: NotificationItem[]
  this_week: NotificationItem[]
  older: NotificationItem[]
}

export function groupByBucket(items: NotificationItem[], now: Date = new Date()): Grouped {
  const out: Grouped = { today: [], yesterday: [], this_week: [], older: [] }
  for (const n of items) {
    out[bucketOf(n.created_at, now)].push(n)
  }
  return out
}
