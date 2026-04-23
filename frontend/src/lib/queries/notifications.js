import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useNotificationsQuery() {
    return useQuery({
        queryKey: ['notifications'],
        queryFn: () => api('/notifications'),
    });
}
