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
const ACCESS_TOKEN_KEY = 'druz9_access_token';
const REFRESH_TOKEN_KEY = 'druz9_refresh_token';
const ACCESS_EXPIRES_KEY = 'druz9_access_expires_at';
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';
export function isMockMode() {
    return import.meta.env.VITE_USE_MSW === 'true';
}
// ── token storage ────────────────────────────────────────────────────────
function safeRead(key) {
    try {
        return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    }
    catch {
        return null;
    }
}
function safeWrite(key, value) {
    try {
        if (typeof window !== 'undefined')
            window.localStorage.setItem(key, value);
    }
    catch {
        /* private mode / quota — degrade gracefully */
    }
}
function safeDelete(key) {
    try {
        if (typeof window !== 'undefined')
            window.localStorage.removeItem(key);
    }
    catch {
        /* noop */
    }
}
let memAccessToken = null;
export function readAccessToken() {
    if (memAccessToken)
        return memAccessToken;
    memAccessToken = safeRead(ACCESS_TOKEN_KEY);
    return memAccessToken;
}
export function readRefreshToken() {
    return safeRead(REFRESH_TOKEN_KEY);
}
/**
 * Persist the access/refresh pair after a successful login or refresh.
 * `expiresInSec` is what backend returns under `expires_in` (seconds, int).
 */
export function persistTokens(access, refresh, expiresInSec) {
    memAccessToken = access;
    safeWrite(ACCESS_TOKEN_KEY, access);
    if (refresh)
        safeWrite(REFRESH_TOKEN_KEY, refresh);
    if (Number.isFinite(expiresInSec) && expiresInSec > 0) {
        const expiresAt = Date.now() + expiresInSec * 1000;
        safeWrite(ACCESS_EXPIRES_KEY, String(expiresAt));
        scheduleSilentRefresh(expiresInSec);
    }
}
export function clearTokens() {
    memAccessToken = null;
    safeDelete(ACCESS_TOKEN_KEY);
    safeDelete(REFRESH_TOKEN_KEY);
    safeDelete(ACCESS_EXPIRES_KEY);
    cancelSilentRefresh();
}
export function emitSessionExpired(detail) {
    if (typeof window === 'undefined')
        return;
    try {
        window.dispatchEvent(new CustomEvent('druz9:session-expired', { detail }));
    }
    catch {
        /* IE-style fallback unnecessary in modern browsers */
    }
}
// ── refresh singleton ────────────────────────────────────────────────────
let inflightRefresh = null;
async function performRefresh() {
    const refresh = readRefreshToken();
    if (!refresh)
        return null;
    try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'X-Refresh-Token': refresh,
            },
            body: '{}',
        });
        if (!res.ok)
            return null;
        const body = (await res.json());
        if (!body.access_token)
            return null;
        // Backend echoes a new refresh token via header (rotation); prefer it,
        // fall back to existing if header absent.
        const nextRefresh = res.headers.get('X-Refresh-Token') ?? refresh;
        persistTokens(body.access_token, nextRefresh, body.expires_in ?? 0);
        return body.access_token;
    }
    catch {
        return null;
    }
}
/** Coalesces concurrent refresh attempts into a single in-flight promise. */
async function refreshAccessTokenOnce() {
    if (inflightRefresh)
        return inflightRefresh;
    inflightRefresh = performRefresh().finally(() => {
        inflightRefresh = null;
    });
    return inflightRefresh;
}
// ── silent refresh timer ─────────────────────────────────────────────────
let silentRefreshHandle = null;
function cancelSilentRefresh() {
    if (silentRefreshHandle !== null && typeof window !== 'undefined') {
        window.clearTimeout(silentRefreshHandle);
        silentRefreshHandle = null;
    }
}
function scheduleSilentRefresh(expiresInSec) {
    cancelSilentRefresh();
    if (typeof window === 'undefined')
        return;
    // Trigger at 80% of the TTL with a 30s minimum to avoid hot loops if the
    // backend ever returns a microscopic TTL by mistake.
    const ms = Math.max(30_000, Math.floor(expiresInSec * 0.8) * 1000);
    silentRefreshHandle = window.setTimeout(() => {
        void refreshAccessTokenOnce().then((next) => {
            // If refresh failed and we still have an active session, surface the
            // expiry to the UI and redirect — the user lost their refresh slot.
            if (!next && readAccessToken()) {
                clearTokens();
                emitSessionExpired({ reason: 'refresh_failed' });
                redirectToLogin();
            }
        });
    }, ms);
}
/**
 * Restart the silent refresh timer from a stored expires-at timestamp.
 * Called once at app boot so the timer survives page reloads.
 */
export function bootstrapSilentRefresh() {
    if (typeof window === 'undefined')
        return;
    const raw = safeRead(ACCESS_EXPIRES_KEY);
    if (!raw)
        return;
    const expiresAt = Number(raw);
    if (!Number.isFinite(expiresAt))
        return;
    const remainingSec = Math.floor((expiresAt - Date.now()) / 1000);
    if (remainingSec <= 0) {
        // Already expired — fire a refresh immediately on first network call.
        return;
    }
    scheduleSilentRefresh(remainingSec);
}
function redirectToLogin() {
    if (typeof window === 'undefined')
        return;
    const path = window.location.pathname;
    // Avoid loops when we're already on a public auth page.
    if (path.startsWith('/login') || path.startsWith('/welcome') || path.startsWith('/auth/')) {
        return;
    }
    const next = encodeURIComponent(path + window.location.search);
    window.location.href = `/login?next=${next}&reason=expired`;
}
async function doFetch({ path, init, bearer }) {
    const headers = {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
    };
    if (bearer)
        headers['Authorization'] = `Bearer ${bearer}`;
    return fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        ...init,
        headers,
    });
}
export const api = async (path, init = {}) => {
    let token = readAccessToken();
    let res = await doFetch({ path, init, bearer: token });
    // Single transparent refresh attempt on 401. Skip the retry on the refresh
    // endpoint itself to avoid infinite loops, and skip on /auth/* (login &
    // poll endpoints have their own status semantics).
    const isAuthPath = path.startsWith('/auth/');
    if (res.status === 401 && !isAuthPath) {
        const nextToken = await refreshAccessTokenOnce();
        if (nextToken) {
            token = nextToken;
            res = await doFetch({ path, init, bearer: token });
        }
        if (res.status === 401) {
            clearTokens();
            emitSessionExpired({ reason: 'refresh_failed' });
            redirectToLogin();
            throw new ApiError(401, 'unauthorized');
        }
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new ApiError(res.status, body);
    }
    if (res.status === 204)
        return undefined;
    return res.json();
};
export class ApiError extends Error {
    status;
    body;
    constructor(status, body) {
        super(`api ${status}: ${body}`);
        this.status = status;
        this.body = body;
    }
}
