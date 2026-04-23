import { http, HttpResponse } from 'msw';
const base = '/api/v1';
const companies = [
    { id: 'avito', name: 'Avito', initial: 'A', color: '#10B981', tasks: 40, sections: 5, hours: 12, progress: 78, tags: ['Algorithms', 'SQL'], locked: false, tier: 'normal' },
    { id: 'vk', name: 'VK', initial: 'В', color: '#22D3EE', tasks: 38, sections: 5, hours: 11, progress: 62, tags: ['Algorithms', 'System'], locked: false, tier: 'normal' },
    { id: 'sber', name: 'Сбер', initial: 'С', color: '#10B981', tasks: 42, sections: 6, hours: 13, progress: 45, tags: ['Java', 'SQL'], locked: false, tier: 'normal' },
    { id: 'wb', name: 'Wildberries', initial: 'W', color: '#F472B6', tasks: 35, sections: 5, hours: 10, progress: 12, tags: ['Go', 'Concurrency'], locked: false, tier: 'normal' },
    { id: 'mailru', name: 'Mail.ru', initial: 'M', color: '#582CFF', tasks: 36, sections: 5, hours: 10, progress: 0, tags: ['Algorithms'], locked: true, tier: 'normal' },
    { id: 'hh', name: 'HH', initial: 'H', color: '#FBBF24', tasks: 30, sections: 4, hours: 8, progress: 0, tags: ['Frontend', 'JS'], locked: false, tier: 'normal' },
    { id: 'ozon', name: 'Ozon', initial: 'O', color: '#582CFF', tasks: 60, sections: 6, hours: 18, progress: 32, tags: ['Backend', 'DB'], locked: false, tier: 'hard' },
    { id: 'tinkoff-jr', name: 'Tinkoff Junior', initial: 'T', color: '#FBBF24', tasks: 55, sections: 6, hours: 16, progress: 28, tags: ['Java', 'Spring'], locked: false, tier: 'hard' },
    { id: 'practicum', name: 'Yandex Practicum', initial: 'Я', color: '#EF4444', tasks: 50, sections: 5, hours: 15, progress: 15, tags: ['Algorithms'], locked: false, tier: 'hard' },
    { id: 'skyeng', name: 'Skyeng', initial: 'S', color: '#22D3EE', tasks: 48, sections: 5, hours: 14, progress: 0, tags: ['Python'], locked: true, tier: 'hard' },
    { id: 'yandex-boss', name: 'Yandex', initial: 'Я', color: '#EF4444', tasks: 80, sections: 4, hours: 28, progress: 0, tags: ['Senior Backend'], locked: true, tier: 'boss', active: false, level_req: 30, your_level: 24 },
    { id: 'tinkoff-boss', name: 'Tinkoff', initial: 'T', color: '#EF4444', tasks: 80, sections: 4, hours: 28, progress: 5, tags: ['Senior Backend'], locked: false, tier: 'boss', active: true, level_req: 30, your_level: 24 },
];
export const dungeonsHandlers = [
    http.get(`${base}/dungeons`, () => HttpResponse.json({
        total: 12,
        total_tasks: 480,
        done: 5,
        tabs: ['Все 12', 'Normal 6', 'Hard 4', 'Boss 2', 'Пройденные', 'Активные'],
        companies,
    })),
];
