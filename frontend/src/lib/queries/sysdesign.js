import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useSysDesignSessionQuery(id) {
    return useQuery({
        queryKey: ['sysdesign', 'session', id],
        queryFn: () => api(`/sysdesign/session/${id}`),
        enabled: !!id,
    });
}
