import { http, HttpResponse } from 'msw';
const base = '/api/v1';
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
    http.get(`${base}/guild/my`, () => HttpResponse.json(guild)),
    http.get(`${base}/guild/:id`, () => HttpResponse.json(guild)),
    http.get(`${base}/guild/:id/war`, () => HttpResponse.json(war)),
    http.post(`${base}/guild/:id/war/contribute`, () => HttpResponse.json(war)),
];
