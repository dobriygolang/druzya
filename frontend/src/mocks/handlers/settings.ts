import { http, HttpResponse } from 'msw'

const base = '/api/v1'

// Identity 2026-05-04: arena/cohort выпилены. Notification prefs теперь
// строятся вокруг mock + tutor + coach surfaces. Backend поля переименованы
// в продуктовом языке когда будет proto-bump; пока мок поддерживает старые
// ключи для совместимости с легаси handlers.
let notifyPrefs = {
  email_weekly: true,
  email_calendar: true,
  telegram_daily: false,
  push_arena_invite: false,
  push_cohort_war: false,
  push_mock_ready: true,
  push_tutor_invite: true,
  quiet_hours_start: '23:00',
  quiet_hours_end: '08:00',
}

let userSettings = {
  locale: 'ru' as const,
  theme: 'dark' as const,
  motion: 'on' as const,
  public_profile: true,
}

export const settingsHandlers = [
  http.get(`${base}/notify/preferences`, () => HttpResponse.json(notifyPrefs)),
  http.put(`${base}/notify/preferences`, async ({ request }) => {
    const body = (await request.json()) as typeof notifyPrefs
    notifyPrefs = { ...notifyPrefs, ...body }
    return HttpResponse.json(notifyPrefs)
  }),
  http.put(`${base}/profile/me/settings`, async ({ request }) => {
    const body = (await request.json()) as typeof userSettings
    userSettings = { ...userSettings, ...body }
    return HttpResponse.json(userSettings)
  }),
]
