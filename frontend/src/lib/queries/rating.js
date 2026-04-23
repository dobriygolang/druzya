// Rating bounded-context client. Talks to /api/v1/rating/* (transcoded
// from the Connect RatingService). Phase 2 added the /rating page so
// useLeaderboardQuery now supports section + limit filters; useMyRatingsQuery
// still hits /rating/me but its staleTime is tuned (30s) to feel snappy
// after a match completes.
import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
const SECTION_PROTO = {
    algorithms: 'SECTION_ALGORITHMS',
    sql: 'SECTION_SQL',
    go: 'SECTION_GO',
    system_design: 'SECTION_SYSTEM_DESIGN',
    behavioral: 'SECTION_BEHAVIORAL',
};
export function useRatingMeQuery() {
    return useQuery({
        queryKey: ['rating', 'me'],
        queryFn: () => api('/rating/me'),
        staleTime: 30 * 1000,
        refetchOnWindowFocus: false,
    });
}
export function useMyRatingsQuery() {
    // Alias kept for the new /rating page so future UI doesn't carry the
    // legacy "Me" suffix.
    return useRatingMeQuery();
}
export function useLeaderboardQuery(arg = {}) {
    // Backward-compat: legacy callers pass a bare SectionKey string. Normalize.
    const filters = typeof arg === 'string' ? { section: arg } : arg;
    const section = filters.section ?? 'algorithms';
    const limit = filters.limit ?? 100;
    // Mode is NOT yet plumbed end-to-end on the backend (single "all" bucket)
    // — we pass it through queryKey so the cache fragments correctly when
    // the server starts honouring it.
    const mode = filters.mode ?? 'all';
    return useQuery({
        queryKey: ['rating', 'leaderboard', section, mode, limit],
        queryFn: () => {
            const params = new URLSearchParams({
                section: SECTION_PROTO[section],
                limit: String(limit),
            });
            return api(`/rating/leaderboard?${params.toString()}`);
        },
        staleTime: 60 * 1000,
        refetchOnWindowFocus: false,
    });
}
