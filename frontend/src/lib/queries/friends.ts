import { useQuery } from '@tanstack/react-query'
import { api } from '../apiClient'

export type Friend = {
  id: string
  name: string
  tier: string
  status: string
  online: boolean
  gradient: string
  wins: number
  losses: number
  win_rate: number
}

export type FriendRequest = {
  id: string
  name: string
  subtitle: string
  gradient: string
}

export type FriendsResponse = {
  counts: { online: number; total: number; requests: number; guild: number }
  friend_code: string
  online: Friend[]
  offline: Friend[]
  requests: FriendRequest[]
  suggestions: FriendRequest[]
}

export function useFriendsQuery() {
  return useQuery({
    queryKey: ['friends'],
    queryFn: () => api<FriendsResponse>('/friends'),
  })
}
