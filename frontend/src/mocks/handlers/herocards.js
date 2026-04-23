import { http, HttpResponse } from 'msw';
const base = '/api/v1';
const cards = [
    { id: 'h1', name: '@alexey', tier: 'Grandmaster', tag: 'Algorithms', rarity: 'mythic', power: 987, duplicate: false, initials: 'A', gradient: 'gold', description: 'Легенда сезонов 1-4. Решил 4 200+ задач, чемпион EU финалов.', stats: { atk: 987, def: 642, spd: 823 }, global_rank: '#1 global' },
    { id: 'h2', name: '@kirill_dev', tier: 'Diamond I', tag: 'Strings', rarity: 'epic', power: 842, duplicate: false, initials: 'K', gradient: 'pink-violet' },
    { id: 'h3', name: '@you', tier: 'Diamond III', tag: 'DP', rarity: 'legendary', power: 768, duplicate: false, initials: 'Y', gradient: 'gold' },
    { id: 'h4', name: '@nastya', tier: 'Platinum I', tag: 'Graph', rarity: 'rare', power: 612, duplicate: true, initials: 'N', gradient: 'cyan-violet' },
    { id: 'h5', name: '@vasya', tier: 'Gold II', tag: 'Trees', rarity: 'common', power: 421, duplicate: false, initials: 'V', gradient: 'violet-cyan' },
    { id: 'h6', name: '@anton', tier: 'Diamond II', tag: 'Algorithms', rarity: 'epic', power: 798, duplicate: false, initials: 'A', gradient: 'pink-violet' },
    { id: 'h7', name: '@lera', tier: 'Platinum III', tag: 'SQL', rarity: 'rare', power: 588, duplicate: true, initials: 'L', gradient: 'cyan-violet' },
    { id: 'h8', name: '@misha', tier: 'Diamond IV', tag: 'System', rarity: 'legendary', power: 712, duplicate: false, initials: 'M', gradient: 'gold' },
    { id: 'h9', name: '@denis', tier: 'Gold I', tag: 'Math', rarity: 'common', power: 388, duplicate: false, initials: 'D', gradient: 'violet-cyan' },
    { id: 'h10', name: '???', tier: 'Locked', tag: '—', rarity: 'locked', power: 0, duplicate: false, initials: '?', gradient: 'violet-cyan' },
    { id: 'h11', name: '@yulia', tier: 'Platinum II', tag: 'Hash', rarity: 'rare', power: 561, duplicate: false, initials: 'Y', gradient: 'cyan-violet' },
    { id: 'h12', name: '???', tier: 'Locked', tag: '—', rarity: 'locked', power: 0, duplicate: false, initials: '?', gradient: 'violet-cyan' },
    { id: 'h13', name: '@oleg', tier: 'Diamond III', tag: 'Greedy', rarity: 'epic', power: 803, duplicate: true, initials: 'O', gradient: 'pink-violet' },
    { id: 'h14', name: '@tanya_eng', tier: 'Gold III', tag: 'Strings', rarity: 'common', power: 359, duplicate: false, initials: 'T', gradient: 'violet-cyan' },
    { id: 'h15', name: '???', tier: 'Locked', tag: '—', rarity: 'locked', power: 0, duplicate: false, initials: '?', gradient: 'violet-cyan' },
];
export const heroCardsHandlers = [
    http.get(`${base}/herocards`, () => HttpResponse.json({
        total: 47,
        unlocked: 23,
        duplicates: 6,
        showcase: 5,
        showcase_max: 5,
        pack_price: 1500,
        cards,
        selected_id: 'h1',
        trades: [
            { from: '@vasya', want: 'Epic+', delta: '~600 💎' },
            { from: '@lera', want: 'Rare swap', delta: '0' },
            { from: '@oleg', want: 'Legendary', delta: '+200 💎' },
        ],
    })),
];
