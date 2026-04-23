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
// Proto-transcoded /daily/kata/submit expects the proto enum *name*
// (e.g. "LANGUAGE_GO"), not the lowercase shared/enums string. The two
// endpoints accept different wire shapes because one is a chi handler
// and the other goes through vanguard → druz9.v1.Language enum.
const SUBMIT_LANGUAGE_MAP = {
    go: 'LANGUAGE_GO',
    python: 'LANGUAGE_PYTHON',
    javascript: 'LANGUAGE_JAVASCRIPT',
    typescript: 'LANGUAGE_TYPESCRIPT',
    sql: 'LANGUAGE_SQL',
};
function submitLanguageWire(lang) {
    const mapped = SUBMIT_LANGUAGE_MAP[lang.toLowerCase()];
    if (!mapped) {
        throw new Error(`unsupported language for submit: ${lang}`);
    }
    return mapped;
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
            body: JSON.stringify({
                code: input.code,
                language: submitLanguageWire(input.language),
            }),
        }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['daily', 'kata'] });
            void qc.invalidateQueries({ queryKey: ['daily', 'streak'] });
        },
    });
}
