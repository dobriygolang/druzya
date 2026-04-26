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
// Synthetic insights overview for the dev preview — production hits
// /api/v1/mock/insights/overview against the chi-direct handler. Without
// this MSW handler the frontend MSW worker returns 404 and all three
// /insights cards render empty-state. Numbers below are stable enough
// for design review; AI summary is canned (real prod uses LLMChain).
const insightsOverview = {
    window_days: 30,
    stage_performance: [
        { stage_kind: 'hr', total: 6, passed: 5, pass_rate: 83 },
        { stage_kind: 'algo', total: 4, passed: 2, pass_rate: 50 },
        { stage_kind: 'coding', total: 3, passed: 2, pass_rate: 66 },
        { stage_kind: 'sysdesign', total: 2, passed: 0, pass_rate: 0 },
        { stage_kind: 'behavioral', total: 4, passed: 4, pass_rate: 100 },
    ],
    recurring_patterns: [
        { point: 'rate limiting', count: 5 },
        { point: 'consistency model', count: 4 },
        { point: 'capacity estimation', count: 3 },
        { point: 'edge-case timeout handling', count: 3 },
        { point: 'monitoring & alerting', count: 2 },
    ],
    score_trajectory: [
        { pipeline_id: 'demo-1', finished_at: '2026-04-01T12:00:00Z', score: 52, verdict: 'fail' },
        { pipeline_id: 'demo-2', finished_at: '2026-04-04T12:00:00Z', score: 58, verdict: 'fail' },
        { pipeline_id: 'demo-3', finished_at: '2026-04-08T12:00:00Z', score: 64, verdict: 'pass' },
        { pipeline_id: 'demo-4', finished_at: '2026-04-12T12:00:00Z', score: 61, verdict: 'fail' },
        { pipeline_id: 'demo-5', finished_at: '2026-04-15T12:00:00Z', score: 70, verdict: 'pass' },
        { pipeline_id: 'demo-6', finished_at: '2026-04-18T12:00:00Z', score: 73, verdict: 'pass' },
        { pipeline_id: 'demo-7', finished_at: '2026-04-21T12:00:00Z', score: 68, verdict: 'fail' },
        { pipeline_id: 'demo-8', finished_at: '2026-04-24T12:00:00Z', score: 78, verdict: 'pass' },
    ],
    total_sessions_30d: 8,
    pipeline_pass_rate_30d: 62,
    summary:
        "Заметный прогресс по алгоритмам — последние две сессии стабильно за 70. System design пока проседает: нулевой pass-rate за месяц, и в фидбеках регулярно всплывает rate limiting и consistency model. На этой неделе попробуй один sysdesign-mock без AI-помощника + одну kata на rate-limiter pattern — это закроет два частых пропуска одновременно.",
};

export const mockHandlers = [
    http.get(`${base}/mock/insights/overview`, () => HttpResponse.json(insightsOverview)),
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
    })),
];
