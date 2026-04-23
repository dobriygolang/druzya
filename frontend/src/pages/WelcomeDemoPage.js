import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// /welcome/demo — интерактивный тур по платформе для гостей и онбординга.
//
// Показывает 4 ключевых раздела (Sanctum / Arena / Daily Kata / Codex) в виде
// карточек со скриншот-плейсхолдерами, краткими описаниями и CTA «открыть
// раздел». Нет демо-видео — заменили на быстрый interactive tour, потому
// что:
//   1) короткое видео всё равно требует CDN/обновления при каждом
//      редизайне → лишний maintenance;
//   2) live-карточки сразу позволяют пользователю кликнуть и попробовать
//      раздел, что эффективнее повышает engagement.
//
// Доступ — гостям (страница не требует авторизации). При клике на CTA
// неавторизованный юзер уйдёт через /login flow.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Swords, Calendar, BookOpen, Sparkles, ChevronLeft, ChevronRight, } from 'lucide-react';
import { Button } from '../components/Button';
const STEPS = [
    {
        id: 'sanctum',
        icon: Sparkles,
        title: 'Sanctum — твой штаб',
        body: 'Дашборд с XP, текущим стриком, рекомендациями на сегодня и быстрым доступом к матчу за 5 секунд.',
        cta: { label: 'Открыть Sanctum', to: '/sanctum' },
        accentClass: 'from-cyan to-accent',
    },
    {
        id: 'arena',
        icon: Swords,
        title: 'Arena — реальные собесы',
        body: 'Парные матчи 1v1 / 2v2 с живыми соперниками. Алгоритмы, system design, behavioural — всё, что спрашивают на интервью.',
        cta: { label: 'В Арену', to: '/arena' },
        accentClass: 'from-pink to-accent',
    },
    {
        id: 'daily',
        icon: Calendar,
        title: 'Daily Kata — стрик',
        body: 'Одно тёплое задание в день, чтобы держать форму. Без него стрик не нарастёт, а с ним — растёт LP и достижения.',
        cta: { label: 'Сегодняшняя ката', to: '/daily' },
        accentClass: 'from-success to-cyan',
    },
    {
        id: 'codex',
        icon: BookOpen,
        title: 'Codex — атлас знаний',
        body: 'Шпаргалки по разделам, разбор паттернов и ссылки на разборы. Удобно открывать прямо во время Mock-сессии.',
        cta: { label: 'Открыть Codex', to: '/codex' },
        accentClass: 'from-warn to-pink',
    },
];
function StepCard({ step, active }) {
    const reduced = useReducedMotion();
    const Icon = step.icon;
    const navigate = useNavigate();
    return (_jsxs(motion.div, { initial: false, animate: {
            opacity: active ? 1 : 0.55,
            scale: active ? 1 : 0.97,
        }, transition: reduced ? { duration: 0 } : { duration: 0.25, ease: 'easeOut' }, className: "flex h-full flex-col gap-4 rounded-2xl border border-border bg-surface-1 p-6", children: [_jsx("div", { className: `grid h-14 w-14 place-items-center rounded-xl bg-gradient-to-br ${step.accentClass}`, children: _jsx(Icon, { className: "h-6 w-6 text-text-primary" }) }), _jsx("h3", { className: "font-display text-xl font-bold text-text-primary", children: step.title }), _jsx("p", { className: "text-[14px] leading-relaxed text-text-secondary", children: step.body }), _jsx("div", { className: "mt-auto", children: _jsxs(Button, { variant: "primary", onClick: () => navigate(step.cta.to), children: [step.cta.label, " ", _jsx(ArrowRight, { className: "ml-2 h-4 w-4" })] }) })] }));
}
export default function WelcomeDemoPage() {
    const [step, setStep] = useState(0);
    useEffect(() => {
        document.body.classList.add('v2');
        return () => document.body.classList.remove('v2');
    }, []);
    function go(delta) {
        setStep((s) => (s + delta + STEPS.length) % STEPS.length);
    }
    const current = STEPS[step];
    return (_jsxs("div", { className: "min-h-screen bg-bg text-text-primary", children: [_jsxs("header", { className: "flex h-[72px] items-center justify-between border-b border-border bg-bg px-4 sm:px-8 lg:px-20", children: [_jsxs(Link, { to: "/welcome", className: "flex items-center gap-2 text-sm font-medium text-text-muted hover:text-text-primary", children: [_jsx(ArrowLeft, { className: "h-4 w-4" }), " \u041D\u0430\u0437\u0430\u0434"] }), _jsxs("span", { className: "font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted", children: ["\u0428\u0430\u0433 ", step + 1, " / ", STEPS.length] })] }), _jsxs("main", { className: "mx-auto flex w-full max-w-[960px] flex-col gap-6 px-4 py-10 sm:py-16", children: [_jsxs("div", { className: "flex flex-col gap-2 text-center", children: [_jsx("h1", { className: "font-display text-3xl font-extrabold text-text-primary sm:text-4xl", children: "\u0422\u0443\u0440 \u043F\u043E druz9" }), _jsx("p", { className: "mx-auto max-w-[640px] text-text-secondary", children: "\u0427\u0435\u0442\u044B\u0440\u0435 \u044D\u043A\u0440\u0430\u043D\u0430 \u043E \u0442\u043E\u043C, \u043A\u0430\u043A \u043F\u043B\u0430\u0442\u0444\u043E\u0440\u043C\u0430 \u043F\u043E\u043C\u043E\u0436\u0435\u0442 \u0442\u0435\u0431\u0435 \u0431\u044B\u0441\u0442\u0440\u0435\u0435 \u0432\u044B\u0439\u0442\u0438 \u043D\u0430 \u043E\u0444\u0444\u0435\u0440." })] }), _jsx("div", { className: "grid grid-cols-1 gap-4 lg:grid-cols-2", children: STEPS.map((s, i) => (_jsx(StepCard, { step: s, active: i === step }, s.id))) }), _jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsxs("button", { type: "button", onClick: () => go(-1), className: "inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-1 px-4 text-sm font-medium text-text-primary hover:bg-surface-2", "aria-label": "\u041F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0438\u0439 \u0448\u0430\u0433", children: [_jsx(ChevronLeft, { className: "h-4 w-4" }), " \u041D\u0430\u0437\u0430\u0434"] }), _jsx("div", { className: "flex items-center gap-2", "aria-label": "\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0442\u0443\u0440\u0430", children: STEPS.map((s, i) => (_jsx("button", { type: "button", onClick: () => setStep(i), className: i === step
                                        ? 'h-2 w-6 rounded-full bg-accent'
                                        : 'h-2 w-2 rounded-full bg-surface-2 hover:bg-surface-3', "aria-label": `Шаг ${i + 1}`, "aria-current": i === step }, s.id))) }), _jsxs("button", { type: "button", onClick: () => go(1), className: "inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface-1 px-4 text-sm font-medium text-text-primary hover:bg-surface-2", "aria-label": "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0448\u0430\u0433", children: ["\u0414\u0430\u043B\u044C\u0448\u0435 ", _jsx(ChevronRight, { className: "h-4 w-4" })] })] }), _jsxs("div", { className: "flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface-1 p-6 text-center", children: [_jsxs("h2", { className: "font-display text-lg font-bold text-text-primary", children: ["\u0413\u043E\u0442\u043E\u0432 \u043F\u043E\u043F\u0440\u043E\u0431\u043E\u0432\u0430\u0442\u044C ", current.title.split('—')[0].trim(), "?"] }), _jsx("p", { className: "text-sm text-text-secondary", children: "\u0412\u043E\u0439\u0434\u0438 \u0438\u043B\u0438 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u0443\u0439\u0441\u044F, \u0447\u0442\u043E\u0431\u044B \u043E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u043E\u043B\u043D\u044B\u0439 \u0434\u043E\u0441\u0442\u0443\u043F." }), _jsx(Link, { to: "/login", className: "inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-text-primary hover:bg-accent-hover", children: "\u0412\u043E\u0439\u0442\u0438 \u0432 druz9" })] })] })] }));
}
