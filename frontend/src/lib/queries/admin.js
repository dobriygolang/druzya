// admin.ts — react-query hooks for /admin landing surface.
//
// All endpoints sit behind the role=admin gate on the backend. The hooks
// don't perform their own access check — render-time guards (see
// AdminPage) call useProfileQuery and redirect when role !== 'admin'.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';
// staleTime mirrors the backend Redis TTL (60s) — refetching faster only
// burns network without earning fresher data.
const ADMIN_DASHBOARD_STALE_MS = 60_000;
const ADMIN_DASHBOARD_GC_MS = 5 * 60_000;
export const adminQueryKeys = {
    all: ['admin'],
    dashboard: () => ['admin', 'dashboard'],
    users: (params) => ['admin', 'users', params.query ?? '', params.status ?? '', params.page ?? 1, params.limit ?? 25],
    reports: (status) => ['admin', 'reports', status || 'pending'],
};
export function useAdminDashboardQuery() {
    return useQuery({
        queryKey: adminQueryKeys.dashboard(),
        queryFn: () => api('/admin/dashboard'),
        staleTime: ADMIN_DASHBOARD_STALE_MS,
        gcTime: ADMIN_DASHBOARD_GC_MS,
    });
}
function buildQS(params) {
    const qp = new URLSearchParams();
    if (params.query)
        qp.set('query', params.query);
    if (params.status)
        qp.set('status', params.status);
    if (params.page)
        qp.set('page', String(params.page));
    if (params.limit)
        qp.set('limit', String(params.limit));
    const s = qp.toString();
    return s ? `?${s}` : '';
}
export function useAdminUsersQuery(params) {
    return useQuery({
        queryKey: adminQueryKeys.users(params),
        queryFn: () => api(`/admin/users${buildQS(params)}`),
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        placeholderData: (prev) => prev, // keep previous page while typing
    });
}
export function useBanUserMutation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input) => api(`/admin/users/${encodeURIComponent(input.user_id)}/ban`, {
            method: 'POST',
            body: JSON.stringify({
                user_id: input.user_id,
                reason: input.reason,
                expires_at: input.expires_at,
            }),
        }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: adminQueryKeys.all });
        },
    });
}
export function useUnbanUserMutation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (userID) => api(`/admin/users/${encodeURIComponent(userID)}/unban`, {
            method: 'POST',
            body: JSON.stringify({ user_id: userID }),
        }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: adminQueryKeys.all });
        },
    });
}
export function useAdminReportsQuery(status = '') {
    return useQuery({
        queryKey: adminQueryKeys.reports(status),
        queryFn: () => {
            const qp = status ? `?status=${encodeURIComponent(status)}` : '';
            return api(`/admin/reports${qp}`);
        },
        staleTime: 30_000,
        gcTime: 5 * 60_000,
    });
}
