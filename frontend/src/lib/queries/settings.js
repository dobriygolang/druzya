import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useNotifyPreferencesQuery() {
    return useQuery({
        queryKey: ['notify', 'preferences'],
        queryFn: () => api('/notify/preferences'),
    });
}
export function useUpdateNotifyPreferences() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (prefs) => api('/notify/preferences', {
            method: 'PUT',
            body: JSON.stringify(prefs),
        }),
        onSuccess: (data) => {
            qc.setQueryData(['notify', 'preferences'], data);
        },
    });
}
export function useUpdateUserSettings() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (settings) => api('/profile/me/settings', {
            method: 'PUT',
            body: JSON.stringify(settings),
        }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['profile', 'me'] });
        },
    });
}
