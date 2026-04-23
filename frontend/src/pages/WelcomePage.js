import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button';
import { usePublicStats } from '../lib/api/stats';
function MinimalTopBar() {
    const { t } = useTranslation('welcome');
    return (_jsxs("header", { className: "flex h-[64px] items-center justify-between border-b border-border bg-bg px-4 sm:px-8 lg:h-[80px] lg:px-20", children: [_jsxs(Link, { to: "/welcome", className: "flex items-center gap-2.5", children: [_jsx("span", { className: "grid h-9 w-9 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-lg font-extrabold text-text-primary", children: "9" }), _jsx("span", { className: "font-display text-xl font-bold text-text-primary", children: "druz9" })] }), _jsx(Link, { to: "/login", className: "rounded-md px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary", children: t('login') })] }));
}
function TrustLogo({ name }) {
    return (_jsx("div", { className: "grid h-10 w-[120px] place-items-center rounded-md border border-border bg-surface-2 font-display text-sm font-bold text-text-muted", children: name }));
}
export default function WelcomePage() {
    const { t } = useTranslation('welcome');
    const navigate = useNavigate();
    const stats = usePublicStats();
    const developersCount = stats.data?.users_count ?? 0;
    useEffect(() => {
        document.body.classList.add('v2');
        return () => document.body.classList.remove('v2');
    }, []);
    return (_jsxs("div", { className: "min-h-screen bg-bg text-text-primary", children: [_jsx(MinimalTopBar, {}), _jsxs("main", { className: "flex flex-col items-center justify-center gap-7 px-4 pb-12 pt-10 sm:px-8 lg:px-20 lg:pb-20 lg:pt-[60px]", children: [_jsxs("span", { className: "inline-flex items-center gap-2 rounded-full border border-cyan/30 bg-cyan/10 px-4 py-1.5 text-[13px] font-medium text-cyan", children: [_jsxs("span", { className: "relative grid h-2 w-2 place-items-center", children: [_jsx("span", { className: "absolute inset-0 animate-ping rounded-full bg-cyan opacity-75" }), _jsx("span", { className: "relative h-2 w-2 rounded-full bg-cyan" })] }), stats.isLoading
                                ? t('developers_inside', { count: 0 }).replace(/\d+/, '—')
                                : t('developers_inside', { count: developersCount }), _jsx(ArrowRight, { className: "h-3.5 w-3.5" })] }), _jsx("h1", { className: "text-center font-display font-extrabold text-text-primary", style: { fontSize: 'clamp(40px, 9vw, 80px)', lineHeight: 1.05, letterSpacing: '-0.03em', maxWidth: 1200, fontWeight: 800 }, children: t('headline_1') }), _jsx("h2", { className: "text-center font-display font-extrabold", style: {
                            fontSize: 'clamp(40px, 9vw, 80px)',
                            lineHeight: 1.05,
                            letterSpacing: '-0.03em',
                            maxWidth: 1200,
                            fontWeight: 800,
                            background: 'linear-gradient(90deg, #22D3EE 0%, #582CFF 50%, #F472B6 100%)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            backgroundClip: 'text',
                        }, children: t('headline_2') }), _jsx("p", { className: "max-w-[720px] text-center font-sans text-[18px] leading-relaxed text-text-secondary", children: t('subhead') }), _jsxs("div", { className: "mt-2 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4", children: [_jsx(Link, { to: "/login", className: "w-full sm:w-auto", children: _jsx(Button, { variant: "primary", iconRight: _jsx(ArrowRight, { className: "h-5 w-5" }), className: "h-14 w-full justify-center px-7 text-[15px] shadow-glow sm:w-auto", children: t('start_free') }) }), _jsx(Button, { variant: "ghost", icon: _jsx(Play, { className: "h-4 w-4" }), className: "h-14 w-full justify-center px-6 text-[15px] sm:w-auto", onClick: () => navigate('/welcome/demo'), children: t('watch_demo') })] }), _jsxs("div", { className: "mt-10 flex flex-col items-center gap-4", children: [_jsx("span", { className: "font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted", children: t('developers_from') }), _jsxs("div", { className: "flex flex-wrap items-center justify-center gap-3 sm:gap-5", children: [_jsx(TrustLogo, { name: "YANDEX" }), _jsx(TrustLogo, { name: "VK" }), _jsx(TrustLogo, { name: "OZON" }), _jsx(TrustLogo, { name: "AVITO" })] })] })] })] }));
}
