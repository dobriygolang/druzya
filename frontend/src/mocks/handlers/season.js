import { http, HttpResponse } from 'msw';
const base = '/api/v1';
const season = {
    id: 'season-ii',
    title: 'Season II · The Recursion',
    codename: 'the_recursion',
    started_at: '2026-03-01T00:00:00Z',
    ends_at: '2026-05-31T00:00:00Z',
    current_tier: 18,
    current_sp: 2140,
    tier_max: 40,
    checkpoints: [
        { tier: 16, reward: 'Avatar Frame', reward_kind: 'avatar_frame', done: true },
        { tier: 17, reward: '200 AI Credits', reward_kind: 'credits', done: true },
        {
            tier: 18,
            reward: 'Aura: Ember',
            reward_kind: 'cosmetic',
            done: true,
            current: true,
        },
        { tier: 19, reward: 'Title: Seeker', reward_kind: 'title', done: false },
        {
            tier: 20,
            reward: 'Cohort Emblem',
            reward_kind: 'emblem',
            done: false,
            big: true,
        },
        { tier: 21, reward: '500 AI Credits', reward_kind: 'credits', done: false },
        { tier: 22, reward: 'Badge: Survivor', reward_kind: 'badge', done: false },
        { tier: 25, reward: 'Avatar Frame: Crimson', reward_kind: 'avatar_frame', done: false },
        { tier: 30, reward: 'Title: Recursor', reward_kind: 'title', done: false, big: true },
        { tier: 40, reward: 'Unique Emblem', reward_kind: 'emblem', done: false, big: true },
    ],
    modifiers: [
        {
            key: 'recursion',
            title: 'Рекурсия',
            description: 'Daily kata каждые 6 часов — не 24.',
        },
        {
            key: 'crimson_tide',
            title: 'Crimson Tide',
            description: '+15% к XP в арене, −5% HP на старте.',
        },
    ],
};
export const seasonHandlers = [
    http.get(`${base}/season/current`, () => HttpResponse.json(season)),
    http.post(`${base}/season/claim/:tier`, ({ params }) => {
        const tier = Number(params.tier);
        const cp = season.checkpoints.find((c) => c.tier === tier);
        if (!cp || !cp.done) {
            return new HttpResponse('not-unlockable', { status: 409 });
        }
        cp.claimed = true;
        return HttpResponse.json({ tier, claimed: true });
    }),
];
