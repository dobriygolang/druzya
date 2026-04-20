import { useQuery } from '@tanstack/react-query'
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

export function useMyGuildQuery() {
  return useQuery({
    queryKey: ['guild', 'my'],
    queryFn: () => api<Guild>('/guild/my'),
  })
}

export function useGuildWarQuery(guildId: string | undefined) {
  return useQuery({
    queryKey: ['guild', guildId, 'war'],
    queryFn: () => api<GuildWar>(`/guild/${guildId}/war`),
    enabled: !!guildId,
  })
}
