// Queries for the vacancies bounded context.
//
// Backend module: backend/services/vacancies/. The endpoints land under
// /api/v1/vacancies/*. Public reads (analyze, list, get) work without bearer;
// mutating endpoints (save / update status / delete) require auth.
import { useMutation, useQuery, useQueryClient, keepPreviousData, } from '@tanstack/react-query';
import { api } from '../apiClient';
// VACANCY_SOURCES is consumed by the filter sidebar — only the 5 sources
// with working parsers belong here. Adding a new source requires a real
// Parser implementation in backend/services/vacancies/infra/parsers/.
export const VACANCY_SOURCES = [
    'hh',
    'yandex',
    'ozon',
    'tinkoff',
    'vk',
];
export const SAVED_STATUSES = [
    'saved',
    'applied',
    'interviewing',
    'rejected',
    'offer',
];
// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────
function buildListQuery(f) {
    const sp = new URLSearchParams();
    if (f.sources?.length)
        sp.set('source', f.sources.join(','));
    if (f.skills?.length)
        sp.set('skills', f.skills.join(','));
    if (f.salary_min)
        sp.set('salary_min', String(f.salary_min));
    if (f.location)
        sp.set('location', f.location);
    if (f.page)
        sp.set('page', String(f.page));
    if (f.limit)
        sp.set('limit', String(f.limit));
    const q = sp.toString();
    return q ? `?${q}` : '';
}
// ─────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────
export function useVacanciesList(filter) {
    return useQuery({
        queryKey: ['vacancies', 'list', filter],
        queryFn: () => api(`/vacancies${buildListQuery(filter)}`),
        placeholderData: keepPreviousData,
    });
}
export function useVacancy(id) {
    return useQuery({
        queryKey: ['vacancies', 'one', id],
        queryFn: () => api(`/vacancies/${id}`),
        enabled: typeof id === 'number' && id > 0,
    });
}
export function useSavedVacancies() {
    return useQuery({
        queryKey: ['vacancies', 'saved'],
        queryFn: () => api(`/vacancies/saved`),
    });
}
// ─────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────
export function useAnalyzeVacancy() {
    return useMutation({
        mutationFn: (input) => api(`/vacancies/analyze`, {
            method: 'POST',
            body: JSON.stringify(input),
        }),
    });
}
export function useSaveVacancy() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input) => api(`/vacancies/${input.vacancyId}/save`, {
            method: 'POST',
            body: JSON.stringify({ notes: input.notes ?? '' }),
        }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['vacancies', 'saved'] });
        },
    });
}
export function useUpdateSavedStatus() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input) => api(`/vacancies/saved/${input.savedId}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: input.status, notes: input.notes ?? '' }),
        }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['vacancies', 'saved'] });
        },
    });
}
export function useTriggerVacancySync() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => api(`/vacancies/sync`, { method: 'POST' }),
        onSuccess: (res) => {
            if (res.status === 'started') {
                // Sync в фоне 5–10s. Refetch'ним каталог через 8s — обычно к этому
                // времени уже есть первые HH-вакансии. Если ещё пусто — пользователь
                // увидит «попробуй ещё раз» и нажмёт повторно.
                setTimeout(() => {
                    void qc.invalidateQueries({ queryKey: ['vacancies', 'list'] });
                }, 8000);
            }
        },
    });
}
export function useDeleteSaved() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (savedId) => api(`/vacancies/saved/${savedId}`, { method: 'DELETE' }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['vacancies', 'saved'] });
        },
    });
}
// ─────────────────────────────────────────────────────────────────────────
// Derived helpers (used by VacancyCard skill diff visualisation)
// ─────────────────────────────────────────────────────────────────────────
export function diffSkills(required, userSkills) {
    const lower = (xs) => new Set(xs.map((s) => s.toLowerCase()));
    const u = lower(userSkills);
    const matched = new Set();
    const missing = new Set();
    for (const s of required) {
        const k = s.toLowerCase();
        if (u.has(k))
            matched.add(k);
        else
            missing.add(k);
    }
    return { matched, missing };
}
