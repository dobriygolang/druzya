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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';
// useMyGuildQuery — current user's guild detail, falls back to a clean
// "no guild" state when the backend returns 404 (see ApiError handling).
export function useMyGuildQuery() {
    return useQuery({
        queryKey: ['guild', 'my'],
        queryFn: async () => {
            try {
                return await api('/guild/my');
            }
            catch (err) {
                // 404 means "user has no guild" — surface as null instead of an
                // error so the page can render the top-list view.
                if (err instanceof Error && /\b404\b/.test(err.message)) {
                    return null;
                }
                throw err;
            }
        },
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
        retry: false,
    });
}
// useGuildQuery — public guild detail by id, consumed by /guild/:guildId.
// Disabled when guildId is undefined so callers can drive it conditionally.
export function useGuildQuery(guildId) {
    return useQuery({
        queryKey: ['guild', 'by-id', guildId],
        queryFn: () => api(`/guild/${guildId}`),
        enabled: !!guildId,
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
    });
}
// useGuildWarQuery — current war for a given guild.
export function useGuildWarQuery(guildId) {
    return useQuery({
        queryKey: ['guild', guildId, 'war'],
        queryFn: () => api(`/guild/${guildId}/war`),
        enabled: !!guildId,
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
    });
}
// useTopGuildsQuery — global guild leaderboard. The backend caches at 5
// minutes; we mirror that with staleTime=5min so React Query doesn't
// hammer the API beyond what's useful.
export function useTopGuildsQuery(limit = 20) {
    return useQuery({
        queryKey: ['guild', 'top', limit],
        queryFn: () => api(`/guilds/top?limit=${encodeURIComponent(limit)}`),
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });
}
export function useGuildListQuery(filters) {
    const qs = new URLSearchParams();
    if (filters.search)
        qs.set('search', filters.search);
    if (filters.tier)
        qs.set('tier', filters.tier);
    if (filters.page && filters.page > 1)
        qs.set('page', String(filters.page));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return useQuery({
        queryKey: ['guild', 'list', filters],
        queryFn: () => api(`/guild/list${suffix}`),
        staleTime: 30 * 1000,
        refetchOnWindowFocus: false,
    });
}
export function useJoinGuildMutation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (guildID) => api(`/guild/${encodeURIComponent(guildID)}/join`, {
            method: 'POST',
            body: '{}',
        }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['guild'] });
        },
    });
}
export function useLeaveGuildMutation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (guildID) => api(`/guild/${encodeURIComponent(guildID)}/leave`, { method: 'POST', body: '{}' }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['guild'] });
        },
    });
}
export function useCreateGuildMutation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input) => api('/guild', {
            method: 'POST',
            body: JSON.stringify(input),
        }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['guild'] });
        },
    });
}
