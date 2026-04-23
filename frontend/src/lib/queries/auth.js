// Telegram deep-link code flow + Yandex callback helpers.
//
// Backend contract (см. backend/services/auth/ports/code_flow.go):
//   POST /api/v1/auth/telegram/start  → 200 {code, deep_link, expires_at}
//                                      → 429 {error, retry_after}
//   POST /api/v1/auth/telegram/poll   → 200 {access_token, refresh_token,
//                                              expires_in, user, is_new_user}
//                                      → 202 {pending: true}     (still waiting for bot)
//                                      → 410 {error: "code_expired"}
//                                      → 429 {error, retry_after}
//
// `api()` throws ApiError on non-2xx — we treat 202/410/429 as control flow,
// not failure, by handling them via raw fetch here. The 200 path is the only
// one that hands tokens back.
import { API_BASE, clearTokens, persistTokens, readRefreshToken } from '../apiClient';
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
    // Backend mirrors the refresh token in JSON body, header, AND cookie. Prefer
    // the body, then the X-Refresh-Token header.
    const refresh = body.refresh_token ?? res.headers.get('X-Refresh-Token') ?? undefined;
    return { kind: 'ok', ...body, refresh_token: refresh };
}
/**
 * Persist tokens after Telegram poll / Yandex callback success. Replaces the
 * legacy `persistAccessToken(token)` — callers must now hand the refresh
 * token + TTL through so the silent-refresh timer can take over.
 */
export function persistAuthTokens(input) {
    persistTokens(input.access_token, input.refresh_token ?? null, input.expires_in ?? 0);
}
/**
 * Backwards-compatible single-token persister. New code should call
 * persistAuthTokens() so the refresh slot is populated as well — without it
 * the SPA cannot transparently survive a 401 on hot screens.
 */
export function persistAccessToken(token) {
    persistTokens(token, null, 0);
}
/** POST /api/v1/auth/logout. Best-effort: revokes server-side session + clears local tokens. */
export async function logoutCurrentSession() {
    const refresh = readRefreshToken();
    try {
        await fetch(`${API_BASE}/auth/logout`, {
            method: 'DELETE',
            credentials: 'include',
            headers: refresh ? { 'X-Refresh-Token': refresh } : {},
        });
    }
    catch {
        /* network failure: still clear local state below */
    }
    clearTokens();
}
