// Guild bounded-context client. Talks to /api/v1/guild/* (transcoded from
// the Connect GuildService) plus the bare /api/v1/guilds/top REST endpoint
// (added in Phase 4-B as a Connect-RPC migration is pending).
//
// Phase 4-B introduces:
//   - useTopGuildsQuery     — global guild leaderboard (used when the user
//                              has no guild yet)
//   - explicit guild lookup — useGuildQuery(guildId) for /guild/:guildId
//   - widened types          — TopGuildSummary mirrors the planned Connect
//                              shape so a future migration is mechanical.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'

export type GuildMember = {
  user_id: string
  username: string
  role: string
  joined_at: string
  assigned_section: string
}

export type Guild = {
  id: string
  name: string
  emblem: string
  guild_elo: number
  members: GuildMember[]
  current_war_id: string | null
}

export type WarLine = {
  section: string
  score_a: number
  score_b: number
  contributors: unknown[]
}

export type GuildWar = {
  id: string
  week_start: string
  week_end: string
  guild_a: { id: string; name: string; emblem: string }
  guild_b: { id: string; name: string; emblem: string }
  lines: WarLine[]
  winner_guild_id: string | null
}

// TopGuildSummary mirrors the JSON wire shape served by GET /api/v1/guilds/top.
// Fields line up with the planned proto contract (members_count, elo_total,
// wars_won, rank) so a Connect-RPC migration will be a drop-in replacement.
export type TopGuildSummary = {
  guild_id: string
  name: string
  emblem: string
  members_count: number
  elo_total: number
  wars_won: number
  rank: number
}

export type TopGuildsResponse = {
  items: TopGuildSummary[]
}

// useMyGuildQuery — current user's guild detail.
//
// Backend (Wave-13 sanctum-bug fix): GetMyGuild now returns an empty
// Guild envelope (id === "") when the user has no membership instead of
// throwing 404 — eliminates the noisy console error on /sanctum for new
// users. Legacy 404 path kept for older deployments.
export function useMyGuildQuery() {
  return useQuery({
    queryKey: ['guild', 'my'],
    queryFn: async () => {
      try {
        const g = await api<Guild>('/guild/my')
        // Empty Guild envelope ⇒ user has no guild yet. Treat as null so
        // existing callsites' `if (!guild)` empty-state path triggers.
        if (!g || !g.id) return null
        return g
      } catch (err) {
        // Backwards compat: legacy backends still throw 404 for "no guild".
        if (err instanceof Error && /\b404\b/.test(err.message)) {
          return null
        }
        throw err
      }
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

// useGuildQuery — public guild detail by id, consumed by /guild/:guildId.
// Disabled when guildId is undefined so callers can drive it conditionally.
export function useGuildQuery(guildId: string | undefined) {
  return useQuery({
    queryKey: ['guild', 'by-id', guildId],
    queryFn: () => api<Guild>(`/guild/${guildId}`),
    enabled: !!guildId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

// useGuildWarQuery — current war for a given guild.
export function useGuildWarQuery(guildId: string | undefined) {
  return useQuery({
    queryKey: ['guild', guildId, 'war'],
    queryFn: () => api<GuildWar>(`/guild/${guildId}/war`),
    enabled: !!guildId,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

// useTopGuildsQuery — global guild leaderboard. The backend caches at 5
// minutes; we mirror that with staleTime=5min so React Query doesn't
// hammer the API beyond what's useful.
export function useTopGuildsQuery(limit: number = 20) {
  return useQuery({
    queryKey: ['guild', 'top', limit],
    queryFn: () =>
      api<TopGuildsResponse>(`/guilds/top?limit=${encodeURIComponent(limit)}`),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

// ── discovery (Wave 3) ────────────────────────────────────────────────────
//
// Lives behind /api/v1/guild/list, /api/v1/guild (POST), /join, /leave —
// chi REST handlers added in services/guild/ports/discovery_handler.go.

export type PublicGuild = {
  id: string
  name: string
  emblem: string
  description: string
  tier: string
  guild_elo: number
  members_count: number
  max_members: number
  join_policy: 'open' | 'invite' | 'closed' | string
  is_public: boolean
  wars_won: number
}

export type GuildListResponse = {
  items: PublicGuild[]
  total: number
  page: number
  page_size: number
}

export type GuildListFilters = {
  search?: string
  tier?: string
  page?: number
}

export function useGuildListQuery(filters: GuildListFilters) {
  const qs = new URLSearchParams()
  if (filters.search) qs.set('search', filters.search)
  if (filters.tier) qs.set('tier', filters.tier)
  if (filters.page && filters.page > 1) qs.set('page', String(filters.page))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return useQuery({
    queryKey: ['guild', 'list', filters],
    queryFn: () => api<GuildListResponse>(`/guild/list${suffix}`),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  })
}

export type GuildJoinResponse = {
  status: 'joined' | 'pending' | string
  guild_id: string
  pending?: boolean
}

export function useJoinGuildMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (guildID: string) =>
      api<GuildJoinResponse>(`/guild/${encodeURIComponent(guildID)}/join`, {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['guild'] })
    },
  })
}

export type GuildLeaveResponse = {
  status: 'left' | 'disbanded' | 'transferred' | string
  guild_id: string
  // Set when status === 'transferred' — the auto-promoted heir.
  new_captain_id?: string
}

export function useLeaveGuildMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (guildID: string) =>
      api<GuildLeaveResponse>(
        `/guild/${encodeURIComponent(guildID)}/leave`,
        { method: 'POST', body: '{}' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['guild'] })
    },
  })
}

export type CreateGuildInput = {
  name: string
  description?: string
  tier?: string
  max_members?: number
  join_policy?: 'open' | 'invite' | 'closed'
}

export type CreateGuildResponse = {
  guild: PublicGuild
}

export function useCreateGuildMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateGuildInput) =>
      api<CreateGuildResponse>('/guild', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['guild'] })
    },
  })
}
