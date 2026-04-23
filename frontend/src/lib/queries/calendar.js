import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useInterviewCalendarQuery() {
    return useQuery({
        queryKey: ['interview', 'calendar'],
        queryFn: () => api('/interview/calendar'),
    });
}
