import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
// 5min cache — the year-grid is slow-moving (one mutation per day) and
// the backend invalidates on every SubmitKata. Keep in sync with
// DefaultKataYearTTL in daily/infra/cache.go.
const FIVE_MIN = 5 * 60 * 1000;
export function useKataStreakQuery(year) {
    const y = year ?? new Date().getUTCFullYear();
    return useQuery({
        queryKey: ['kata', 'streak', y],
        queryFn: () => api(`/kata/streak?year=${y}`),
        staleTime: FIVE_MIN,
    });
}
