import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useMockReplayQuery(id) {
    return useQuery({
        queryKey: ['mock', id, 'replay'],
        queryFn: () => api(`/mock/session/${id}/replay`),
        enabled: !!id,
    });
}
