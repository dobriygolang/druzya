// Тонкая обёртка над fetch с bearer-авторизацией, transparent refresh при
// 401 и фоновым silent-refresh таймером.
//
// Контракт хранения:
//   - access_token   → localStorage(druz9_access_token), читается каждым api()
//                       вызовом. Также держим в памяти как fast-path.
//   - refresh_token  → localStorage(druz9_refresh_token), отправляется
//                       header'ом X-Refresh-Token на /auth/refresh. (Бэк
//                       параллельно ставит HttpOnly cookie с тем же значением,
//                       но cookie выживает не во всех окружениях, поэтому
//                       копия в localStorage — primary transport.)
//   - access_expires → localStorage(druz9_access_expires_at), unix-ms timestamp.
//
// При получении 401 на любом защищённом запросе:
//   1. ставим in-flight refresh promise (singleton, чтобы N параллельных
//      401-нутых запросов поделили один refresh);
//   2. если refresh успешен — повторяем оригинальный запрос с новым
//      access_token; если фейл — чистим всё и редиректим на /login с тостом.
//
// Silent refresh: фоновый таймер на 80% TTL автоматически обновляет access
// до истечения, чтобы не получать 401 на горячих экранах.

const ACCESS_TOKEN_KEY = 'druz9_access_token'
const REFRESH_TOKEN_KEY = 'druz9_refresh_token'
const ACCESS_EXPIRES_KEY = 'druz9_access_expires_at'

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1'

export function isMockMode(): boolean {
  return (import.meta.env.VITE_USE_MSW as string | undefined) === 'true'
}

// ── token storage ────────────────────────────────────────────────────────

function safeRead(key: string): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null
  } catch {
    return null
  }
}

function safeWrite(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value)
  } catch {
    /* private mode / quota — degrade gracefully */
  }
}

function safeDelete(key: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key)
  } catch {
    /* noop */
  }
}

let memAccessToken: string | null = null

export function readAccessToken(): string | null {
  if (memAccessToken) return memAccessToken
  memAccessToken = safeRead(ACCESS_TOKEN_KEY)
  return memAccessToken
}

export function readRefreshToken(): string | null {
  return safeRead(REFRESH_TOKEN_KEY)
}

/**
 * Persist the access/refresh pair after a successful login or refresh.
 * `expiresInSec` is what backend returns under `expires_in` (seconds, int).
 */
export function persistTokens(access: string, refresh: string | null, expiresInSec: number): void {
  memAccessToken = access
  safeWrite(ACCESS_TOKEN_KEY, access)
  if (refresh) safeWrite(REFRESH_TOKEN_KEY, refresh)
  if (Number.isFinite(expiresInSec) && expiresInSec > 0) {
    const expiresAt = Date.now() + expiresInSec * 1000
    safeWrite(ACCESS_EXPIRES_KEY, String(expiresAt))
    scheduleSilentRefresh(expiresInSec)
  }
}

export function clearTokens(): void {
  memAccessToken = null
  safeDelete(ACCESS_TOKEN_KEY)
  safeDelete(REFRESH_TOKEN_KEY)
  safeDelete(ACCESS_EXPIRES_KEY)
  cancelSilentRefresh()
}

// ── 401 toast ────────────────────────────────────────────────────────────
//
// Не тащим toast-библиотеку только ради этого: эмитим CustomEvent,
// AppShell (или любой root listener) показывает баннер. Если listener'а нет —
// событие тихо сгорит, но redirect всё равно случится.

export interface SessionExpiredDetail {
  reason: 'expired' | 'refresh_failed'
}

export function emitSessionExpired(detail: SessionExpiredDetail): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent<SessionExpiredDetail>('druz9:session-expired', { detail }))
  } catch {
    /* IE-style fallback unnecessary in modern browsers */
  }
}

// ── refresh singleton ────────────────────────────────────────────────────

let inflightRefresh: Promise<string | null> | null = null

async function performRefresh(): Promise<string | null> {
  const refresh = readRefreshToken()
  if (!refresh) return null
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Refresh-Token': refresh,
      },
      body: '{}',
    })
    if (!res.ok) return null
    const body = (await res.json()) as {
      access_token?: string
      expires_in?: number
    }
    if (!body.access_token) return null
    // Backend echoes a new refresh token via header (rotation); prefer it,
    // fall back to existing if header absent.
    const nextRefresh = res.headers.get('X-Refresh-Token') ?? refresh
    persistTokens(body.access_token, nextRefresh, body.expires_in ?? 0)
    return body.access_token
  } catch {
    return null
  }
}

/** Coalesces concurrent refresh attempts into a single in-flight promise. */
async function refreshAccessTokenOnce(): Promise<string | null> {
  if (inflightRefresh) return inflightRefresh
  inflightRefresh = performRefresh().finally(() => {
    inflightRefresh = null
  })
  return inflightRefresh
}

// ── silent refresh timer ─────────────────────────────────────────────────

let silentRefreshHandle: number | null = null

function cancelSilentRefresh(): void {
  if (silentRefreshHandle !== null && typeof window !== 'undefined') {
    window.clearTimeout(silentRefreshHandle)
    silentRefreshHandle = null
  }
}

function scheduleSilentRefresh(expiresInSec: number): void {
  cancelSilentRefresh()
  if (typeof window === 'undefined') return
  // Trigger at 80% of the TTL with a 30s minimum to avoid hot loops if the
  // backend ever returns a microscopic TTL by mistake.
  const ms = Math.max(30_000, Math.floor(expiresInSec * 0.8) * 1000)
  silentRefreshHandle = window.setTimeout(() => {
    void refreshAccessTokenOnce().then((next) => {
      // If refresh failed and we still have an active session, surface the
      // expiry to the UI and redirect — the user lost their refresh slot.
      // Skip on public pages: dropping tokens silently logs the user out
      // even though they're just looking at marketing content.
      if (!next && readAccessToken()) {
        if (isPublicPage(window.location.pathname)) return
        clearTokens()
        emitSessionExpired({ reason: 'refresh_failed' })
        redirectToLogin()
      }
    })
  }, ms)
}

/**
 * Restart the silent refresh timer from a stored expires-at timestamp.
 * Called once at app boot so the timer survives page reloads.
 */
export function bootstrapSilentRefresh(): void {
  if (typeof window === 'undefined') return
  const raw = safeRead(ACCESS_EXPIRES_KEY)
  if (!raw) return
  const expiresAt = Number(raw)
  if (!Number.isFinite(expiresAt)) return
  const remainingSec = Math.floor((expiresAt - Date.now()) / 1000)
  if (remainingSec <= 0) {
    // Already expired — fire a refresh immediately on first network call.
    return
  }
  scheduleSilentRefresh(remainingSec)
}

// isPublicPage — pages that render without an auth-gated AppShell. A 401 on
// these surfaces is almost always a background noise: react-query was still
// holding promises from the previously-mounted authenticated page that
// resolve into a refresh-failed-401 after the user has already navigated to
// the public surface. Punishing them with clearTokens + redirect is wrong:
// they came here intentionally and we'd rather keep their session intact
// for the next time they navigate to a logged-in route.
function isPublicPage(path: string): boolean {
  return (
    path.startsWith('/login') ||
    path.startsWith('/welcome') ||
    path.startsWith('/auth/') ||
    path.startsWith('/copilot')
  )
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') return
  if (isPublicPage(window.location.pathname)) return
  const next = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.href = `/login?next=${next}&reason=expired`
}

// ── api() wrapper ────────────────────────────────────────────────────────

export type Fetcher = <T = unknown>(path: string, init?: RequestInit) => Promise<T>

interface DoFetchArgs {
  path: string
  init: RequestInit
  bearer: string | null
}

async function doFetch({ path, init, bearer }: DoFetchArgs): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  }
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`
  return fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  })
}

export const api: Fetcher = async (path, init = {}) => {
  let token = readAccessToken()
  let res = await doFetch({ path, init, bearer: token })

  // Single transparent refresh attempt on 401. Skip the retry on the refresh
  // endpoint itself to avoid infinite loops, and skip on /auth/* (login &
  // poll endpoints have their own status semantics).
  const isAuthPath = path.startsWith('/auth/')
  if (res.status === 401 && !isAuthPath) {
    const nextToken = await refreshAccessTokenOnce()
    if (nextToken) {
      token = nextToken
      res = await doFetch({ path, init, bearer: token })
    }
    if (res.status === 401) {
      // On public pages we surface the 401 to the caller but keep the
      // session intact — the refresh fail almost always comes from a stale
      // background fetch from the previously-mounted authenticated page,
      // and dropping tokens here would silently log the user out.
      if (typeof window !== 'undefined' && isPublicPage(window.location.pathname)) {
        throw new ApiError(401, 'unauthorized')
      }
      clearTokens()
      emitSessionExpired({ reason: 'refresh_failed' })
      redirectToLogin()
      throw new ApiError(401, 'unauthorized')
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // Wave-11 global-error wiring: 5xx + 502/503/504 fans out to the
    // degradedBus so <DegradedBanner /> can surface a sticky note. Scope =
    // the first path segment, e.g. "weekly-report" from /profile/me/report.
    // Recovery is handled by callers via degradedBus.recover() — apiClient
    // only knows about failures, not "this query is now happy again".
    if (res.status >= 500 && res.status < 600) {
      try {
        // Lazy require keeps the bus out of the apiClient cold path when
        // it never fails. Module-state singleton — no React context needed.
        const { degradedBus } = await import('../components/global-error/degradedBus')
        const scope = scopeFromPath(path)
        degradedBus.report(scope, res.status === 503 ? 'unavailable' : `${res.status} ${res.statusText || 'server error'}`)
      } catch {
        /* importing the bus must never break the request — swallow */
      }
    }
    throw new ApiError(res.status, body)
  }

  if (res.status === 204) return undefined as never
  return res.json()
}

// scopeFromPath — derive a stable "scope" id from a request path so the
// degradedBus can deduplicate noise and recover symmetrically. Examples:
//   "/profile/me/report"        → "weekly-report"
//   "/profile/weekly/share/:t"  → "weekly-share"
//   "/ai/coach/insight"         → "ai-coach"
// Falls back to the first non-version path segment if no special-case
// rule matches.
function scopeFromPath(path: string): string {
  const clean = path.split('?')[0].replace(/^\/+/, '')
  if (clean.startsWith('profile/me/report')) return 'weekly-report'
  if (clean.startsWith('profile/weekly/share')) return 'weekly-share'
  if (clean.startsWith('profile/me/atlas')) return 'atlas'
  if (clean.startsWith('ai/coach') || clean.startsWith('ai/insight')) return 'ai-coach'
  if (clean.startsWith('arena/match')) return 'arena'
  if (clean.startsWith('voice')) return 'voice-mock'
  if (clean.startsWith('vacancies')) return 'vacancies'
  const seg = clean.split('/')[0] || 'api'
  return seg
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`api ${status}: ${body}`)
  }
}
