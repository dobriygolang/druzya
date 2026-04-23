// achievements.ts — TanStack Query bindings для /api/v1/achievements.
//
// Сервер возвращает массив (без обёртки) — см. ports/http.go.
// Каждый item содержит code/title/description/category/tier/icon_url/
// requirements/reward/hidden/unlocked_at/progress/target.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';
// Утилиты на клиенте (selectors). Тестируются отдельно — не зависят от React.
export function isUnlocked(a) {
    return a.unlocked_at != null;
}
export function progressLabel(a) {
    if (a.target <= 1)
        return isUnlocked(a) ? '1 / 1' : '0 / 1';
    return `${a.progress} / ${a.target}`;
}
export function summarise(items) {
    const byTier = { common: 0, rare: 0, legendary: 0 };
    let unlocked = 0;
    let rareUnlocked = 0;
    let hiddenLocked = 0;
    for (const a of items) {
        byTier[a.tier]++;
        if (isUnlocked(a)) {
            unlocked++;
            if (a.tier === 'rare' || a.tier === 'legendary')
                rareUnlocked++;
        }
        else if (a.hidden) {
            hiddenLocked++;
        }
    }
    return { total: items.length, unlocked, rareUnlocked, byTier, hiddenLocked };
}
export function useAchievementsQuery() {
    return useQuery({
        queryKey: ['achievements', 'list'],
        queryFn: () => api('/achievements'),
        staleTime: 30_000,
    });
}
export function useAchievementQuery(code) {
    return useQuery({
        queryKey: ['achievements', 'one', code],
        queryFn: () => api(`/achievements/${encodeURIComponent(code)}`),
        enabled: code != null && code !== '',
    });
}
export function useRecomputeAchievements() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: () => api('/achievements/recompute', { method: 'POST' }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['achievements', 'list'] });
        },
    });
}
