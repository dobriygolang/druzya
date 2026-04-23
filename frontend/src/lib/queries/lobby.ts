// Custom-Lobby bounded-context client (WAVE-11).
//
// REST endpoints (see backend/cmd/monolith/services/lobby.go):
//   GET    /lobby/list?visibility=public&mode=&section=   public
//   POST   /lobby                                         create (auth)
//   GET    /lobby/{id}                                    public detail
//   GET    /lobby/code/{code}                             public, case-insensitive
//   POST   /lobby/{id}/join                               (auth, 409 if full/closed)
//   POST   /lobby/{id}/leave                              (auth, owner-leave cancels)
//   POST   /lobby/{id}/start                              (auth, owner only)
//   POST   /lobby/{id}/cancel                             (auth, owner only)
//
// Anti-fallback: 404 detail surfaces as null so the page can render a
// dedicated "not found / wrong code" empty state instead of inventing one.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../apiClient'

export type LobbyMode = '1v1' | '2v2'
export type LobbyVisibility = 'public' | 'unlisted' | 'private'
export type LobbyStatus = 'open' | 'live' | 'cancelled'

export type Lobby = {
  id: string
  code: string
  owner_id: string
  mode: LobbyMode
  section: string
  difficulty: string
  visibility: LobbyVisibility
  max_members: number
  ai_allowed: boolean
  time_limit_min: number
  status: LobbyStatus
  match_id: string | null
  members_count: number
  created_at: string
}

export type LobbyMember = {
  user_id: string
  role: 'owner' | 'member'
  team: number
  joined_at: string
}

export type LobbyDetail = {
  lobby: Lobby
  members: LobbyMember[]
}

export type LobbyListResponse = {
  items: Lobby[]
}

export type LobbyListFilters = {
  visibility?: LobbyVisibility
  mode?: LobbyMode
  section?: string
}

export function useLobbyListQuery(filters: LobbyListFilters = {}) {
  const qs = new URLSearchParams()
  qs.set('visibility', filters.visibility ?? 'public')
  if (filters.mode) qs.set('mode', filters.mode)
  if (filters.section) qs.set('section', filters.section)
  return useQuery({
    queryKey: ['lobby', 'list', filters],
    queryFn: () => api<LobbyListResponse>(`/lobby/list?${qs.toString()}`),
    // Lobbies fill up fast; keep the list cheap to refresh.
    staleTime: 5 * 1000,
    refetchInterval: 10 * 1000,
    refetchOnWindowFocus: false,
  })
}

export function useLobbyQuery(id: string | undefined, opts: { pollMs?: number } = {}) {
  return useQuery({
    queryKey: ['lobby', 'by-id', id],
    queryFn: async () => {
      try {
        return await api<LobbyDetail>(`/lobby/${encodeURIComponent(id ?? '')}`)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
    enabled: !!id,
    staleTime: 2 * 1000,
    refetchInterval: opts.pollMs ?? 4 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export function useLobbyByCodeQuery(code: string | undefined, enabled = true) {
  const normalized = (code ?? '').trim().toUpperCase()
  return useQuery({
    queryKey: ['lobby', 'by-code', normalized],
    queryFn: async () => {
      try {
        return await api<LobbyDetail>(`/lobby/code/${encodeURIComponent(normalized)}`)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
    enabled: enabled && normalized.length === 4,
    staleTime: 5 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export type CreateLobbyPayload = {
  mode: LobbyMode
  section: string
  difficulty: string
  visibility?: LobbyVisibility
  max_members?: number
  ai_allowed?: boolean
  time_limit_min?: number
}

export function useCreateLobby() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateLobbyPayload) =>
      api<Lobby>('/lobby', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lobby', 'list'] })
    },
  })
}

export type JoinLobbyResponse = { status: string; lobby: Lobby }

export function useJoinLobby() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (lobbyID: string) =>
      api<JoinLobbyResponse>(`/lobby/${encodeURIComponent(lobbyID)}/join`, {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: (_, lobbyID) => {
      void qc.invalidateQueries({ queryKey: ['lobby', 'by-id', lobbyID] })
      void qc.invalidateQueries({ queryKey: ['lobby', 'list'] })
    },
  })
}

export type LeaveLobbyResponse = { status: 'left' | 'cancelled' | string; lobby_id: string }

export function useLeaveLobby() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (lobbyID: string) =>
      api<LeaveLobbyResponse>(`/lobby/${encodeURIComponent(lobbyID)}/leave`, {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: (_, lobbyID) => {
      void qc.invalidateQueries({ queryKey: ['lobby', 'by-id', lobbyID] })
      void qc.invalidateQueries({ queryKey: ['lobby', 'list'] })
    },
  })
}

export type StartLobbyResponse = { status: string; lobby: Lobby }

export function useStartLobby() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (lobbyID: string) =>
      api<StartLobbyResponse>(`/lobby/${encodeURIComponent(lobbyID)}/start`, {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: (_, lobbyID) => {
      void qc.invalidateQueries({ queryKey: ['lobby', 'by-id', lobbyID] })
      void qc.invalidateQueries({ queryKey: ['lobby', 'list'] })
    },
  })
}

export function useCancelLobby() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (lobbyID: string) =>
      api<{ status: string; lobby_id: string }>(
        `/lobby/${encodeURIComponent(lobbyID)}/cancel`,
        { method: 'POST', body: '{}' },
      ),
    onSuccess: (_, lobbyID) => {
      void qc.invalidateQueries({ queryKey: ['lobby', 'by-id', lobbyID] })
      void qc.invalidateQueries({ queryKey: ['lobby', 'list'] })
    },
  })
}
