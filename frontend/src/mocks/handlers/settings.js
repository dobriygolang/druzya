import { http, HttpResponse } from 'msw';
const base = '/api/v1';
let notifyPrefs = {
    email_weekly: true,
    email_calendar: true,
    telegram_daily: false,
    push_arena_invite: true,
    push_cohort_war: true,
    quiet_hours_start: '23:00',
    quiet_hours_end: '08:00',
};
let userSettings = {
    locale: 'ru',
    theme: 'dark',
    motion: 'on',
    public_profile: true,
};
export const settingsHandlers = [
    http.get(`${base}/notify/preferences`, () => HttpResponse.json(notifyPrefs)),
    http.put(`${base}/notify/preferences`, async ({ request }) => {
        const body = (await request.json());
        notifyPrefs = { ...notifyPrefs, ...body };
        return HttpResponse.json(notifyPrefs);
    }),
    http.put(`${base}/profile/me/settings`, async ({ request }) => {
        const body = (await request.json());
        userSettings = { ...userSettings, ...body };
        return HttpResponse.json(userSettings);
    }),
];
