// friends.ts — TanStack Query bindings для /api/v1/friends/*.
//
// REST контракт описан в backend/services/friends/ports/http.go.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

// FriendDTO — anti-fallback policy removed `online` (no real presence
// service exists; the backend AlwaysOffline stub always reported false).
// FriendsPage now infers status purely from last_match_at. When real
// presence ships, add the field back here AND wire a real provider on
// the backend — do NOT reintroduce a hard-coded fallback.
export type FriendDTO = {
  user_id: string
  username: string
  display_name: string
  avatar_url: string
  tier: string
  last_match_at: string | null
  friendship_id?: number
}

export type FriendsListResponse = {
  accepted: FriendDTO[]
  total: number
}

export type FriendCodeResponse = {
  code: string
  expires_at: string
}

export function useFriendsQuery() {
  return useQuery({
    queryKey: ['friends', 'list'],
    queryFn: () => api<FriendsListResponse>('/friends'),
    staleTime: 30_000,
  })
}

export function useIncomingFriendsQuery() {
  return useQuery({
    queryKey: ['friends', 'incoming'],
    queryFn: () => api<FriendDTO[]>('/friends/incoming'),
    staleTime: 30_000,
  })
}

export function useOutgoingFriendsQuery() {
  return useQuery({
    queryKey: ['friends', 'outgoing'],
    queryFn: () => api<FriendDTO[]>('/friends/outgoing'),
  })
}

export function useBlockedFriendsQuery() {
  return useQuery({
    queryKey: ['friends', 'blocked'],
    queryFn: () => api<FriendDTO[]>('/friends/blocked'),
  })
}

export function useFriendSuggestionsQuery() {
  return useQuery({
    queryKey: ['friends', 'suggestions'],
    queryFn: () => api<FriendDTO[]>('/friends/suggestions', { method: 'POST' }),
    staleTime: 60_000,
  })
}

export function useFriendCodeQuery() {
  return useQuery({
    queryKey: ['friends', 'code'],
    queryFn: () => api<FriendCodeResponse>('/friends/code'),
    staleTime: 5 * 60_000,
  })
}

// ── mutations ──────────────────────────────────────────────────────────────

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['friends', 'list'] })
  qc.invalidateQueries({ queryKey: ['friends', 'incoming'] })
  qc.invalidateQueries({ queryKey: ['friends', 'outgoing'] })
  qc.invalidateQueries({ queryKey: ['friends', 'blocked'] })
  qc.invalidateQueries({ queryKey: ['friends', 'suggestions'] })
}

export type AddFriendArgs = { user_id?: string; code?: string }

export function useAddFriend() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: AddFriendArgs) =>
      api<{ friendship_id: number; status: string; already?: boolean }>(
        '/friends/request',
        { method: 'POST', body: JSON.stringify(args) },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useResolveFriendCode() {
  // alias к useAddFriend, отличает только UX-смысл (modal)
  return useAddFriend()
}

export function useAcceptFriend() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api<{ friendship_id: number; status: string }>(`/friends/${id}/accept`, { method: 'POST' }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeclineFriend() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api<void>(`/friends/${id}/decline`, { method: 'POST' }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useBlockUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => api<void>(`/friends/${userId}/block`, { method: 'POST' }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUnblockUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => api<void>(`/friends/${userId}/block`, { method: 'DELETE' }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUnfriend() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => api<void>(`/friends/${userId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAll(qc),
  })
}

// ── helpers ────────────────────────────────────────────────────────────────

// recentSorted — последние 10 друзей (offline+online), сортировка по
// last_match_at DESC NULLS LAST.
export function recentSorted(friends: FriendDTO[]): FriendDTO[] {
  return friends.slice().sort((a, b) => {
    const ta = a.last_match_at ? new Date(a.last_match_at).getTime() : 0
    const tb = b.last_match_at ? new Date(b.last_match_at).getTime() : 0
    return tb - ta
  }).slice(0, 10)
}
