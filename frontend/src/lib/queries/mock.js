import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';
// queryKeys are exported so callers can cross-invalidate (e.g. profile
// cache should drop when a session finishes — see profile/queries).
export const mockQueryKeys = {
    all: ['mock'],
    session: (id) => ['mock', 'session', id],
    report: (id) => ['mock', 'session', id, 'report'],
    replay: (id) => ['mock', 'session', id, 'replay'],
};
// useMockSessionQuery fetches the live session row. staleTime is 30s — we
// expect WS updates to push fresh data more quickly than that, but the
// query gives the UI a stable boot.
export function useMockSessionQuery(id) {
    return useQuery({
        queryKey: mockQueryKeys.session(id),
        queryFn: () => api(`/mock/session/${id}`),
        enabled: !!id,
        staleTime: 30_000,
    });
}
// useMockReportQuery polls for a report; once it returns status="ready" we
// cache it for 5 minutes since the worker only re-runs on explicit retry.
export function useMockReportQuery(id) {
    return useQuery({
        queryKey: mockQueryKeys.report(id),
        queryFn: () => api(`/mock/session/${id}/report`),
        enabled: !!id,
        staleTime: 5 * 60_000,
        refetchInterval: (q) => {
            const data = q.state.data;
            return data?.status === 'ready' ? false : 4_000;
        },
    });
}
// useMockReplayQuery fetches the immutable replay artefact. staleTime
// Infinity because once a replay exists it never mutates; only a worker
// regeneration would change it, and that flushes the report cache too.
export function useMockReplayQuery(id) {
    return useQuery({
        queryKey: mockQueryKeys.replay(id),
        queryFn: () => api(`/mock/session/${id}/report`),
        enabled: !!id,
        staleTime: Infinity,
    });
}
// useCreateMockSessionMutation creates a session and returns the hydrated
// row. Caller redirects to /mock/:id with the returned id.
export function useCreateMockSessionMutation() {
    return useMutation({
        mutationFn: (input) => api('/mock/session', {
            method: 'POST',
            body: JSON.stringify(input),
        }),
    });
}
// useSendMockMessage posts a user message + invalidates the session cache so
// the next read picks up the appended assistant reply. WS streaming bypasses
// this path; this mutation is for the fallback REST flow.
export function useSendMockMessage(id) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (payload) => api(`/mock/session/${id}/message`, {
            method: 'POST',
            body: JSON.stringify({ session_id: id, ...payload }),
        }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: mockQueryKeys.session(id) });
        },
    });
}
// useFinishMockSessionMutation finishes the session, invalidates the
// session cache, and pre-warms the report query so MockResultPage starts
// polling immediately.
export function useFinishMockSessionMutation(id) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => api(`/mock/session/${id}/finish`, {
            method: 'POST',
            body: JSON.stringify({ session_id: id }),
        }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: mockQueryKeys.session(id) });
            qc.invalidateQueries({ queryKey: mockQueryKeys.report(id) });
        },
    });
}
// useIngestStressMutation pushes a batch of editor events to the stress
// pipeline. Fire-and-forget — we don't expect the response body, errors
// surface via the mutation's status flag.
export function useIngestStressMutation(id) {
    return useMutation({
        mutationFn: (events) => api(`/mock/session/${id}/stress`, {
            method: 'POST',
            body: JSON.stringify({ session_id: id, events }),
        }),
    });
}
