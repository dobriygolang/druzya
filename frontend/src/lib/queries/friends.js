// friends.ts — TanStack Query bindings для /api/v1/friends/*.
//
// REST контракт описан в backend/services/friends/ports/http.go.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';
export function useFriendsQuery() {
    return useQuery({
        queryKey: ['friends', 'list'],
        queryFn: () => api('/friends'),
        staleTime: 30_000,
    });
}
export function useIncomingFriendsQuery() {
    return useQuery({
        queryKey: ['friends', 'incoming'],
        queryFn: () => api('/friends/incoming'),
        staleTime: 30_000,
    });
}
export function useOutgoingFriendsQuery() {
    return useQuery({
        queryKey: ['friends', 'outgoing'],
        queryFn: () => api('/friends/outgoing'),
    });
}
export function useBlockedFriendsQuery() {
    return useQuery({
        queryKey: ['friends', 'blocked'],
        queryFn: () => api('/friends/blocked'),
    });
}
export function useFriendSuggestionsQuery() {
    return useQuery({
        queryKey: ['friends', 'suggestions'],
        queryFn: () => api('/friends/suggestions', { method: 'POST' }),
        staleTime: 60_000,
    });
}
export function useFriendCodeQuery() {
    return useQuery({
        queryKey: ['friends', 'code'],
        queryFn: () => api('/friends/code'),
        staleTime: 5 * 60_000,
    });
}
// ── mutations ──────────────────────────────────────────────────────────────
function invalidateAll(qc) {
    qc.invalidateQueries({ queryKey: ['friends', 'list'] });
    qc.invalidateQueries({ queryKey: ['friends', 'incoming'] });
    qc.invalidateQueries({ queryKey: ['friends', 'outgoing'] });
    qc.invalidateQueries({ queryKey: ['friends', 'blocked'] });
    qc.invalidateQueries({ queryKey: ['friends', 'suggestions'] });
}
export function useAddFriend() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (args) => api('/friends/request', { method: 'POST', body: JSON.stringify(args) }),
        onSuccess: () => invalidateAll(qc),
    });
}
export function useResolveFriendCode() {
    // alias к useAddFriend, отличает только UX-смысл (modal)
    return useAddFriend();
}
export function useAcceptFriend() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => api(`/friends/${id}/accept`, { method: 'POST' }),
        onSuccess: () => invalidateAll(qc),
    });
}
export function useDeclineFriend() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (id) => api(`/friends/${id}/decline`, { method: 'POST' }),
        onSuccess: () => invalidateAll(qc),
    });
}
export function useBlockUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (userId) => api(`/friends/${userId}/block`, { method: 'POST' }),
        onSuccess: () => invalidateAll(qc),
    });
}
export function useUnblockUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (userId) => api(`/friends/${userId}/block`, { method: 'DELETE' }),
        onSuccess: () => invalidateAll(qc),
    });
}
export function useUnfriend() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (userId) => api(`/friends/${userId}`, { method: 'DELETE' }),
        onSuccess: () => invalidateAll(qc),
    });
}
// ── helpers ────────────────────────────────────────────────────────────────
// recentSorted — последние 10 друзей (offline+online), сортировка по
// last_match_at DESC NULLS LAST.
export function recentSorted(friends) {
    return friends.slice().sort((a, b) => {
        const ta = a.last_match_at ? new Date(a.last_match_at).getTime() : 0;
        const tb = b.last_match_at ? new Date(b.last_match_at).getTime() : 0;
        return tb - ta;
    }).slice(0, 10);
}
