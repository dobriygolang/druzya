import { http, HttpResponse } from 'msw';
const base = '/api/v1';
const streak = {
    current: 12,
    longest: 28,
    freeze_tokens: 2,
    history: [
        true, true, true, true, true, true, true, true, true, false, null, true, true,
        true, true, true, true, true, true, false, true, true, true, true, true, true,
        true, true, true, true,
    ],
};
const kata = {
    date: new Date().toISOString().slice(0, 10),
    task: {
        id: 'kata-1',
        slug: 'reverse-linked-list',
        title: 'Reverse Linked List',
        description: 'Разверни связный список in-place.',
        difficulty: 'easy',
        section: 'algorithms',
        time_limit_sec: 600,
        memory_limit_mb: 256,
        starter_code: { go: 'func reverseList(head *ListNode) *ListNode {\n\n}' },
        example_cases: [{ input: '1→2→3→4→5', output: '5→4→3→2→1' }],
    },
    is_cursed: false,
    is_weekly_boss: false,
    already_submitted: false,
};
const calendar = {
    id: 'cal-1',
    company_id: 'company-yandex',
    role: 'Backend Go Developer',
    interview_date: '2026-05-10',
    days_left: 20,
    readiness_pct: 62,
    today: [
        { kind: 'solve_task', title: '2 медиум задачи на DP', estimated_min: 45, done: false },
        { kind: 'podcast', title: 'Подкаст про Kafka', estimated_min: 25, done: true },
    ],
    week_plan: [],
    weak_zones: [
        { atlas_node_key: 'sd_scaling', priority: 'high' },
        { atlas_node_key: 'algo_graphs', priority: 'medium' },
    ],
};
export const dailyHandlers = [
    http.get(`${base}/daily/kata`, () => HttpResponse.json(kata)),
    http.post(`${base}/daily/kata/submit`, () => HttpResponse.json({ passed: true, tests_passed: 5, tests_total: 5, xp_earned: 30, streak })),
    // /daily/run — dry-grade execution (no streak side-effect). Mirrors the
    // backend chi-handler shape so the editor's "Run" button works in MSW too.
    http.post(`${base}/daily/run`, () => HttpResponse.json({
        passed: true,
        total: 5,
        output: 'PASS — 5/5 test cases passed in 42ms',
        time_ms: 42,
    })),
    http.get(`${base}/daily/streak`, () => HttpResponse.json(streak)),
    http.get(`${base}/daily/calendar`, () => HttpResponse.json(calendar)),
    http.post(`${base}/daily/calendar`, () => HttpResponse.json(calendar)),
    http.post(`${base}/daily/autopsy`, () => HttpResponse.json({
        id: 'autopsy-1',
        status: 'processing',
        outcome: 'rejection',
        created_at: new Date().toISOString(),
    }, { status: 201 })),
    http.get(`${base}/daily/autopsy/:id`, ({ params }) => HttpResponse.json({
        id: params.id,
        status: 'ready',
        outcome: 'rejection',
        failure_reason: 'Не проверил edge case с пустым массивом',
        what_to_say: 'Стоило начать с валидации входа и проговорить инварианты',
        weak_atlas_nodes: ['algo_edge_cases'],
        recovery_plan: [
            { title: 'Решить 5 Easy задач с пустыми массивами', action: { kind: 'solve_task' } },
        ],
        share_url: 'https://druz9.online/autopsy/anonymous-1',
        created_at: new Date().toISOString(),
    })),
];
