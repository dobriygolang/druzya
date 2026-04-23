// Season Pass queries — wrapper over the real Connect-RPC SeasonService
// (proto/druz9/v1/season.proto). The transcoder serves both
// /druz9.v1.SeasonService/* natively and GET /api/v1/season/current via REST.
//
// Shape mirrors druz9v1.SeasonProgress 1:1 — keep snake_case so we can decode
// the JSON body the vanguard transcoder emits without an additional mapper.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';
// useSeasonQuery returns the caller's Season Pass progress for the active
// season. Returns 404 when no season is active.
export function useSeasonQuery() {
    return useQuery({
        queryKey: ['season', 'current'],
        queryFn: () => api('/season/current'),
        retry: false,
    });
}
// trackOf is a convenience selector — picks the tier ladder for either Free or
// Premium track from the API response. Returns [] when missing.
export function trackOf(progress, kind) {
    if (!progress)
        return [];
    for (const t of progress.tracks) {
        if (t.kind === kind)
            return t.tiers;
    }
    return [];
}
// useClaimReward is the mutation behind the per-tier "Claim" button. The
// backend exposes ClaimReward as a domain helper; until the REST route lands
// we POST to /season/claim/{tier} and let the BFF reject with 404.
export function useClaimReward() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ tier, kind }) => api(`/season/claim/${tier}?kind=${kind}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        }),
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['season', 'current'] });
        },
    });
}
