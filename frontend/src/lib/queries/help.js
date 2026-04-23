import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useHelpQuery() {
    return useQuery({
        queryKey: ['help'],
        queryFn: () => api('/help'),
    });
}
