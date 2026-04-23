import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// Yandex OAuth callback. Регистрируется как роут /auth/callback/yandex.
//
// Yandex редиректит пользователя сюда с ?code=...&state=... после успешной
// авторизации. Мы сверяем state с тем, что положили в sessionStorage перед
// редиректом (CSRF), POST'им code на /api/v1/auth/yandex и сохраняем
// access_token.
//
// Контракт ответа (см. backend/services/auth/ports/server.go,
// AuthServer.LoginYandex → buildLoginResponse):
//   {access_token, expires_in, user: {...}}
// Refresh-токен ставится бэком в HttpOnly-cookie, фронт его не видит.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '../lib/apiClient';
import { persistAccessToken } from '../lib/queries/auth';
export default function AuthCallbackYandexPage() {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const [error, setError] = useState(null);
    useEffect(() => {
        const code = params.get('code');
        const state = params.get('state');
        const errParam = params.get('error');
        if (errParam) {
            setError(`Yandex отказал в авторизации: ${errParam}`);
            return;
        }
        if (!code) {
            setError('В ответе нет кода авторизации.');
            return;
        }
        const expected = sessionStorage.getItem('oauth_state_yandex');
        if (expected && state && expected !== state) {
            setError('CSRF state mismatch — повтори вход.');
            return;
        }
        sessionStorage.removeItem('oauth_state_yandex');
        let cancelled = false;
        void (async () => {
            try {
                const res = await api('/auth/yandex', {
                    method: 'POST',
                    body: JSON.stringify({ code, state: state ?? '' }),
                });
                if (cancelled)
                    return;
                if (res?.access_token) {
                    persistAccessToken(res.access_token);
                }
                navigate('/sanctum', { replace: true });
            }
            catch (e) {
                if (cancelled)
                    return;
                const msg = e instanceof Error ? e.message : String(e);
                setError(`Не получилось обменять код на токен: ${msg}`);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [params, navigate]);
    return (_jsx("div", { className: "grid min-h-screen place-items-center bg-bg text-text-primary", children: _jsx("div", { className: "flex max-w-md flex-col items-center gap-4 px-4 text-center", children: error ? (_jsxs(_Fragment, { children: [_jsx("h1", { className: "font-display text-2xl font-bold", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u043E\u0439\u0442\u0438" }), _jsx("p", { className: "text-[14px] text-text-muted", children: error }), _jsx(Link, { to: "/login", className: "mt-2 inline-flex h-10 items-center justify-center rounded-lg border border-border bg-surface-1 px-4 text-[14px] font-medium text-text-primary hover:bg-surface-2", children: "\u0412\u0435\u0440\u043D\u0443\u0442\u044C\u0441\u044F \u043A \u0432\u0445\u043E\u0434\u0443" })] })) : (_jsxs(_Fragment, { children: [_jsx(Loader2, { className: "h-8 w-8 animate-spin text-cyan" }), _jsx("p", { className: "text-[14px] text-text-muted", children: "\u0417\u0430\u0445\u043E\u0434\u0438\u043C \u0432 \u0442\u0432\u043E\u0439 \u043F\u0440\u043E\u0444\u0438\u043B\u044C\u2026" })] })) }) }));
}
