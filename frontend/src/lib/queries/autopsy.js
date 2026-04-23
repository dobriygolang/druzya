import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useCreateAutopsy() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body) => api('/daily/autopsy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['daily', 'calendar'] });
        },
    });
}
