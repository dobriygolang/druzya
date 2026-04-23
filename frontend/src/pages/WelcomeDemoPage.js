import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
/**
 * Welcome demo stub. TODO: replace with real demo video / interactive tour.
 */
export default function WelcomeDemoPage() {
    useEffect(() => {
        document.body.classList.add('v2');
        return () => document.body.classList.remove('v2');
    }, []);
    return (_jsxs("div", { className: "min-h-screen bg-bg text-text-primary", children: [_jsx("header", { className: "flex h-[72px] items-center justify-between border-b border-border bg-bg px-4 sm:px-8 lg:px-20", children: _jsxs(Link, { to: "/welcome", className: "flex items-center gap-2 text-sm font-medium text-text-muted hover:text-text-primary", children: [_jsx(ArrowLeft, { className: "h-4 w-4" }), " \u041D\u0430\u0437\u0430\u0434"] }) }), _jsxs("main", { className: "mx-auto flex w-full max-w-[960px] flex-col items-center gap-6 px-4 py-10 sm:py-16", children: [_jsx("h1", { className: "text-center font-display text-3xl font-extrabold text-text-primary sm:text-4xl", children: "\u0414\u0435\u043C\u043E druz9" }), _jsx("p", { className: "max-w-[640px] text-center text-text-secondary", children: "\u0417\u0434\u0435\u0441\u044C \u0441\u043A\u043E\u0440\u043E \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u043A\u043E\u0440\u043E\u0442\u043A\u043E\u0435 \u0432\u0438\u0434\u0435\u043E-\u0437\u043D\u0430\u043A\u043E\u043C\u0441\u0442\u0432\u043E \u0441 \u043F\u043B\u0430\u0442\u0444\u043E\u0440\u043C\u043E\u0439." }), _jsx("div", { className: "grid aspect-video w-full place-items-center overflow-hidden rounded-2xl border border-border bg-surface-1 text-text-muted", children: _jsx("span", { className: "font-mono text-sm uppercase tracking-[0.12em]", children: "video coming soon" }) })] })] }));
}
