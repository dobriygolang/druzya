import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useDailyKataQuery() {
    return useQuery({
        queryKey: ['daily', 'kata'],
        queryFn: () => api('/daily/kata'),
    });
}
export function useStreakQuery() {
    return useQuery({
        queryKey: ['daily', 'streak'],
        queryFn: () => api('/daily/streak'),
    });
}
export function useCalendarQuery() {
    return useQuery({
        queryKey: ['daily', 'calendar'],
        queryFn: () => api('/daily/calendar'),
    });
}
