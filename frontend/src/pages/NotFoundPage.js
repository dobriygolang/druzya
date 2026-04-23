import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
export default function NotFoundPage() {
    const { t } = useTranslation('pages');
    useEffect(() => {
        document.body.classList.add('v2');
        return () => document.body.classList.remove('v2');
    }, []);
    return (_jsxs("div", { className: "min-h-screen bg-bg text-text-primary", children: [_jsx("header", { className: "flex h-[72px] items-center border-b border-border bg-bg px-4 sm:px-8", children: _jsxs(Link, { to: "/", className: "flex items-center gap-2.5", children: [_jsx("span", { className: "grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-lg font-extrabold text-text-primary", children: "9" }), _jsx("span", { className: "font-display text-lg font-bold text-text-primary", children: "druz9" })] }) }), _jsxs("main", { className: "flex min-h-[calc(100vh-72px)] flex-col items-center justify-center gap-6 px-6 py-12 sm:px-10 sm:py-[60px]", children: [_jsxs("div", { className: "font-mono text-6xl sm:text-7xl lg:text-[96px] leading-none font-extrabold text-text-primary", children: [_jsx("span", { className: "text-accent", children: '{ ' }), "404", _jsx("span", { className: "text-accent", children: ' }' })] }), _jsx("h1", { className: "font-display text-2xl font-bold text-text-primary", children: t('not_found.title') }), _jsx("p", { className: "max-w-md text-center font-sans text-sm text-text-secondary", children: t('not_found.subtitle') }), t('not_found.fatal') && (_jsx("p", { className: "text-center font-sans text-sm text-text-muted", children: t('not_found.fatal') })), _jsxs("div", { className: "flex gap-3", children: [_jsxs(Link, { to: "/sanctum", "data-testid": "back-home", className: "inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-text-primary shadow-glow transition hover:bg-accent-hover", children: [_jsx(Home, { className: "h-4 w-4" }), t('not_found.home')] }), _jsx(Button, { variant: "ghost", icon: _jsx(ArrowLeft, { className: "h-4 w-4" }), onClick: () => window.history.back(), children: t('not_found.back') })] })] })] }));
}
