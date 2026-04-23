import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../apiClient';
// Legacy hook — returns the bundled history+detail mock payload. Kept so the
// existing diff/AI-banner UI keeps rendering until those pieces switch over
// to the real arena services.
export function useMatchHistoryQuery() {
    return useQuery({
        queryKey: ['matches', 'history'],
        queryFn: () => api('/matches/history'),
    });
}
export function useMatchEndQuery(id) {
    return useQuery({
        queryKey: ['matches', id, 'end'],
        queryFn: () => api(`/matches/${id}/end`),
        enabled: !!id,
    });
}
// useArenaHistoryQuery hits GET /arena/matches/my with the given filters.
// staleTime mirrors the backend cache TTL; placeholderData makes pagination
// feel snappy by holding the previous page while the next one loads.
export function useArenaHistoryQuery(filters = {}) {
    const params = new URLSearchParams();
    if (filters.limit != null)
        params.set('limit', String(filters.limit));
    if (filters.offset != null)
        params.set('offset', String(filters.offset));
    if (filters.mode)
        params.set('mode', filters.mode);
    if (filters.section)
        params.set('section', filters.section);
    const qs = params.toString();
    const path = qs ? `/arena/matches/my?${qs}` : '/arena/matches/my';
    return useQuery({
        queryKey: ['arena', 'history', filters],
        queryFn: () => api(path),
        staleTime: 30_000,
        placeholderData: keepPreviousData,
    });
}
