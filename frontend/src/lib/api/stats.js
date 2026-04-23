// Public platform metrics — used by the marketing welcome page.
//
// Backed by GET /api/v1/stats/public (no auth). The endpoint returns
// integer counts; we type the shape exhaustively here so call sites get
// completion + protection against drift.
import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
export function fetchPublicStats() {
    return api('/stats/public');
}
export function usePublicStats() {
    return useQuery({
        queryKey: ['stats', 'public'],
        queryFn: fetchPublicStats,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    });
}
