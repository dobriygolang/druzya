import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useNativeScoreQuery(id) {
    return useQuery({
        queryKey: ['native', id, 'score'],
        queryFn: () => api(`/native/session/${id}/score`),
        enabled: !!id,
    });
}
export function useProvenanceQuery(id) {
    return useQuery({
        queryKey: ['native', id, 'provenance'],
        queryFn: () => api(`/native/session/${id}/provenance`),
        enabled: !!id,
    });
}
