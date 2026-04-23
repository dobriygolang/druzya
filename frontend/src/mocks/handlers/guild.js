import { http, HttpResponse } from 'msw';
const base = '/api/v1';
// In-memory state — flipped by the join/leave/create handlers below so MSW
// users see consistent before/after behaviour without reload tricks.
const state = {
    inGuild: false,
};
const guild = {
    id: 'guild-1',
    name: 'The Crimson Recursion',
    emblem: 'sigil-crimson',
    guild_elo: 1620,
    members: [
        { user_id: 'u1', username: 'hero', role: 'captain', joined_at: '2026-01-10T00:00:00Z', assigned_section: 'algorithms' },
        { user_id: 'u2', username: 'shadow_777', role: 'member', joined_at: '2026-01-12T00:00:00Z', assigned_section: 'sql' },
        { user_id: 'u3', username: 'void_caller', role: 'member', joined_at: '2026-02-01T00:00:00Z', assigned_section: 'go' },
    ],
    current_war_id: 'war-1',
};
const publicGuilds = [
    {
        id: 'guild-1',
        name: 'The Crimson Recursion',
        emblem: '',
        description: 'Algoritmы и Go — два священных столпа.',
        tier: 'gold',
        guild_elo: 1620,
        members_count: 18,
        max_members: 25,
        join_policy: 'open',
        is_public: true,
        wars_won: 7,
    },
    {
        id: 'guild-2',
        name: 'Ashen Order',
        emblem: '',
        description: 'SQL-маги, ловцы N+1.',
        tier: 'silver',
        guild_elo: 1480,
        members_count: 12,
        max_members: 25,
        join_policy: 'open',
        is_public: true,
        wars_won: 3,
    },
    {
        id: 'guild-3',
        name: 'System Design Sect',
        emblem: '',
        description: 'Куем CAP-теорему по понедельникам.',
        tier: 'platinum',
        guild_elo: 1850,
        members_count: 22,
        max_members: 25,
        join_policy: 'invite',
        is_public: true,
        wars_won: 11,
    },
    {
        id: 'guild-4',
        name: 'Behavioral Brotherhood',
        emblem: '',
        description: 'STAR-методология как религия.',
        tier: 'bronze',
        guild_elo: 1180,
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
    guild_a: { id: 'guild-1', name: guild.name, emblem: guild.emblem },
    guild_b: { id: 'guild-2', name: 'Ashen Order', emblem: 'sigil-ashen' },
    lines: [
        { section: 'algorithms', score_a: 420, score_b: 380, contributors: [] },
        { section: 'sql', score_a: 210, score_b: 260, contributors: [] },
        { section: 'go', score_a: 340, score_b: 300, contributors: [] },
        { section: 'system_design', score_a: 180, score_b: 220, contributors: [] },
        { section: 'behavioral', score_a: 120, score_b: 100, contributors: [] },
    ],
    winner_guild_id: null,
};
export const guildHandlers = [
    http.get(`${base}/guild/my`, () => {
        if (!state.inGuild)
            return new HttpResponse(null, { status: 404 });
        return HttpResponse.json(guild);
    }),
    // /guild/list — public discovery list with search + tier filter.
    http.get(`${base}/guild/list`, ({ request }) => {
        const url = new URL(request.url);
        const search = url.searchParams.get('search')?.toLowerCase().trim() ?? '';
        const tier = url.searchParams.get('tier')?.trim() ?? '';
        const filtered = publicGuilds.filter((g) => {
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
    // POST /guild — create.
    http.post(`${base}/guild`, async ({ request }) => {
        const body = (await request.json());
        if (state.inGuild) {
            return HttpResponse.json({ error: { message: 'user already in a guild' } }, { status: 409 });
        }
        const name = String(body['name'] ?? '').trim();
        if (name.length < 3 || name.length > 32) {
            return HttpResponse.json({ error: { message: 'name must be 3..32 characters' } }, { status: 400 });
        }
        state.inGuild = true;
        return HttpResponse.json({
            guild: {
                id: 'new-guild-' + Math.random().toString(36).slice(2, 8),
                name,
                emblem: '',
                description: String(body['description'] ?? ''),
                tier: String(body['tier'] ?? 'bronze'),
                guild_elo: 1000,
                members_count: 1,
                max_members: Number(body['max_members'] ?? 25),
                join_policy: String(body['join_policy'] ?? 'open'),
                is_public: true,
                wars_won: 0,
            },
        }, { status: 201 });
    }),
    // POST /guild/:id/join.
    http.post(`${base}/guild/:id/join`, ({ params }) => {
        const id = String(params['id']);
        const target = publicGuilds.find((g) => g.id === id);
        if (!target) {
            return HttpResponse.json({ error: { message: 'guild not found' } }, { status: 404 });
        }
        if (state.inGuild) {
            return HttpResponse.json({ error: { message: 'user already in a guild' } }, { status: 409 });
        }
        if (target.join_policy === 'closed') {
            return HttpResponse.json({ error: { message: 'guild is closed' } }, { status: 403 });
        }
        if (target.join_policy === 'invite') {
            return HttpResponse.json({ status: 'pending', guild_id: id, pending: true });
        }
        state.inGuild = true;
        return HttpResponse.json({ status: 'joined', guild_id: id });
    }),
    // POST /guild/:id/leave.
    http.post(`${base}/guild/:id/leave`, ({ params }) => {
        state.inGuild = false;
        return HttpResponse.json({ status: 'left', guild_id: String(params['id']) });
    }),
    http.get(`${base}/guild/:id`, () => HttpResponse.json(guild)),
    http.get(`${base}/guild/:id/war`, () => HttpResponse.json(war)),
    http.post(`${base}/guild/:id/war/contribute`, () => HttpResponse.json(war)),
];
