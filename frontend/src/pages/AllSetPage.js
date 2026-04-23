import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Check, Trophy, Zap, Unlock, ArrowRight } from 'lucide-react';
import { Button } from '../components/Button';
import { OnboardingTopBar } from './OnboardingPage';
function Confetti() {
    const pieces = [
        { top: -20, left: -40, color: '#FBBF24', rot: 12 },
        { top: 30, left: -70, color: '#F472B6', rot: -18 },
        { top: 140, left: -50, color: '#22D3EE', rot: 30 },
        { top: -10, left: 180, color: '#582CFF', rot: -10 },
        { top: 60, left: 200, color: '#FBBF24', rot: 22 },
        { top: 150, left: 180, color: '#F472B6', rot: -25 },
    ];
    return (_jsx(_Fragment, { children: pieces.map((p, i) => (_jsx("span", { className: "absolute block", style: {
                top: p.top,
                left: p.left,
                width: 14,
                height: 18,
                background: p.color,
                transform: `rotate(${p.rot}deg)`,
                clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
            } }, i))) }));
}
function RewardCard({ icon, iconBg, title, sub, }) {
    return (_jsxs("div", { className: "flex w-full max-w-[220px] flex-col items-center gap-2 rounded-xl border border-border bg-surface-1 p-5 text-center sm:w-[220px]", children: [_jsx("span", { className: `grid h-12 w-12 place-items-center rounded-full ${iconBg}`, children: icon }), _jsx("span", { className: "font-display text-base font-bold text-text-primary", children: title }), _jsx("span", { className: "text-[12px] text-text-muted", children: sub })] }));
}
export default function AllSetPage() {
    useEffect(() => {
        document.body.classList.add('v2');
        return () => document.body.classList.remove('v2');
    }, []);
    return (_jsxs("div", { className: "min-h-screen bg-bg text-text-primary", children: [_jsx(OnboardingTopBar, { current: 3, allDone: true, showSkip: false }), _jsxs("main", { className: "flex flex-col items-center justify-center px-4 py-8 sm:px-8 lg:px-16 lg:py-14", style: { gap: 28 }, children: [_jsxs("div", { className: "relative", children: [_jsx(Confetti, {}), _jsx("div", { className: "grid place-items-center text-text-primary", style: {
                                    width: 160,
                                    height: 160,
                                    borderRadius: 80,
                                    background: 'linear-gradient(135deg, #10B981 0%, #22D3EE 100%)',
                                    boxShadow: '0 8px 40px rgba(16,185,129,0.5)',
                                }, children: _jsx(Check, { className: "h-20 w-20 text-white", strokeWidth: 3 }) })] }), _jsx("h1", { className: "text-center font-display font-extrabold text-text-primary text-4xl sm:text-5xl lg:text-[64px]", style: { lineHeight: 1.05 }, children: "\u0413\u043E\u0442\u043E\u0432\u043E!" }), _jsx("p", { className: "max-w-[640px] text-center text-[16px] text-text-secondary", children: "\u0410\u043A\u043A\u0430\u0443\u043D\u0442 \u0441\u043E\u0437\u0434\u0430\u043D, \u0441\u0442\u0435\u043A \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D, \u043F\u0435\u0440\u0432\u0430\u044F kata \u043F\u0440\u043E\u0439\u0434\u0435\u043D\u0430. \u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C \u0432 druz9, @dima \uD83C\uDF89" }), _jsxs("div", { className: "flex flex-col gap-4 sm:flex-row", children: [_jsx(RewardCard, { icon: _jsx(Trophy, { className: "h-6 w-6 text-warn" }), iconBg: "bg-warn/15", title: "\u041F\u0435\u0440\u0432\u0430\u044F \u043A\u0440\u043E\u0432\u044C", sub: "\u0414\u043E\u0441\u0442\u0438\u0436\u0435\u043D\u0438\u0435 \u0440\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043E" }), _jsx(RewardCard, { icon: _jsx(Zap, { className: "h-6 w-6 text-cyan" }), iconBg: "bg-cyan/15", title: "+500 XP", sub: "\u0411\u043E\u043D\u0443\u0441 \u0437\u0430 \u043E\u043D\u0431\u043E\u0440\u0434\u0438\u043D\u0433" }), _jsx(RewardCard, { icon: _jsx(Unlock, { className: "h-6 w-6 text-accent-hover" }), iconBg: "bg-accent/15", title: "Ranked unlock", sub: "\u0414\u043E\u0441\u0442\u0443\u043F \u043A 1v1-\u0430\u0440\u0435\u043D\u0430\u043C" })] }), _jsxs("div", { className: "flex w-full max-w-[700px] flex-col items-start justify-between gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:p-7", style: {
                            background: 'linear-gradient(135deg, #2D1B4D 0%, #582CFF 100%)',
                        }, children: [_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("span", { className: "font-display text-[22px] font-bold text-text-primary", children: "\u041D\u0430\u0439\u0434\u0438 \u043F\u0435\u0440\u0432\u043E\u0433\u043E \u0441\u043E\u043F\u0435\u0440\u043D\u0438\u043A\u0430" }), _jsx("span", { className: "text-[13px] text-white/80", children: "\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u043F\u043E\u0434\u0431\u0438\u0440\u0430\u0435\u0442 \u043F\u0440\u043E\u0442\u0438\u0432\u043D\u0438\u043A\u0430 \u0442\u0432\u043E\u0435\u0433\u043E \u0443\u0440\u043E\u0432\u043D\u044F \u2014 \u043E\u0431\u044B\u0447\u043D\u043E 30 \u0441\u0435\u043A\u0443\u043D\u0434" })] }), _jsx(Link, { to: "/arena", children: _jsx(Button, { variant: "primary", iconRight: _jsx(ArrowRight, { className: "h-4 w-4" }), className: "!bg-white !text-bg shadow-none hover:!bg-white/90 hover:shadow-none", children: "\u0412 \u043E\u0447\u0435\u0440\u0435\u0434\u044C" }) })] }), _jsxs("div", { className: "flex flex-wrap justify-center gap-3", children: [_jsx(Link, { to: "/sanctum", className: "rounded-full border border-border bg-surface-1 px-4 py-2 text-[13px] font-medium text-text-secondary hover:border-border-strong hover:text-text-primary", children: "Daily kata" }), _jsx(Link, { to: "/sanctum", className: "rounded-full border border-border bg-surface-1 px-4 py-2 text-[13px] font-medium text-text-secondary hover:border-border-strong hover:text-text-primary", children: "\u0418\u0437\u0443\u0447\u0438\u0442\u044C \u0440\u0435\u0436\u0438\u043C\u044B" }), _jsx(Link, { to: "/sanctum", className: "rounded-full border border-border bg-surface-1 px-4 py-2 text-[13px] font-medium text-text-secondary hover:border-border-strong hover:text-text-primary", children: "\u041D\u0430\u0439\u0442\u0438 \u0434\u0440\u0443\u0437\u0435\u0439" })] })] })] }));
}
