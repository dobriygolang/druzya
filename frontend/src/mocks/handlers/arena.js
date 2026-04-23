import { http, HttpResponse } from 'msw';
const base = '/api/v1';
const matchId = '11111111-1111-1111-1111-111111111111';
export const arenaHandlers = [
    http.post(`${base}/arena/match/find`, () => HttpResponse.json({
        status: 'matched',
        match_id: matchId,
        queue_position: 1,
        estimated_wait_sec: 0,
    })),
    http.delete(`${base}/arena/match/cancel`, () => new HttpResponse(null, { status: 204 })),
    http.post(`${base}/arena/match/:id/confirm`, () => new HttpResponse(null, { status: 204 })),
    http.get(`${base}/arena/match/:id`, ({ params }) => {
        // Поддерживаем оба сценария:
        //   1. /arena/match/<любой> → active match (для /arena/match/:id экрана)
        //   2. /arena/match/<любой>?finished=1 → finished, enriched полями
        //      final_xp / xp_breakdown / tier_label — это то, что использует
        //      MatchEndPage. По дефолту для удобства MSW-демо MatchEnd ожидает
        //      готовый finished-матч; включаем его, если path содержит "end" или
        //      id заканчивается на 4821 (легаси-id из старого мока).
        const id = String(params.id ?? '');
        const finished = id === matchId || id.endsWith('4821') || id.endsWith('end');
        if (!finished) {
            return HttpResponse.json({
                id,
                status: 'active',
                mode: 'solo_1v1',
                section: 'algorithms',
                task: {
                    id: 'task-1',
                    slug: 'two-sum',
                    title: 'Two Sum',
                    description: 'Найди два числа в массиве, которые в сумме дают target.',
                    difficulty: 'easy',
                    section: 'algorithms',
                    time_limit_sec: 60,
                    memory_limit_mb: 256,
                    starter_code: { go: 'func twoSum(nums []int, target int) []int {\n  \n}' },
                },
                participants: [
                    { user_id: 'u1', username: 'hero', team: 0, elo_before: 1580 },
                    { user_id: 'u2', username: 'shadow_4821', team: 1, elo_before: 1595 },
                ],
                started_at: new Date().toISOString(),
            });
        }
        const startedAt = new Date(Date.now() - 4 * 60 * 1000).toISOString();
        const finishedAt = new Date().toISOString();
        return HttpResponse.json({
            id,
            status: 'finished',
            mode: 'solo_1v1',
            section: 'algorithms',
            winner_user_id: 'u1',
            task: {
                id: 'task-1',
                slug: 'median-sorted',
                title: 'Median of Two Sorted Arrays',
                difficulty: 'hard',
                section: 'algorithms',
                time_limit_sec: 120,
                memory_limit_mb: 256,
                starter_code: {},
            },
            participants: [
                {
                    user_id: 'u1',
                    username: 'hero',
                    team: 0,
                    elo_before: 2840,
                    elo_after: 2858,
                    solve_time_ms: 240_000,
                    suspicion_score: 0,
                    final_xp: 240,
                    xp_breakdown: [
                        { label: 'Победа в матче', amount: 120 },
                        { label: 'Под 5 минут', amount: 80 },
                        { label: 'Все тесты с 1 раза', amount: 40 },
                    ],
                    tier_label: 'Diamond III',
                    next_tier_label: 'Diamond II · 142 LP',
                },
                {
                    user_id: 'u2',
                    username: 'kirill_dev',
                    team: 1,
                    elo_before: 2855,
                    elo_after: 2837,
                    solve_time_ms: 0,
                    suspicion_score: 0,
                    final_xp: 20,
                    xp_breakdown: [{ label: 'За участие', amount: 20 }],
                    tier_label: 'Diamond III',
                    next_tier_label: 'Diamond II · 163 LP',
                },
            ],
            started_at: startedAt,
            finished_at: finishedAt,
        });
    }),
    http.post(`${base}/arena/match/:id/submit`, () => HttpResponse.json({
        passed: true,
        tests_total: 8,
        tests_passed: 8,
        failed_cases: [],
        runtime_ms: 42,
        memory_kb: 2040,
    })),
];
