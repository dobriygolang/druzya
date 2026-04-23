// MSW: auth-моки. Каждый успешный логин/refresh выставляет
// X-Refresh-Token и X-Is-New-User так же, как реальный бэкенд (см.
// backend/services/auth/ports/server.go), чтобы apiClient на dev-окружении
// проходил тот же код-путь.
import { http, HttpResponse } from 'msw'

const base = '/api/v1'
const ACCESS_TTL = 24 * 60 * 60 // 24h, выровнено с продовым default'ом
const REFRESH_TOKEN = 'mock-refresh-00000000-0000-0000-0000-000000000001'

function authHeaders(opts: { isNewUser?: boolean } = {}): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Refresh-Token': REFRESH_TOKEN,
    'X-Is-New-User': opts.isNewUser ? '1' : '0',
  }
}

export const authHandlers = [
  http.post(`${base}/auth/yandex`, () =>
    HttpResponse.json(
      {
        access_token: 'mock-jwt-yandex',
        expires_in: ACCESS_TTL,
        user: {
          id: '00000000-0000-0000-0000-000000000001',
          email: 'hero@druz9.online',
          username: 'hero',
          role: 'user',
          provider: 'yandex',
        },
      },
      { headers: authHeaders() },
    ),
  ),

  http.post(`${base}/auth/telegram`, () =>
    HttpResponse.json(
      {
        access_token: 'mock-jwt-tg',
        expires_in: ACCESS_TTL,
        user: {
          id: '00000000-0000-0000-0000-000000000001',
          username: 'hero',
          role: 'user',
          provider: 'telegram',
        },
      },
      { headers: authHeaders() },
    ),
  ),

  http.post(`${base}/auth/refresh`, () =>
    HttpResponse.json(
      {
        access_token: 'mock-jwt-refreshed',
        expires_in: ACCESS_TTL,
        user: {
          id: '00000000-0000-0000-0000-000000000001',
          username: 'hero',
          role: 'user',
          provider: 'yandex',
        },
      },
      { headers: authHeaders() },
    ),
  ),

  http.delete(`${base}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
]
