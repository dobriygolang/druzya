import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';
// Stable cache keys used across the app. Exported so write-paths (settings,
// admin tools) can invalidate without re-stringifying the key by hand.
export const profileQueryKeys = {
    all: ['profile'],
    me: () => ['profile', 'me'],
    meAtlas: () => ['profile', 'me', 'atlas'],
    meReport: () => ['profile', 'me', 'report'],
    public: (username) => ['profile', 'public', username.toLowerCase()],
};
// staleTime of 60s mirrors the server-side Redis TTL — the backend cache
// won't refresh more often than that anyway, so re-fetching faster just
// burns network without helping freshness.
const PROFILE_STALE_MS = 60_000;
const PROFILE_GC_MS = 5 * 60_000;
export function useProfileQuery() {
    return useQuery({
        queryKey: profileQueryKeys.me(),
        queryFn: () => api('/profile/me'),
        staleTime: PROFILE_STALE_MS,
        gcTime: PROFILE_GC_MS,
    });
}
// usePublicProfileQuery is the hook for /profile/:username. Pass an empty
// string to disable the query (useful when the route param hasn't resolved
// yet); the request will not fire until a non-empty username is supplied.
export function usePublicProfileQuery(username) {
    const safe = (username ?? '').trim();
    return useQuery({
        queryKey: profileQueryKeys.public(safe),
        queryFn: () => api(`/profile/${encodeURIComponent(safe)}`),
        staleTime: PROFILE_STALE_MS,
        gcTime: PROFILE_GC_MS,
        enabled: safe.length > 0,
        retry: (failureCount, err) => {
            // Don't retry on 404 (profile-not-found is a terminal state for that
            // username). Network errors and 5xx still get the default 3 retries.
            const status = err?.status;
            if (status === 404)
                return false;
            return failureCount < 3;
        },
    });
}
export function useAtlasQuery() {
    return useQuery({
        queryKey: profileQueryKeys.meAtlas(),
        queryFn: () => api('/profile/me/atlas'),
        staleTime: PROFILE_STALE_MS,
        gcTime: PROFILE_GC_MS,
    });
}
export function useWeeklyReportQuery() {
    return useQuery({
        queryKey: profileQueryKeys.meReport(),
        queryFn: () => api('/profile/me/report'),
        staleTime: PROFILE_STALE_MS,
        gcTime: PROFILE_GC_MS,
    });
}
// useInvalidateProfile returns a callable that busts every cached profile
// view (own + public). Mutations that change profile shape (settings save,
// avatar update, etc.) should call this on success.
export function useInvalidateProfile() {
    const qc = useQueryClient();
    return () => qc.invalidateQueries({ queryKey: profileQueryKeys.all });
}
