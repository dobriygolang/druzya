import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../apiClient';
function fmtSolveTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}
function adaptMatchEnd(raw, currentUserID) {
    const me = raw.participants.find((p) => p.user_id === currentUserID) ?? raw.participants[0];
    const opp = raw.participants.find((p) => p !== me);
    const won = !!raw.winner_user_id && raw.winner_user_id === me?.user_id;
    const lpDelta = me ? me.elo_after - me.elo_before : 0;
    const lpTotal = me?.elo_after ?? 0;
    return {
        id: raw.id,
        result: won ? 'W' : 'L',
        verdict: won ? 'Чисто, быстро, красиво' : 'В следующий раз',
        task: raw.task?.title ?? '',
        sub: opp ? `vs @${opp.username || opp.user_id.slice(0, 6)}` : '',
        lp_delta: lpDelta,
        lp_total: lpTotal,
        tier: me?.tier_label ?? '',
        next_tier: me?.next_tier_label ?? '',
        tier_progress: 0,
        stats: {
            time: me ? fmtSolveTime(me.solve_time_ms) : '—',
            tests: '—',
            complexity: '—',
            lines: '—',
        },
        xp: {
            total: me?.final_xp ?? 0,
            breakdown: (me?.xp_breakdown ?? []).map((b) => ({
                l: b.label,
                v: `${b.amount >= 0 ? '+' : ''}${b.amount}`,
            })),
            level: 0,
            progress: 0,
            next_level_xp: 0,
            progress_pct: 0,
        },
        streak_bonus: '',
        your_code: '',
        their_code: '',
        your_label: me ? `@you · ${me.tier_label}` : '@you',
        their_label: opp ? `@${opp.username || 'opponent'}` : '',
        your_meta: '',
        their_meta: '',
    };
}
// Legacy hook — returns the bundled history+detail mock payload. Kept so the
// existing diff/AI-banner UI keeps rendering until those pieces switch over
// to the real arena services.
export function useMatchHistoryQuery() {
    return useQuery({
        queryKey: ['matches', 'history'],
        queryFn: () => api('/matches/history'),
    });
}
export function useMatchEndQuery(id, currentUserID) {
    return useQuery({
        queryKey: ['arena', 'match', id, 'end', currentUserID ?? ''],
        queryFn: async () => {
            // Канонический канал — GetMatch (ArenaService). Адаптируем поля для
            // существующего UI; см. adaptMatchEnd. Если бэк ещё не отдаёт
            // ArenaMatch (например, в legacy-демо), фронт сейчас просто увидит
            // network-error и покажет ErrorChip.
            const raw = await api(`/arena/match/${id}`);
            return adaptMatchEnd(raw, currentUserID);
        },
        enabled: !!id,
        staleTime: 30_000,
    });
}
// useArenaHistoryQuery hits GET /arena/matches/my with the given filters.
// staleTime mirrors the backend cache TTL; placeholderData makes pagination
// feel snappy by holding the previous page while the next one loads.
export function useArenaHistoryQuery(filters = {}) {
    const params = new URLSearchParams();
    if (filters.limit != null)
        params.set('limit', String(filters.limit));
    if (filters.offset != null)
        params.set('offset', String(filters.offset));
    if (filters.mode)
        params.set('mode', filters.mode);
    if (filters.section)
        params.set('section', filters.section);
    const qs = params.toString();
    const path = qs ? `/arena/matches/my?${qs}` : '/arena/matches/my';
    return useQuery({
        queryKey: ['arena', 'history', filters],
        queryFn: () => api(path),
        staleTime: 30_000,
        placeholderData: keepPreviousData,
    });
}
