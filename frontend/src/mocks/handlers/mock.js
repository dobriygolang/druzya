import { http, HttpResponse } from 'msw';
const base = '/api/v1';
const sessionId = 'mock-session-1';
const session = {
    id: sessionId,
    status: 'in_progress',
    company_id: 'company-ozon',
    section: 'algorithms',
    difficulty: 'medium',
    duration_min: 45,
    task: {
        id: 'task-1',
        slug: 'two-sum',
        title: 'Two Sum',
        description: 'Найди два числа в массиве, которые в сумме дают target.',
        difficulty: 'medium',
        section: 'algorithms',
        time_limit_sec: 60,
        memory_limit_mb: 256,
        starter_code: { go: 'func twoSum(nums []int, target int) []int {\n\n}' },
        example_cases: [{ input: '[2,7,11,15], 9', output: '[0,1]' }],
    },
    started_at: new Date().toISOString(),
    last_messages: [
        {
            id: 'm1',
            role: 'assistant',
            content: 'Начнём с классики. Какая сложность наивного решения?',
            created_at: new Date().toISOString(),
        },
    ],
    stress_profile: { pauses_score: 35, backspace_score: 20, chaos_score: 12, paste_attempts: 0 },
};
export const mockHandlers = [
    http.post(`${base}/mock/session`, () => HttpResponse.json(session, { status: 201 })),
    http.get(`${base}/mock/session/:id`, () => HttpResponse.json(session)),
    http.post(`${base}/mock/session/:id/message`, async ({ request }) => {
        const body = (await request.json());
        return HttpResponse.json({
            id: 'reply-' + Date.now(),
            role: 'assistant',
            content: `Хорошая идея про "${body.content.slice(0, 40)}". А как бы ты это реализовал на Go без map?`,
            tokens_used: 84,
            created_at: new Date().toISOString(),
        });
    }),
    http.post(`${base}/mock/session/:id/stress`, () => new HttpResponse(null, { status: 204 })),
    http.post(`${base}/mock/session/:id/finish`, () => HttpResponse.json({ ...session, status: 'finished', finished_at: new Date().toISOString() })),
    http.get(`${base}/mock/session/:id/report`, ({ params }) => HttpResponse.json({
        session_id: params.id,
        overall_score: 72,
        sections: {
            problem_solving: { score: 80, comment: 'Быстро увидел O(n) решение' },
            code_quality: { score: 65, comment: 'Имена переменных — слабое место' },
            communication: { score: 75, comment: 'Хорошо объяснял вслух' },
            stress_handling: { score: 60, comment: 'Нервничал на follow-up' },
        },
        strengths: ['Hash map pattern', 'Edge case awareness'],
        weaknesses: ['Naming', 'Time management'],
        recommendations: [
            { title: 'Пройди 3 медиум задачи на hash map', action: { kind: 'solve_task' } },
        ],
        stress_analysis: 'На follow-up растёт стресс — тренируй защиту решения.',
        replay_url: null,
    })),
];
