import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
export function usePodcastCatalogQuery() {
    return useQuery({
        queryKey: ['podcast', 'catalog'],
        queryFn: () => api('/podcast'),
    });
}
