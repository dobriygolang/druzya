// status.ts — react-query hook for the PUBLIC /api/v1/status uptime page.
//
// No bearer required — the endpoint is open to anonymous visitors. The
// hook is configured with refetchInterval=30s so the page stays fresh
// without manual reloads.
import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
export const statusQueryKeys = {
    all: ['status'],
    page: () => ['status', 'page'],
};
const STATUS_REFETCH_MS = 30_000;
export function useStatusPageQuery() {
    return useQuery({
        queryKey: statusQueryKeys.page(),
        queryFn: () => api('/status'),
        staleTime: STATUS_REFETCH_MS,
        gcTime: 5 * 60_000,
        refetchInterval: STATUS_REFETCH_MS,
        refetchOnWindowFocus: true,
    });
}
