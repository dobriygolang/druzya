import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useDungeonsQuery() {
    return useQuery({
        queryKey: ['dungeons'],
        queryFn: () => api('/dungeons'),
    });
}
