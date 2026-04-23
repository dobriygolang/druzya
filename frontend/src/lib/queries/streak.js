import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useKataStreakQuery() {
    return useQuery({
        queryKey: ['kata', 'streak'],
        queryFn: () => api('/kata/streak'),
    });
}
