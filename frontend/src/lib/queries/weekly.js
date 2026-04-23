import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useWeeklyReportQuery() {
    return useQuery({
        queryKey: ['report', 'weekly'],
        queryFn: () => api('/report/weekly'),
    });
}
