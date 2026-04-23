// notifications.ts — bindings для in-app feed (NotificationsPage + Bell-popup).
//
// REST контракт см. backend/services/notify/ports/user_notifications_handler.go.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';
function buildQueryString(f) {
    const params = [];
    if (f.channel)
        params.push(`channel=${encodeURIComponent(f.channel)}`);
    if (f.unread)
        params.push('unread=1');
    return params.length === 0 ? '' : `?${params.join('&')}`;
}
export function useNotificationsQuery(f = {}) {
    return useQuery({
        queryKey: ['notifications', f],
        queryFn: () => api(`/notifications${buildQueryString(f)}`),
        placeholderData: keepPreviousData,
        staleTime: 15_000,
    });
}
export function useUnreadCountQuery() {
    return useQuery({
        queryKey: ['notifications', 'unread_count'],
        queryFn: () => api('/notifications/unread_count'),
        refetchInterval: 60_000,
    });
}
export function useNotificationPrefsQuery() {
    return useQuery({
        queryKey: ['notifications', 'prefs'],
        queryFn: () => api('/notifications/prefs'),
    });
}
function invalidateAll(qc) {
    qc.invalidateQueries({ queryKey: ['notifications'] });
}
export function useMarkRead() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => api(`/notifications/${id}/read`, { method: 'POST' }),
        onSuccess: () => invalidateAll(qc),
    });
}
export function useMarkAllRead() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => api('/notifications/read_all', { method: 'POST' }),
        onSuccess: () => invalidateAll(qc),
    });
}
export function useUpdatePrefs() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body) => api('/notifications/prefs', { method: 'PUT', body: JSON.stringify(body) }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', 'prefs'] }),
    });
}
export function bucketOf(iso, now = new Date()) {
    const d = new Date(iso);
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    if (d >= startToday)
        return 'today';
    const startYesterday = new Date(startToday);
    startYesterday.setDate(startYesterday.getDate() - 1);
    if (d >= startYesterday)
        return 'yesterday';
    const startWeek = new Date(startToday);
    startWeek.setDate(startWeek.getDate() - 7);
    if (d >= startWeek)
        return 'this_week';
    return 'older';
}
export function groupByBucket(items, now = new Date()) {
    const out = { today: [], yesterday: [], this_week: [], older: [] };
    for (const n of items) {
        out[bucketOf(n.created_at, now)].push(n);
    }
    return out;
}
