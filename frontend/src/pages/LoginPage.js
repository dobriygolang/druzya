import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// LoginPage — единая точка входа/регистрации.
//
// Контекст (см. требования redesign):
//   * Yandex: тот же authorize-URL → /auth/callback/yandex (как раньше).
//   * Telegram: НЕ Login Widget (был «Bot domain invalid» на dev-домене), а
//     deep-link + код. Бэк генерит 8-символьный код, кладёт в Redis с TTL,
//     и поллим `/auth/telegram/poll` пока Telegram-бот не пометит код как
//     подтверждённый. См. backend/services/auth/ports/code_flow.go.
//
// После успешной авторизации (и Telegram, и Yandex):
//   - access_token → localStorage (ключ druz9_access_token, тот же что
//     читает /lib/apiClient.ts);
//   - refresh-токен — HttpOnly cookie, ставится бэком;
//   - редирект:
//       is_new_user === true  → /onboarding (туториал без auth-форм)
//       is_new_user === false → / (Sanctum)
//     Для Yandex флаг is_new_user сейчас не возвращается — фронт делает
//     fallback на /sanctum (см. AuthCallbackYandexPage).
//
// Email/пароль удалены ещё в Phase 2.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Loader2, Send, X, Copy, ExternalLink, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { pollTelegramAuth, startTelegramAuth, persistAuthTokens, } from '../lib/queries/auth';
const YANDEX_CLIENT_ID = import.meta.env.VITE_YANDEX_CLIENT_ID;
const POLL_INTERVAL_MS = 2000;
const yandexRedirectURI = () => `${window.location.origin}/auth/callback/yandex`;
function buildYandexAuthorizeURL() {
    if (!YANDEX_CLIENT_ID)
        return null;
    const state = crypto.randomUUID();
    sessionStorage.setItem('oauth_state_yandex', state);
    const u = new URL('https://oauth.yandex.ru/authorize');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', YANDEX_CLIENT_ID);
    u.searchParams.set('redirect_uri', yandexRedirectURI());
    u.searchParams.set('state', state);
    return u.toString();
}
export default function LoginPage() {
    const { t } = useTranslation('welcome');
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const nextHref = params.get('next') ?? '/sanctum';
    // ?reason=expired — выставляется apiClient'ом после неудачного refresh,
    // чтобы пользователь увидел осмысленное сообщение, а не «просто кинуло
    // на логин».
    const sessionExpired = params.get('reason') === 'expired';
    const [error, setError] = useState(sessionExpired ? 'Сессия истекла, переавторизуйтесь.' : null);
    const [tgFlow, setTgFlow] = useState(null);
    const [tgPolling, setTgPolling] = useState(false);
    const [tgStarting, setTgStarting] = useState(false);
    const pollTimer = useRef(null);
    useEffect(() => {
        document.body.classList.add('v2');
        return () => document.body.classList.remove('v2');
    }, []);
    // Cleanup polling on unmount.
    useEffect(() => () => stopPolling(), []);
    function stopPolling() {
        if (pollTimer.current !== null) {
            window.clearTimeout(pollTimer.current);
            pollTimer.current = null;
        }
        setTgPolling(false);
    }
    async function pollLoop(code) {
        setTgPolling(true);
        const tick = async () => {
            const result = await pollTelegramAuth(code);
            if (result.kind === 'pending') {
                pollTimer.current = window.setTimeout(tick, POLL_INTERVAL_MS);
                return;
            }
            stopPolling();
            if (result.kind === 'ok') {
                persistAuthTokens({
                    access_token: result.access_token,
                    refresh_token: result.refresh_token,
                    expires_in: result.expires_in,
                });
                const dest = result.is_new_user ? '/onboarding' : nextHref;
                navigate(dest, { replace: true });
                return;
            }
            if (result.kind === 'expired') {
                setError('Код истёк. Попробуй ещё раз.');
                setTgFlow(null);
                return;
            }
            if (result.kind === 'rate_limited') {
                setError(`Слишком часто опрашиваем. Подожди ${result.retry_after}с.`);
                return;
            }
            setError(result.message || 'Не удалось проверить код.');
        };
        pollTimer.current = window.setTimeout(tick, POLL_INTERVAL_MS);
    }
    async function handleTelegramClick() {
        setError(null);
        setTgStarting(true);
        try {
            const res = await startTelegramAuth();
            setTgFlow(res);
            // Open the bot in a new tab — most users have the Telegram app installed
            // and the t.me link will deep-link them straight to /start <code>.
            window.open(res.deep_link, '_blank', 'noopener,noreferrer');
            void pollLoop(res.code);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setError(`Не удалось запустить вход через Telegram: ${msg}`);
        }
        finally {
            setTgStarting(false);
        }
    }
    function handleCancelTelegram() {
        stopPolling();
        setTgFlow(null);
        setError(null);
    }
    async function handleCopyCode() {
        if (!tgFlow)
            return;
        try {
            await navigator.clipboard.writeText(tgFlow.code);
        }
        catch {
            /* clipboard blocked — модалка всё равно показывает код. */
        }
    }
    const yandexHref = buildYandexAuthorizeURL();
    return (_jsxs("div", { className: "min-h-screen bg-bg text-text-primary", children: [_jsxs("header", { className: "flex h-[72px] items-center justify-between border-b border-border bg-bg px-4 sm:px-8 lg:px-20", children: [_jsxs(Link, { to: "/welcome", className: "flex items-center gap-2.5", children: [_jsx("span", { className: "grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-lg font-extrabold text-text-primary", children: "9" }), _jsx("span", { className: "font-display text-lg font-bold text-text-primary", children: "druz9" })] }), _jsx(Link, { to: "/welcome", className: "text-sm font-medium text-text-muted hover:text-text-secondary", children: t('start') })] }), _jsxs("main", { className: "mx-auto flex w-full max-w-[420px] flex-col gap-8 px-4 py-12 sm:py-16", children: [_jsx("h1", { className: "font-display text-3xl font-extrabold text-text-primary sm:text-4xl", children: "\u0412\u043E\u0439\u0442\u0438 / \u0417\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C\u0441\u044F" }), _jsx("p", { className: "text-[14px] text-text-muted", children: "\u041E\u0434\u0438\u043D \u043A\u043B\u0438\u043A \u2014 \u0438 \u043C\u044B \u0441\u043E\u0437\u0434\u0430\u0434\u0438\u043C \u043F\u0440\u043E\u0444\u0438\u043B\u044C \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438. Email \u0438 \u043F\u0430\u0440\u043E\u043B\u0438 \u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u043D\u0443\u0436\u043D\u044B." }), error && (_jsx("div", { className: "rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-[13px] text-red-300", children: error })), _jsxs("div", { className: "flex flex-col gap-4", children: [_jsxs("div", { children: [_jsx("div", { className: "mb-2 text-[13px] uppercase tracking-wider text-text-muted", children: "Telegram" }), _jsxs("button", { type: "button", onClick: handleTelegramClick, disabled: tgStarting || tgPolling, className: "flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-cyan/40 bg-cyan/15 text-[15px] font-semibold text-text-primary transition-colors hover:bg-cyan/25 disabled:cursor-wait disabled:opacity-60", children: [tgStarting ? (_jsx(Loader2, { className: "h-5 w-5 animate-spin" })) : (_jsx(Send, { className: "h-5 w-5" })), "\u0412\u043E\u0439\u0442\u0438 \u0447\u0435\u0440\u0435\u0437 Telegram"] })] }), _jsxs("div", { children: [_jsx("div", { className: "mb-2 text-[13px] uppercase tracking-wider text-text-muted", children: "Yandex ID" }), yandexHref ? (_jsxs("a", { href: yandexHref, className: "flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-pink/40 bg-pink/15 text-[15px] font-semibold text-text-primary transition-colors hover:bg-pink/25", children: ["\u0412\u043E\u0439\u0442\u0438 \u0447\u0435\u0440\u0435\u0437 Yandex", _jsx(ArrowRight, { className: "h-5 w-5" })] })) : (_jsx("div", { className: "rounded-lg border border-border bg-surface-1 px-4 py-3 text-[13px] text-text-muted", children: "Yandex-\u043B\u043E\u0433\u0438\u043D \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D (\u043D\u0435\u0442 VITE_YANDEX_CLIENT_ID)." }))] })] }), _jsx("p", { className: "text-center text-[13px] text-text-muted", children: "\u041F\u0435\u0440\u0432\u044B\u0439 \u0440\u0430\u0437? \u041F\u0440\u043E\u0441\u0442\u043E \u043D\u0430\u0436\u043C\u0438 Yandex \u0438\u043B\u0438 Telegram \u2014 \u043C\u044B \u0441\u043E\u0437\u0434\u0430\u0434\u0438\u043C \u043F\u0440\u043E\u0444\u0438\u043B\u044C \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438." })] }), tgFlow && (_jsx(TelegramCodeModal, { code: tgFlow.code, deepLink: tgFlow.deep_link, polling: tgPolling, onCopy: handleCopyCode, onCancel: handleCancelTelegram }))] }));
}
function TelegramCodeModal({ code, deepLink, polling, onCopy, onCancel, }) {
    return (_jsx("div", { role: "dialog", "aria-modal": "true", className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4", onClick: onCancel, children: _jsxs("div", { className: "relative w-full max-w-[420px] rounded-2xl border border-border bg-surface-1 p-6", onClick: (e) => e.stopPropagation(), children: [_jsx("button", { type: "button", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", onClick: onCancel, className: "absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary", children: _jsx(X, { className: "h-5 w-5" }) }), _jsx("h2", { className: "font-display text-xl font-bold text-text-primary", children: "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438 \u0432\u0445\u043E\u0434 \u0432 Telegram" }), _jsx("p", { className: "mt-2 text-[13px] text-text-muted", children: "\u041C\u044B \u043E\u0442\u043A\u0440\u044B\u043B\u0438 \u0431\u043E\u0442\u0430 \u0432 \u043D\u043E\u0432\u043E\u0439 \u0432\u043A\u043B\u0430\u0434\u043A\u0435. \u0415\u0441\u043B\u0438 \u044D\u0442\u043E\u0433\u043E \u043D\u0435 \u043F\u0440\u043E\u0438\u0437\u043E\u0448\u043B\u043E \u2014 \u043D\u0430\u0436\u043C\u0438 \u00AB\u041E\u0442\u043A\u0440\u044B\u0442\u044C Telegram\u00BB \u043D\u0438\u0436\u0435. \u041F\u043E\u0441\u043B\u0435 \u0442\u043E\u0433\u043E \u043A\u0430\u043A \u0431\u043E\u0442 \u043F\u0440\u0438\u0448\u043B\u0451\u0442 \u00AB\u0413\u043E\u0442\u043E\u0432\u043E\u00BB, \u0442\u044B \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043E\u043A\u0430\u0436\u0435\u0448\u044C\u0441\u044F \u043D\u0430 \u0441\u0430\u0439\u0442\u0435." }), _jsxs("div", { className: "mt-5 flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-4 py-3", children: [_jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted", children: "\u041A\u043E\u0434" }), _jsx("span", { className: "font-mono text-2xl font-bold tracking-[0.12em] text-text-primary", children: code })] }), _jsx("button", { type: "button", onClick: onCopy, className: "grid h-10 w-10 place-items-center rounded-md border border-border text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary", "aria-label": "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043A\u043E\u0434", children: _jsx(Copy, { className: "h-4 w-4" }) })] }), _jsxs("a", { href: deepLink, target: "_blank", rel: "noopener noreferrer", className: "mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-cyan/40 bg-cyan/15 text-[14px] font-semibold text-text-primary transition-colors hover:bg-cyan/25", children: [_jsx(ExternalLink, { className: "h-4 w-4" }), "\u041E\u0442\u043A\u0440\u044B\u0442\u044C Telegram"] }), _jsx("div", { className: "mt-4 flex items-center gap-2 text-[12px] text-text-muted", children: polling ? (_jsxs(_Fragment, { children: [_jsx(Loader2, { className: "h-4 w-4 animate-spin text-cyan" }), "\u0416\u0434\u0451\u043C \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F\u2026"] })) : (_jsxs(_Fragment, { children: [_jsx(CheckCircle2, { className: "h-4 w-4 text-success" }), "\u0413\u043E\u0442\u043E\u0432\u043E."] })) }), _jsx("button", { type: "button", onClick: onCancel, className: "mt-4 h-10 w-full rounded-lg border border-border text-[13px] font-medium text-text-muted transition-colors hover:bg-surface-2", children: "\u041E\u0442\u043C\u0435\u043D\u0430" })] }) }));
}
