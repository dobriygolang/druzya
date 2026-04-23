// Telegram deep-link code flow + Yandex callback helpers.
//
// Backend contract (см. backend/services/auth/ports/code_flow.go):
//   POST /api/v1/auth/telegram/start  → 200 {code, deep_link, expires_at}
//                                      → 429 {error, retry_after}
//   POST /api/v1/auth/telegram/poll   → 200 {access_token, expires_in, user, is_new_user}
//                                      → 202 {pending: true}     (still waiting for bot)
//                                      → 410 {error: "code_expired"}
//                                      → 429 {error, retry_after}
//
// `api()` throws ApiError on non-2xx — we treat 202/410/429 as control flow,
// not failure, by handling them via raw fetch here. The 200 path is the only
// one that hands tokens back.
import { API_BASE } from '../apiClient';
const ACCESS_TOKEN_KEY = 'druz9_access_token';
/** POST /api/v1/auth/telegram/start. Throws on network failure. */
export async function startTelegramAuth() {
    const res = await fetch(`${API_BASE}/auth/telegram/start`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`telegram/start ${res.status}: ${text}`);
    }
    return (await res.json());
}
/**
 * POST /api/v1/auth/telegram/poll. Maps HTTP status to a discriminated union
 * so the caller can switch on `kind` instead of try/catch on status codes.
 */
export async function pollTelegramAuth(code) {
    let res;
    try {
        res = await fetch(`${API_BASE}/auth/telegram/poll`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });
    }
    catch (e) {
        return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
    }
    if (res.status === 202)
        return { kind: 'pending' };
    if (res.status === 410)
        return { kind: 'expired' };
    if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After') ?? '60');
        return { kind: 'rate_limited', retry_after: Number.isFinite(retryAfter) ? retryAfter : 60 };
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { kind: 'error', message: `poll ${res.status}: ${text}` };
    }
    const body = (await res.json());
    return { kind: 'ok', ...body };
}
/** Persist the access token under the same key /lib/apiClient.ts reads. */
export function persistAccessToken(token) {
    try {
        window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
    }
    catch {
        /* localStorage unavailable (private mode) — fail silently; the next
           request will 401 and the user re-authenticates. */
    }
}
