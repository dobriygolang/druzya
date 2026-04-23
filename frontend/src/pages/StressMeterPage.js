import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { AlertTriangle, TrendingDown, Info, ThumbsUp } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Card } from '../components/Card';
function PageHeader() {
    return (_jsxs("div", { className: "flex flex-col items-start gap-4 px-4 pb-4 pt-6 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-20 lg:pb-6 lg:pt-8", children: [_jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("h1", { className: "font-display text-2xl lg:text-[28px] font-extrabold text-text-primary", children: "\u0421\u0442\u0440\u0435\u0441\u0441-\u043C\u0435\u0442\u0440\u0438\u043A\u0430" }), _jsx("p", { className: "text-sm text-text-secondary", children: "\u041C\u0438\u043A\u0440\u043E-\u0441\u0438\u0433\u043D\u0430\u043B\u044B \u0441\u0442\u0440\u0435\u0441\u0441\u0430 \u043F\u043E \u0441\u0435\u0441\u0441\u0438\u044F\u043C: \u043F\u0430\u0443\u0437\u044B, \u043E\u0442\u043A\u0430\u0442\u044B, \u043A\u043E\u043F\u0438-\u043F\u0430\u0441\u0442\u044B, \u0445\u0430\u043E\u0442\u0438\u0447\u043D\u044B\u0435 \u0434\u0432\u0438\u0436\u0435\u043D\u0438\u044F." })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("button", { className: "rounded-md border border-border bg-surface-1 px-3 py-1.5 font-mono text-xs text-text-secondary", children: "30 \u0434\u043D\u0435\u0439 \u25BE" }), _jsx("span", { className: "rounded-full bg-success/15 px-3 py-1 font-mono text-xs font-semibold text-success", children: "\u0421\u0440\u0435\u0434\u043D\u0435\u0435: 34/100 (\u043D\u043E\u0440\u043C\u0430)" })] })] }));
}
const heroMetrics = [
    { k: 'ПАУЗЫ', v: '12', sub: 'на сессию', chip: 'warn', bar: 60, color: 'bg-warn' },
    { k: 'ОТКАТЫ', v: '8', sub: 'undo за час', chip: 'cyan', bar: 40, color: 'bg-cyan' },
    { k: 'ХАОС', v: '3.2', sub: 'переключений', chip: 'success', bar: 25, color: 'bg-success' },
    { k: 'PASTE', v: '0', sub: 'честный код', chip: 'success', bar: 10, color: 'bg-success' },
];
function HeroMetrics() {
    const chipColor = {
        warn: 'bg-warn/15 text-warn',
        cyan: 'bg-cyan/15 text-cyan',
        success: 'bg-success/15 text-success',
    };
    return (_jsx("div", { className: "grid grid-cols-2 gap-4 lg:grid-cols-4", children: heroMetrics.map((m) => (_jsxs(Card, { className: "h-[140px] flex-1 flex-col justify-between p-5", interactive: false, children: [_jsxs("div", { className: "flex items-start justify-between", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: m.k }), _jsx("span", { className: `rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${chipColor[m.chip]}`, children: m.chip })] }), _jsxs("div", { className: "flex items-baseline gap-2", children: [_jsx("span", { className: "font-display text-3xl font-extrabold text-text-primary", children: m.v }), _jsx("span", { className: "text-xs text-text-muted", children: m.sub })] }), _jsx("div", { className: "h-1 overflow-hidden rounded-full bg-surface-2", children: _jsx("div", { className: `h-full ${m.color}`, style: { width: `${m.bar}%` } }) })] }, m.k))) }));
}
function StressChart() {
    const bars = Array.from({ length: 22 }).map((_, i) => {
        if (i === 16)
            return { h: 88, color: 'bg-danger', peak: true };
        if (i === 15 || i === 17)
            return { h: 60, color: 'bg-warn' };
        if (i % 3 === 0)
            return { h: 32, color: 'bg-cyan' };
        return { h: 18 + ((i * 7) % 18), color: 'bg-success' };
    });
    return (_jsxs(Card, { className: "flex-col gap-4 bg-surface-2 p-6", interactive: false, children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0421\u0442\u0440\u0435\u0441\u0441 \u043F\u043E \u043C\u0438\u043D\u0443\u0442\u0430\u043C \u00B7 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u043C\u043E\u043A" }), _jsxs("div", { className: "flex gap-1", children: [_jsx("span", { className: "rounded-md bg-danger/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-danger", children: "\u0421\u0442\u0440\u0435\u0441\u0441" }), _jsx("span", { className: "rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-text-muted", children: "\u0421\u043A\u043E\u0440\u043E\u0441\u0442\u044C" }), _jsx("span", { className: "rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-text-muted", children: "\u0422\u043E\u0447\u043D\u043E\u0441\u0442\u044C" })] })] }), _jsxs("div", { className: "flex", children: [_jsxs("div", { className: "flex h-60 flex-col justify-between pr-3 font-mono text-[10px] text-text-muted", children: [_jsx("span", { children: "100" }), _jsx("span", { children: "75" }), _jsx("span", { children: "50" }), _jsx("span", { children: "25" }), _jsx("span", { children: "0" })] }), _jsxs("div", { className: "relative flex h-60 flex-1 items-end gap-1.5 rounded-lg bg-surface-1 p-3", children: [_jsx("span", { className: "absolute left-3 right-3 border-t border-dashed border-warn/60", style: { top: '2%' } }), bars.map((b, i) => (_jsxs("div", { className: "relative flex flex-1 flex-col justify-end", children: [_jsx("div", { className: `w-full rounded-t ${b.color}`, style: { height: `${b.h}%` } }), b.peak && (_jsx("span", { className: "absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-danger px-1.5 py-0.5 font-mono text-[9px] font-semibold text-text-primary", children: "\u041F\u0418\u041A \u00B7 88/100" }))] }, i)))] })] }), _jsxs("div", { className: "flex justify-between pl-8 font-mono text-[10px] text-text-muted", children: [_jsx("span", { children: "0:00" }), _jsx("span", { children: "15:00" }), _jsx("span", { children: "30:00" }), _jsx("span", { children: "45:00" })] })] }));
}
function PatternsCard() {
    const rows = [
        { i: _jsx(AlertTriangle, { className: "h-4 w-4 text-danger" }), t: 'Стресс растёт когда таймер < 5 мин' },
        { i: _jsx(TrendingDown, { className: "h-4 w-4 text-success" }), t: 'Стресс падает после первого зелёного теста' },
        { i: _jsx(Info, { className: "h-4 w-4 text-cyan" }), t: 'На System Design — стабильно тревожнее на 22%' },
        { i: _jsx(ThumbsUp, { className: "h-4 w-4 text-warn" }), t: 'Recovery time < нормы' },
    ];
    return (_jsxs("div", { className: "flex-1 rounded-xl border border-accent-hover bg-gradient-to-br from-accent/15 to-pink/15 p-5", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u041F\u0430\u0442\u0442\u0435\u0440\u043D\u044B" }), _jsx("div", { className: "mt-4 flex flex-col gap-3", children: rows.map((r, i) => (_jsxs("div", { className: "flex items-center gap-3 rounded-lg bg-surface-1/50 p-3", children: [r.i, _jsx("span", { className: "text-xs text-text-secondary", children: r.t })] }, i))) })] }));
}
function ComparisonCard() {
    const rows = [
        ['Этот месяц', '34/100', 'text-success'],
        ['Прошлый месяц', '42/100', 'text-warn'],
        ['Дельта', '-19%', 'text-success'],
        ['Лучшая сессия', '12/100', 'text-cyan'],
    ];
    return (_jsxs(Card, { className: "flex-1 flex-col gap-3 p-5", interactive: false, children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0421\u0440\u0430\u0432\u043D\u0435\u043D\u0438\u0435" }), rows.map(([k, v, c]) => (_jsxs("div", { className: "flex items-center justify-between border-b border-border pb-2 last:border-0", children: [_jsx("span", { className: "text-sm text-text-secondary", children: k }), _jsx("span", { className: `font-mono text-sm font-semibold ${c}`, children: v })] }, k)))] }));
}
export default function StressMeterPage() {
    return (_jsxs(AppShellV2, { children: [_jsx(PageHeader, {}), _jsxs("div", { className: "flex flex-col gap-6 px-4 pb-6 sm:px-8 lg:px-20 lg:pb-7", children: [_jsx(HeroMetrics, {}), _jsx(StressChart, {}), _jsxs("div", { className: "flex flex-col gap-4 lg:flex-row", children: [_jsx(PatternsCard, {}), _jsx(ComparisonCard, {})] })] })] }));
}
