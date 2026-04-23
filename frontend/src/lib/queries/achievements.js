import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useAchievementsQuery() {
    return useQuery({
        queryKey: ['achievements'],
        queryFn: () => api('/achievements'),
    });
}
