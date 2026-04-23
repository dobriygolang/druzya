import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
export function useDailyRunMutation() {
    return useMutation({
        mutationFn: (input) => api('/daily/run', {
            method: 'POST',
            body: JSON.stringify(input),
        }),
    });
}
export function useDailySubmitMutation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input) => api('/daily/kata/submit', {
            method: 'POST',
            body: JSON.stringify({ code: input.code, language: input.language }),
        }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['daily', 'kata'] });
            void qc.invalidateQueries({ queryKey: ['daily', 'streak'] });
        },
    });
}
