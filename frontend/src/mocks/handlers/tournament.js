import { http, HttpResponse } from 'msw';
const base = '/api/v1';
export const tournamentHandlers = [
    http.get(`${base}/tournament/:id`, ({ params }) => HttpResponse.json({
        id: params.id,
        name: 'Dragonfire Open',
        tier: 'WEEKLY CUP · DIAMOND TIER',
        format: 'Round of 16 · Single Elimination · BO3',
        prize_pool: 50000,
        finals_in: '02:14:38',
        registered: true,
        participants: 16,
        total_matches: 8,
        bracket: {
            r16: [
                { p1: '@alexey', p2: '@dmitry', s1: 2, s2: 0 },
                { p1: '@kirill_dev', p2: '@you', s1: 1, s2: 1, live: true, yours: true },
                { p1: '@nastya', p2: '@misha', s1: 2, s2: 1 },
                { p1: '@vasya', p2: '@artem', s1: 0, s2: 2 },
                { p1: '@elena', p2: '@petr', s1: 2, s2: 0 },
                { p1: '@ivan', p2: '@sergey', s1: 1, s2: 2 },
                { p1: '@olga', p2: '@gleb', s1: 2, s2: 1 },
                { p1: '@yana', p2: '@boris', s1: 0, s2: 2 },
            ],
            qf: [
                { p1: '@alexey', p2: 'TBD', tbd: true },
                { p1: 'TBD', p2: 'TBD', tbd: true },
                { p1: '@elena', p2: 'TBD', tbd: true },
                { p1: '@olga', p2: 'TBD', tbd: true },
            ],
            sf: [
                { p1: 'TBD', p2: 'TBD', tbd: true },
                { p1: 'TBD', p2: 'TBD', tbd: true },
            ],
        },
        next_match: {
            opponent: '@kirill_dev',
            in: 'Через 2ч 14м · BO3',
        },
        predictions: [
            { label: '@kirill vs @you', odds: ['@kirill 1.4x', '@you 2.8x'], yours: true },
            { label: '@alexey vs @dmitry', odds: ['@alexey 1.2x', '@dmitry 3.2x'] },
            { label: '@nastya vs @misha', odds: ['@nastya 1.6x', '@misha 2.4x'] },
        ],
        standings: [
            { rank: 1, name: '@oracle_max', score: '+820 💎' },
            { rank: 2, name: '@bet_master', score: '+640 💎' },
            { rank: 3, name: '@you', score: '+320 💎', you: true },
        ],
    })),
];
