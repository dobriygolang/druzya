import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useFriendsQuery() {
    return useQuery({
        queryKey: ['friends'],
        queryFn: () => api('/friends'),
    });
}
