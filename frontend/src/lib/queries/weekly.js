import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
const SECTION_NAMES = {
    algorithms: 'Algorithms',
    sql: 'SQL',
    go: 'Go',
    system_design: 'System Design',
    behavioral: 'Behavioral',
};
const SECTION_LETTERS = {
    algorithms: 'A',
    sql: 'Q',
    go: 'G',
    system_design: 'S',
    behavioral: 'B',
};
function fmtPercent(curr, prev) {
    if (prev <= 0) {
        if (curr === 0)
            return '0%';
        return '+∞%';
    }
    const delta = ((curr - prev) / prev) * 100;
    const sign = delta >= 0 ? '+' : '';
    return `${sign}${Math.round(delta)}%`;
}
function fmtPeriod(weekStart, weekEnd) {
    // weekStart/weekEnd are YYYY-MM-DD strings.
    try {
        const start = new Date(weekStart);
        const end = new Date(weekEnd);
        const opts = { day: 'numeric', month: 'long' };
        const startStr = start.toLocaleDateString('ru', { day: 'numeric' });
        const endStr = end.toLocaleDateString('ru', opts);
        return `${startStr}–${endStr}`;
    }
    catch {
        return `${weekStart} — ${weekEnd}`;
    }
}
function adapt(raw) {
    const m = raw.metrics;
    const wins = m.matches_won ?? 0;
    // matches_total = wins + losses; losses не приходят отдельно, считаем как
    // tasks_solved - wins (best-effort) или 0.
    const matchesTotal = m.tasks_solved && m.tasks_solved >= wins ? m.tasks_solved : wins;
    const losses = Math.max(matchesTotal - wins, 0);
    const xpEarned = m.xp_earned ?? 0;
    const prevXP = raw.prev_xp_earned ?? 0;
    const lpDelta = m.rating_change ?? 0;
    const avgLp = matchesTotal > 0 ? lpDelta / matchesTotal : 0;
    const streakCur = raw.streak_days ?? 0;
    const streakBest = raw.best_streak ?? 0;
    const strong = (raw.strong_sections ?? []).map((s) => ({
        id: SECTION_LETTERS[s.section] ?? s.section.charAt(0).toUpperCase(),
        name: SECTION_NAMES[s.section] ?? s.section,
        sub: `${s.matches} матчей · ${s.win_rate_pct}% wr`,
        xp: `${s.xp_delta >= 0 ? '+' : ''}${s.xp_delta} XP`,
    }));
    const weak = (raw.weak_sections ?? []).map((s, idx) => ({
        id: SECTION_LETTERS[s.section] ?? s.section.charAt(0).toUpperCase(),
        name: SECTION_NAMES[s.section] ?? s.section,
        sub: `${s.matches} матчей · ${s.win_rate_pct}% wr`,
        xp: `${s.xp_delta >= 0 ? '+' : ''}${s.xp_delta} XP`,
        tone: idx === 0 ? 'danger' : 'warn',
    }));
    const compare = (raw.weekly_xp ?? []).map((w) => ({
        label: w.label,
        xp: w.xp,
        w: `${w.pct}%`,
    }));
    const actions = (raw.recommendations ?? []).slice(0, 3).map((r, idx) => ({
        p: idx === 0 ? 'P1' : idx === 1 ? 'P1' : 'P2',
        text: r.title,
        sub: '', // recommendation.description in proto, mapped through if present
    }));
    return {
        period: fmtPeriod(raw.week_start, raw.week_end),
        actions_count: raw.actions_count ?? matchesTotal,
        stats: {
            xp: { value: xpEarned.toLocaleString('ru-RU', { signDisplay: 'always' }), delta: fmtPercent(xpEarned, prevXP) },
            matches: { value: String(matchesTotal), wins, losses, delta: fmtPercent(matchesTotal, 0) },
            streak: { value: streakCur > 0 ? `${streakCur} 🔥` : '0', best: streakBest },
            avg_lp: { value: `${avgLp >= 0 ? '+' : ''}${avgLp.toFixed(1)}`, total: `${lpDelta >= 0 ? '+' : ''}${lpDelta} lp всего` },
        },
        strong_sections: strong,
        weak_sections: weak,
        stress_pattern: raw.stress_analysis ?? '',
        actions,
        podcast: { title: '', duration: '', sub: '' },
        compare_weeks: compare,
        heatmap: raw.heatmap ?? [],
    };
}
export function useWeeklyReportQuery() {
    return useQuery({
        queryKey: ['profile', 'me', 'report'],
        queryFn: async () => {
            const raw = await api('/profile/me/report');
            return adapt(raw);
        },
        // Бэк держит 5-мин Redis-кеш; на фронте 30s достаточно, чтобы не дёргать
        // зря и при этом не показывать старые данные после нового матча.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
    });
}
