import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type NotificationItem = {
  id: string
  kind: 'challenge' | 'win' | 'ai' | 'guild' | 'achievement' | 'friend' | 'rank' | 'streak' | 'system'
  unread: boolean
  title: string
  subtitle: string
  time: string
  bucket: 'today' | 'yesterday' | 'week'
}

export type NotificationsResponse = {
  unread: number
  total: number
  filters: { challenges: number; wins: number; requests: number; guild: number; system: number }
  tabs: { all: number; unread: number; social: number; match: number; guild: number; system: number }
  items: NotificationItem[]
}

export function useNotificationsQuery() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationsResponse>('/notifications'),
  })
}
