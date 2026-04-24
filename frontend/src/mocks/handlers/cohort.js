import { http, HttpResponse } from 'msw';
const base = '/api/v1';
// In-memory state — flipped by the join/leave/create handlers below so MSW
// users see consistent before/after behaviour without reload tricks.
const state = {
    inCohort: false,
};
const cohort = {
    id: 'cohort-1',
    name: 'The Crimson Recursion',
    emblem: 'sigil-crimson',
    cohort_elo: 1620,
    members: [
        { user_id: 'u1', username: 'hero', role: 'captain', joined_at: '2026-01-10T00:00:00Z', assigned_section: 'algorithms' },
        { user_id: 'u2', username: 'shadow_777', role: 'member', joined_at: '2026-01-12T00:00:00Z', assigned_section: 'sql' },
        { user_id: 'u3', username: 'void_caller', role: 'member', joined_at: '2026-02-01T00:00:00Z', assigned_section: 'go' },
    ],
    current_war_id: 'war-1',
};
const publicCohorts = [
    {
        id: 'cohort-1',
        name: 'The Crimson Recursion',
        emblem: '',
        description: 'Algoritmы и Go — два священных столпа.',
        tier: 'gold',
        cohort_elo: 1620,
        members_count: 18,
        max_members: 25,
        join_policy: 'open',
        is_public: true,
        wars_won: 7,
    },
    {
        id: 'cohort-2',
        name: 'Ashen Order',
        emblem: '',
        description: 'SQL-маги, ловцы N+1.',
        tier: 'silver',
        cohort_elo: 1480,
        members_count: 12,
        max_members: 25,
        join_policy: 'open',
        is_public: true,
        wars_won: 3,
    },
    {
        id: 'cohort-3',
        name: 'System Design Sect',
        emblem: '',
        description: 'Куем CAP-теорему по понедельникам.',
        tier: 'platinum',
        cohort_elo: 1850,
        members_count: 22,
        max_members: 25,
        join_policy: 'invite',
        is_public: true,
        wars_won: 11,
    },
    {
        id: 'cohort-4',
        name: 'Behavioral Brotherhood',
        emblem: '',
        description: 'STAR-методология как религия.',
        tier: 'bronze',
        cohort_elo: 1180,
        members_count: 6,
        max_members: 25,
        join_policy: 'open',
        is_public: true,
        wars_won: 1,
    },
];
const war = {
    id: 'war-1',
    week_start: '2026-04-14',
    week_end: '2026-04-21',
    cohort_a: { id: 'cohort-1', name: cohort.name, emblem: cohort.emblem },
    cohort_b: { id: 'cohort-2', name: 'Ashen Order', emblem: 'sigil-ashen' },
    lines: [
        { section: 'algorithms', score_a: 420, score_b: 380, contributors: [] },
        { section: 'sql', score_a: 210, score_b: 260, contributors: [] },
        { section: 'go', score_a: 340, score_b: 300, contributors: [] },
        { section: 'system_design', score_a: 180, score_b: 220, contributors: [] },
        { section: 'behavioral', score_a: 120, score_b: 100, contributors: [] },
    ],
    winner_cohort_id: null,
};
export const cohortHandlers = [
    http.get(`${base}/cohort/my`, () => {
        if (!state.inCohort)
            return new HttpResponse(null, { status: 404 });
        return HttpResponse.json(cohort);
    }),
    // /cohort/list — public discovery list with search + tier filter.
    http.get(`${base}/cohort/list`, ({ request }) => {
        const url = new URL(request.url);
        const search = url.searchParams.get('search')?.toLowerCase().trim() ?? '';
        const tier = url.searchParams.get('tier')?.trim() ?? '';
        const filtered = publicCohorts.filter((g) => {
            if (search && !g.name.toLowerCase().includes(search))
                return false;
            if (tier && g.tier !== tier)
                return false;
            return true;
        });
        return HttpResponse.json({
            items: filtered,
            total: filtered.length,
            page: 1,
            page_size: filtered.length,
        });
    }),
    // POST /cohort — create.
    http.post(`${base}/cohort`, async ({ request }) => {
        const body = (await request.json());
        if (state.inCohort) {
            return HttpResponse.json({ error: { message: 'user already in a cohort' } }, { status: 409 });
        }
        const name = String(body['name'] ?? '').trim();
        if (name.length < 3 || name.length > 32) {
            return HttpResponse.json({ error: { message: 'name must be 3..32 characters' } }, { status: 400 });
        }
        state.inCohort = true;
        return HttpResponse.json({
            cohort: {
                id: 'new-cohort-' + Math.random().toString(36).slice(2, 8),
                name,
                emblem: '',
                description: String(body['description'] ?? ''),
                tier: String(body['tier'] ?? 'bronze'),
                cohort_elo: 1000,
                members_count: 1,
                max_members: Number(body['max_members'] ?? 25),
                join_policy: String(body['join_policy'] ?? 'open'),
                is_public: true,
                wars_won: 0,
            },
        }, { status: 201 });
    }),
    // POST /cohort/:id/join.
    http.post(`${base}/cohort/:id/join`, ({ params }) => {
        const id = String(params['id']);
        const target = publicCohorts.find((g) => g.id === id);
        if (!target) {
            return HttpResponse.json({ error: { message: 'cohort not found' } }, { status: 404 });
        }
        if (state.inCohort) {
            return HttpResponse.json({ error: { message: 'user already in a cohort' } }, { status: 409 });
        }
        if (target.join_policy === 'closed') {
            return HttpResponse.json({ error: { message: 'cohort is closed' } }, { status: 403 });
        }
        if (target.join_policy === 'invite') {
            return HttpResponse.json({ status: 'pending', cohort_id: id, pending: true });
        }
        state.inCohort = true;
        return HttpResponse.json({ status: 'joined', cohort_id: id });
    }),
    // POST /cohort/:id/leave.
    http.post(`${base}/cohort/:id/leave`, ({ params }) => {
        state.inCohort = false;
        return HttpResponse.json({ status: 'left', cohort_id: String(params['id']) });
    }),
    http.get(`${base}/cohort/:id`, () => HttpResponse.json(cohort)),
    http.get(`${base}/cohort/:id/war`, () => HttpResponse.json(war)),
    http.post(`${base}/cohort/:id/war/contribute`, () => HttpResponse.json(war)),
];
