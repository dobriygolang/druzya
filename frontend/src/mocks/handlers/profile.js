import { http, HttpResponse } from 'msw';
const base = '/api/v1';
const profileFull = {
    id: '00000000-0000-0000-0000-000000000001',
    username: 'hero',
    display_name: 'Aleksei',
    email: 'hero@druz9.dev',
    level: 24,
    xp: 3620,
    xp_to_next: 4800,
    char_class: 'ascendant',
    title: 'Vessel of the Crimson Sigil',
    attributes: { intellect: 82, strength: 74, dexterity: 91, will: 67 },
    global_power_score: 1584,
    career_stage: 'senior',
    subscription: { plan: 'seeker', current_period_end: '2026-06-01T00:00:00Z' },
    // Mock-only: dev can override via localStorage('druz9_user_tier'). The
    // actual response interpolates the override at request time (see handler).
    tier: 'free',
    ai_credits: 240,
    created_at: '2025-11-14T10:00:00Z',
    avatar_frame: 'crimson_sigil',
    achievements: [
        {
            key: 'avito_cleared',
            title: 'Avito Dungeon Cleared',
            description: 'Пройдено Normal подземелье',
            earned_at: '2026-02-14T00:00:00Z',
        },
        {
            key: 'first_arena_win',
            title: 'Первая кровь',
            description: 'Победа в первой арене 1v1',
            earned_at: '2026-01-28T00:00:00Z',
        },
        {
            key: 'streak_7',
            title: 'Неделя без пропуска',
            description: 'Streak 7 дней',
            earned_at: '2026-02-05T00:00:00Z',
        },
        {
            key: 'dp_master',
            title: 'Мастер DP',
            description: '10 Medium задач на динамическое программирование',
            earned_at: '2026-03-10T00:00:00Z',
        },
    ],
};
const atlas = {
    center_node: 'ascendant',
    nodes: [
        { key: 'ascendant', title: 'Ascendant', section: 'algorithms', kind: 'ascendant', progress: 82, unlocked: true, decaying: false, description: 'Центр класса — ось твоего пути' },
        { key: 'algo_dp', title: 'Dynamic Programming', section: 'algorithms', kind: 'keystone', progress: 74, unlocked: true, decaying: false, description: 'Memoization, Bottom-up' },
        { key: 'algo_graphs', title: 'Graphs', section: 'algorithms', kind: 'normal', progress: 55, unlocked: true, decaying: true, description: 'BFS, DFS, Dijkstra' },
        { key: 'sql_windows', title: 'Window functions', section: 'sql', kind: 'keystone', progress: 62, unlocked: true, decaying: false, description: 'ROW_NUMBER, LAG, LEAD' },
        { key: 'go_concurrency', title: 'Concurrency', section: 'go', kind: 'keystone', progress: 71, unlocked: true, decaying: false, description: 'goroutines, channels' },
        { key: 'sd_scaling', title: 'Horizontal scaling', section: 'system_design', kind: 'normal', progress: 20, unlocked: false, decaying: false, description: '' },
        { key: 'beh_leadership', title: 'Leadership', section: 'behavioral', kind: 'normal', progress: 35, unlocked: true, decaying: false, description: '' },
        // STUB: denser atlas sample for layout demo
        { key: 'algo_bigo', title: 'Big-O Literate', section: 'algorithms', kind: 'normal', progress: 88, unlocked: true, decaying: false, description: 'Амортизированная сложность, master-theorem' },
        { key: 'sql_indexes', title: 'Index Whisperer', section: 'sql', kind: 'normal', progress: 47, unlocked: true, decaying: false, description: 'B-tree, covering, partial' },
        { key: 'sql_cte', title: 'CTE Architect', section: 'sql', kind: 'normal', progress: 30, unlocked: false, decaying: false, description: 'Recursive CTE, materialization' },
        { key: 'go_context', title: 'Context Keeper', section: 'go', kind: 'normal', progress: 58, unlocked: true, decaying: false, description: 'Cancellation, deadlines, values' },
        { key: 'go_profiler', title: 'Zero-Alloc Rune', section: 'go', kind: 'normal', progress: 15, unlocked: false, decaying: false, description: 'pprof, escape-analysis' },
        { key: 'sd_cap', title: 'CAP Triad', section: 'system_design', kind: 'keystone', progress: 10, unlocked: false, decaying: false, description: 'Consistency / Availability / Partition' },
        { key: 'beh_star', title: 'STAR Recall', section: 'behavioral', kind: 'normal', progress: 62, unlocked: true, decaying: false, description: 'Structured storytelling' },
        { key: 'beh_conflict', title: 'Conflict Harmony', section: 'behavioral', kind: 'keystone', progress: 44, unlocked: true, decaying: true, description: 'De-escalation, leadership aura' },
    ],
    edges: [
        { from: 'ascendant', to: 'algo_dp' },
        { from: 'ascendant', to: 'sql_windows' },
        { from: 'ascendant', to: 'go_concurrency' },
        { from: 'ascendant', to: 'sd_scaling' },
        { from: 'ascendant', to: 'beh_leadership' },
        { from: 'algo_dp', to: 'algo_graphs' },
        // STUB: denser atlas sample for layout demo
        { from: 'ascendant', to: 'algo_bigo' },
        { from: 'sql_windows', to: 'sql_indexes' },
        { from: 'sql_indexes', to: 'sql_cte' },
        { from: 'go_concurrency', to: 'go_context' },
        { from: 'go_context', to: 'go_profiler' },
        { from: 'sd_scaling', to: 'sd_cap' },
        { from: 'beh_leadership', to: 'beh_star' },
        { from: 'beh_leadership', to: 'beh_conflict' },
    ],
};
const weeklyReport = {
    week_start: '2026-04-13',
    week_end: '2026-04-19',
    metrics: { tasks_solved: 23, matches_won: 12, rating_change: 18, xp_earned: 2480, time_minutes: 340 },
    heatmap: [2, 3, 4, 1, 3, 2, 0],
    strengths: ['Dynamic Programming', 'SQL Window Functions'],
    weaknesses: [
        { atlas_node_key: 'sd_scaling', reason: 'Пропал 8 дней, начинается декей' },
        { atlas_node_key: 'algo_graphs', reason: 'Медленное решение Dijkstra' },
    ],
    stress_analysis: 'На этой неделе ты делаешь плохие решения когда таймер < 5 мин — 4 из 5 проигрышей пришлись на цейтнот. Попробуй замедлиться в первой половине: 60 секунд на план перед кодом.',
    recommendations: [
        { title: 'Решить 5 DP задач (medium)', action: { kind: 'solve_task', params: { atlas_node_key: 'algo_dp' } } },
        { title: 'Mock interview по System Design', action: { kind: 'start_mock', params: { section: 'system_design' } } },
        { title: 'Replay 3 проигрыша из истории', action: { kind: 'open_arena', params: {} } },
    ],
    // Поля, которые добавились вместе с расширением WeeklyReport-proto.
    actions_count: 47,
    streak_days: 12,
    best_streak: 47,
    prev_xp_earned: 1690,
    strong_sections: [
        { section: 'algorithms', matches: 9, wins: 7, losses: 2, xp_delta: 340, win_rate_pct: 78 },
        { section: 'sql', matches: 6, wins: 4, losses: 2, xp_delta: 220, win_rate_pct: 67 },
        { section: 'go', matches: 4, wins: 3, losses: 1, xp_delta: 180, win_rate_pct: 75 },
    ],
    weak_sections: [
        { section: 'system_design', matches: 3, wins: 1, losses: 2, xp_delta: -80, win_rate_pct: 33 },
        { section: 'behavioral', matches: 2, wins: 1, losses: 1, xp_delta: -40, win_rate_pct: 50 },
    ],
    weekly_xp: [
        { label: 'Эта', xp: 2480, pct: 100 },
        { label: '-1', xp: 1690, pct: 68 },
        { label: '-2', xp: 2010, pct: 81 },
        { label: '-3', xp: 1240, pct: 50 },
    ],
};
export const profileHandlers = [
    http.get(`${base}/profile/me`, () => {
        let tier = 'free';
        try {
            const v = typeof localStorage !== 'undefined' ? localStorage.getItem('druz9_user_tier') : null;
            if (v === 'premium' || v === 'pro' || v === 'free')
                tier = v;
        }
        catch {
            /* noop */
        }
        return HttpResponse.json({ ...profileFull, tier });
    }),
    http.get(`${base}/profile/me/atlas`, () => HttpResponse.json(atlas)),
    http.get(`${base}/profile/me/report`, () => HttpResponse.json(weeklyReport)),
    http.get(`${base}/profile/:username`, ({ params }) => HttpResponse.json({
        username: params.username,
        display_name: 'Aleksei',
        title: profileFull.title,
        level: profileFull.level,
        char_class: profileFull.char_class,
        career_stage: profileFull.career_stage,
        global_power_score: profileFull.global_power_score,
        ratings: [
            { section: 'algorithms', elo: 1620, matches_count: 42, percentile: 88, decaying: false },
            { section: 'sql', elo: 1510, matches_count: 18, percentile: 76, decaying: false },
            { section: 'go', elo: 1680, matches_count: 31, percentile: 92, decaying: false },
        ],
        achievements: [
            { key: 'avito_cleared', title: 'Avito Dungeon Cleared', description: 'Пройдено Normal подземелье', earned_at: '2026-02-14T00:00:00Z' },
        ],
        atlas_preview: atlas,
    })),
];
