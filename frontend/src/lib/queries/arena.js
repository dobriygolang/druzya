// Arena bounded-context client. Talks to /api/v1/arena/* (transcoded from
// the Connect ArenaService). Phase 3 added the matchmaking flow:
//
//   useFindMatchMutation    POST   /arena/match/find
//   useCancelSearchMutation DELETE /arena/match/cancel
//   useArenaMatchQuery      GET    /arena/match/{id}
//   useConfirmReadyMutation POST   /arena/match/{id}/confirm
//   useSubmitCodeMutation   POST   /arena/match/{id}/submit
//
// Section/Mode are passed as the proto enum literal strings (e.g.
// "SECTION_ALGORITHMS") because the JSON transcoder serialises proto
// enums by name, not by lower-case alias.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';
export const NEURAL_MODELS = ['random', 'llama3', 'claude', 'gpt4'];
const NEURAL_MODEL_STORAGE_KEY = 'druz9.arena.neural_model';
export function loadNeuralModel() {
    try {
        const raw = typeof window !== 'undefined'
            ? window.localStorage.getItem(NEURAL_MODEL_STORAGE_KEY)
            : null;
        if (raw && NEURAL_MODELS.includes(raw)) {
            return raw;
        }
    }
    catch {
        /* localStorage unavailable (SSR/private mode) — fall through to default. */
    }
    return 'random';
}
export function saveNeuralModel(key) {
    try {
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(NEURAL_MODEL_STORAGE_KEY, key);
        }
    }
    catch {
        /* swallow — model still works in-memory for the rest of the session. */
    }
}
const SECTION_PROTO = {
    algorithms: 'SECTION_ALGORITHMS',
    sql: 'SECTION_SQL',
    go: 'SECTION_GO',
    system_design: 'SECTION_SYSTEM_DESIGN',
    behavioral: 'SECTION_BEHAVIORAL',
};
const MODE_PROTO = {
    solo_1v1: 'ARENA_MODE_SOLO_1V1',
    duo_2v2: 'ARENA_MODE_DUO_2V2',
    ranked: 'ARENA_MODE_RANKED',
    hardcore: 'ARENA_MODE_HARDCORE',
    cursed: 'ARENA_MODE_CURSED',
};
const LANGUAGE_PROTO = {
    go: 'LANGUAGE_GO',
    python: 'LANGUAGE_PYTHON',
    javascript: 'LANGUAGE_JAVASCRIPT',
    typescript: 'LANGUAGE_TYPESCRIPT',
    sql: 'LANGUAGE_SQL',
};
export function useArenaMatchQuery(id) {
    return useQuery({
        queryKey: ['arena', 'match', id],
        queryFn: () => api(`/arena/match/${id}`),
        enabled: !!id,
        staleTime: 5_000,
    });
}
export function useFindMatchMutation() {
    return useMutation({
        mutationFn: (input) => api('/arena/match/find', {
            method: 'POST',
            body: JSON.stringify({
                section: SECTION_PROTO[input.section],
                mode: MODE_PROTO[input.mode],
                ...(input.neuralModel ? { neural_model: input.neuralModel } : {}),
            }),
        }),
    });
}
export function useCancelSearchMutation() {
    return useMutation({
        mutationFn: () => api('/arena/match/cancel', {
            method: 'DELETE',
        }),
    });
}
// useCurrentMatchQuery — poll while the user is in queue. The `enabled`
// arg gates network traffic; pass `inQueue` from the page.
export function useCurrentMatchQuery(enabled) {
    return useQuery({
        queryKey: ['arena', 'current-match'],
        queryFn: async () => {
            try {
                return await api('/arena/match/current');
            }
            catch (err) {
                // 404 means "no current match" — return null so the polling loop
                // keeps quietly going. Any other error propagates to the UI.
                if (err?.status === 404) {
                    return null;
                }
                throw err;
            }
        },
        enabled,
        // 2s poll while queued — matches the bible's interactive-feedback target.
        refetchInterval: 2000,
        refetchIntervalInBackground: false,
        staleTime: 0,
    });
}
export function useConfirmReadyMutation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (matchId) => api(`/arena/match/${matchId}/confirm`, {
            method: 'POST',
            body: JSON.stringify({}),
        }),
        onSuccess: (_d, matchId) => {
            void qc.invalidateQueries({ queryKey: ['arena', 'match', matchId] });
        },
    });
}
export function useSubmitCodeMutation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (input) => api(`/arena/match/${input.matchId}/submit`, {
            method: 'POST',
            body: JSON.stringify({
                code: input.code,
                language: LANGUAGE_PROTO[input.language],
            }),
        }),
        onSuccess: (_d, input) => {
            void qc.invalidateQueries({ queryKey: ['arena', 'match', input.matchId] });
        },
    });
}
// Static catalogue used by /arena while we don't yet have a backend
// endpoint for queue counts (the Connect service exposes one but the
// monolith doesn't surface stats per-mode separately yet — see backend
// arena/infra/cache.go QueueStatsCache for the planned hook).
export const ARENA_MODES = [
    { key: 'solo_1v1', section: 'algorithms' },
    { key: 'ranked', section: 'algorithms' },
    { key: 'hardcore', section: 'algorithms' },
    { key: 'cursed', section: 'algorithms' },
];
export function useStartPracticeMutation() {
    return useMutation({
        mutationFn: (input) => api('/arena/practice', {
            method: 'POST',
            body: JSON.stringify({
                section: input.section,
                neural_model: input.neuralModel ?? 'random',
            }),
        }),
    });
}
