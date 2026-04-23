import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useInterviewAutopsyQuery(id) {
    return useQuery({
        queryKey: ['interview', id, 'autopsy'],
        queryFn: () => api(`/interview/${id}/autopsy`),
        enabled: !!id,
    });
}
