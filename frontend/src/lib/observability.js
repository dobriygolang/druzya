import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
const DSN = (import.meta.env.VITE_SENTRY_DSN ?? '').trim();
const ENV = (import.meta.env.MODE ?? 'development');
const RELEASE = (import.meta.env.VITE_RELEASE ?? 'dev');
const ENABLED = DSN.length > 0 && DSN.startsWith('https://');
let sentryRef = null;
let initialized = false;
export async function initObservability() {
    if (initialized)
        return;
    initialized = true;
    if (!ENABLED) {
        // Нет DSN → SDK не грузим → сетевых вызовов нет. Готово.
        return;
    }
    // Динамический импорт — chunk скачивается только при наличии DSN.
    const Sentry = await import('@sentry/react');
    sentryRef = Sentry;
    Sentry.init({
        dsn: DSN,
        environment: ENV,
        release: RELEASE,
        integrations: [
            Sentry.browserTracingIntegration(),
            Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
        ],
        tracesSampleRate: ENV === 'production' ? 0.1 : 1.0,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        beforeSend(event) {
            // Срезаем MSW-мокнутые ошибки (избегаем шума от локального dev с моками)
            if (event.request?.url?.includes('/api/v1') && import.meta.env.VITE_USE_MSW === 'true') {
                return null;
            }
            return event;
        },
    });
}
/** Добавить breadcrumb вручную для важных пользовательских действий. No-op, если Sentry выключен. */
export function track(category, message, data) {
    if (!sentryRef)
        return;
    sentryRef.addBreadcrumb({
        category,
        message,
        data,
        level: 'info',
        timestamp: Date.now() / 1000,
    });
}
/** Идентифицировать пользователя (вызывать после авторизации). No-op, если Sentry выключен. */
export function identifyUser(id, username) {
    if (!sentryRef)
        return;
    sentryRef.setUser({ id, username });
}
/** Очистить пользовательский контекст при logout. No-op, если Sentry выключен. */
export function clearUser() {
    if (!sentryRef)
        return;
    sentryRef.setUser(null);
}
let CachedBoundary = null;
export function ErrorBoundary({ children, fallback }) {
    if (!ENABLED)
        return _jsx(_Fragment, { children: children });
    if (sentryRef && !CachedBoundary) {
        CachedBoundary = sentryRef.ErrorBoundary;
    }
    if (!CachedBoundary)
        return _jsx(_Fragment, { children: children });
    const Boundary = CachedBoundary;
    return _jsx(Boundary, { fallback: fallback, children: children });
}
