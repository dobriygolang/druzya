// Тонкая обёртка над fetch с bearer-авторизацией и обработкой 401.
// Источник — MSW (dev) или реальный бэкенд (prod), управляется через VITE_USE_MSW.
const TOKEN_KEY = 'druz9_access_token';
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';
export function isMockMode() {
    return import.meta.env.VITE_USE_MSW === 'true';
}
function readToken() {
    try {
        return typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_KEY) : null;
    }
    catch {
        return null;
    }
}
function clearTokenAndRedirect() {
    try {
        if (typeof window !== 'undefined') {
            window.localStorage.removeItem(TOKEN_KEY);
            // Избегаем цикла, если уже на /welcome
            if (!window.location.pathname.startsWith('/welcome')) {
                window.location.href = '/welcome';
            }
        }
    }
    catch {
        /* noop */
    }
}
export const api = async (path, init = {}) => {
    const token = readToken();
    const headers = {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
    };
    if (token)
        headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        ...init,
        headers,
    });
    if (res.status === 401) {
        clearTokenAndRedirect();
        throw new ApiError(401, 'unauthorized');
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
