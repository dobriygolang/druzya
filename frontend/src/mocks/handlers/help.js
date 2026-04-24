import { http, HttpResponse } from 'msw';
const base = '/api/v1';
const categories = [
    { id: 'start', label: 'Старт', count: 8, kind: 'rocket' },
    { id: 'arena', label: 'Арена и матчи', count: 14, kind: 'swords' },
    { id: 'cohort', label: 'Когорты', count: 11, kind: 'shield' },
    { id: 'premium', label: 'Premium', count: 6, kind: 'crown' },
    { id: 'ai', label: 'AI настройки', count: 9, kind: 'sparkles' },
    { id: 'security', label: 'Безопасность', count: 5, kind: 'lock' },
];
const faq = [
    {
        id: 'f1',
        question: 'Как считается LP?',
        answer: 'LP начисляется за победы в ranked-матчах и зависит от разницы рейтингов соперников. Базовое значение — 20 LP, корректируется на основе MMR-формулы (Elo-подобная). Минимум +5 LP за победу, максимум +35 LP. При поражении удерживается от −12 до −22 LP.',
        tags: ['MMR vs LP', 'Сезонный сброс', 'Decay'],
    },
    { id: 'f2', question: 'Что даёт Premium?', answer: '', tags: [] },
    { id: 'f3', question: 'Как создать когорту?', answer: '', tags: [] },
    { id: 'f4', question: 'Какие AI модели доступны?', answer: '', tags: [] },
    { id: 'f5', question: 'Как работает Streak Freeze?', answer: '', tags: [] },
    { id: 'f6', question: 'Возврат денег за подписку', answer: '', tags: [] },
];
export const helpHandlers = [
    http.get(`${base}/help`, () => HttpResponse.json({
        total_articles: 53,
        categories,
        faq,
        contacts: [
            { kind: 'email', label: 'Email', value: 'help@druz9.dev' },
            { kind: 'telegram', label: 'Telegram', value: '@druz9_support' },
            { kind: 'discord', label: 'Discord', value: 'discord.gg/druz9' },
            { kind: 'github', label: 'GitHub', value: 'druz9/feedback' },
        ],
        status: 'all_systems_ok',
    })),
];
