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
    http.get(`${base}/arena/match/:id`, ({ params }) => HttpResponse.json({
        id: params.id,
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
            example_cases: [
                { input: '[2,7,11,15], 9', output: '[0,1]' },
            ],
        },
        participants: [
            { user_id: 'u1', username: 'hero', team: 0, elo_before: 1580 },
            { user_id: 'u2', username: 'shadow_4821', team: 1, elo_before: 1595 },
        ],
        started_at: new Date().toISOString(),
    })),
    http.post(`${base}/arena/match/:id/submit`, () => HttpResponse.json({
        passed: true,
        tests_total: 8,
        tests_passed: 8,
        failed_cases: [],
        runtime_ms: 42,
        memory_kb: 2040,
    })),
];
