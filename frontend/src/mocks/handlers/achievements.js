import { http, HttpResponse } from 'msw';
const base = '/api/v1';
const achievements = [
    { id: 'speed-demon', name: 'Speed Demon', progress: '10 / 10', rarity: 'legendary', unlocked: true, locked: false, description: 'Решить 10 Medium-задач подряд за время менее 5 минут каждая.', reward: '+500 XP · +Title "Speed Demon"' },
    { id: 'first-blood', name: 'First Blood', progress: '1 / 1', rarity: 'common', unlocked: true, locked: false },
    { id: 'streak-master', name: 'Streak Master', progress: '12 / 30', rarity: 'rare', unlocked: false, locked: false },
    { id: 'iron-defender', name: 'Iron Defender', progress: '5 / 10', rarity: 'rare', unlocked: false, locked: false },
    { id: 'algo-sage', name: 'Algorithm Sage', progress: '50 / 50', rarity: 'legendary', unlocked: true, locked: false },
    { id: 'trophy-hunter', name: 'Trophy Hunter', progress: '23 / 47', rarity: 'rare', unlocked: false, locked: false },
    { id: 'champion', name: 'Champion', progress: '1 / 1', rarity: 'legendary', unlocked: true, locked: false },
    { id: 'daily-hero', name: 'Daily Hero', progress: '30 / 30', rarity: 'common', unlocked: true, locked: false },
    { id: 'code-warrior', name: 'Code Warrior', progress: '100 / 100', rarity: 'rare', unlocked: true, locked: false },
    { id: 'spark-caster', name: 'Spark Caster', progress: '7 / 20', rarity: 'common', unlocked: false, locked: false },
    { id: 'guardian', name: 'Guardian', progress: '15 / 25', rarity: 'rare', unlocked: false, locked: false },
    { id: 'inferno', name: 'Inferno', progress: '40 / 50', rarity: 'legendary', unlocked: false, locked: false },
    { id: 'l1', name: '???', progress: '— / —', rarity: 'common', unlocked: false, locked: true },
    { id: 'l2', name: '???', progress: '— / —', rarity: 'rare', unlocked: false, locked: true },
    { id: 'l3', name: '???', progress: '— / —', rarity: 'legendary', unlocked: false, locked: true },
    { id: 'l4', name: '???', progress: '— / —', rarity: 'common', unlocked: false, locked: true },
];
export const achievementsHandlers = [
    http.get(`${base}/achievements`, () => HttpResponse.json({
        total: 47,
        unlocked: 23,
        rare_count: 6,
        counts: { common: 30, rare: 12, legendary: 5, hidden: 12 },
        featured_id: 'speed-demon',
        items: achievements,
    })),
];
