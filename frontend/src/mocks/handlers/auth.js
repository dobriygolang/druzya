import { http, HttpResponse } from 'msw';
const base = '/api/v1';
export const authHandlers = [
    http.post(`${base}/auth/yandex`, () => HttpResponse.json({
        access_token: 'mock-jwt-yandex',
        expires_in: 900,
        user: {
            id: '00000000-0000-0000-0000-000000000001',
            email: 'hero@druz9.online',
            username: 'hero',
            role: 'user',
            provider: 'yandex',
        },
    })),
    http.post(`${base}/auth/telegram`, () => HttpResponse.json({
        access_token: 'mock-jwt-tg',
        expires_in: 900,
        user: {
            id: '00000000-0000-0000-0000-000000000001',
            username: 'hero',
            role: 'user',
            provider: 'telegram',
        },
    })),
    http.post(`${base}/auth/refresh`, () => HttpResponse.json({
        access_token: 'mock-jwt-refreshed',
        expires_in: 900,
        user: {
            id: '00000000-0000-0000-0000-000000000001',
            username: 'hero',
            role: 'user',
            provider: 'yandex',
        },
    })),
    http.delete(`${base}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
];
