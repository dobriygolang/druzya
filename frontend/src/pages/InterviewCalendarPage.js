import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { Calendar, Check, RefreshCw, TrendingUp, AlertTriangle, Sparkles } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useInterviewCalendarQuery } from '../lib/queries/calendar';
function ErrorChip() {
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C" }));
}
const STRENGTHS = [
    { label: 'Алгоритмы — Easy/Medium', value: 92 },
    { label: 'Go · конкурентность', value: 84 },
    { label: 'SQL · оконные функции', value: 78 },
];
const WEAKNESSES = [
    { label: 'Dynamic Programming', value: 38 },
    { label: 'System Design — большие масштабы', value: 44 },
    { label: 'Behavioral на английском', value: 52 },
    { label: 'Tree DP / Segment Tree', value: 31 },
];
function DayCell({ d, state }) {
    const cls = state === 'done' ? 'border-success/40 bg-success/10 text-success' :
        state === 'active' ? 'border-accent bg-accent/15 text-text-primary shadow-glow' :
            state === 'final' ? 'border-danger/60 bg-danger/15 text-danger shadow-[0_0_20px_rgba(239,68,68,0.4)]' :
                'border-border bg-surface-1 text-text-muted';
    return (_jsxs("div", { className: `flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg border ${cls}`, children: [_jsx("span", { className: "font-display text-sm font-bold", children: state === 'final' ? 'СОБЕС' : d }), state === 'active' && _jsx("span", { className: "font-mono text-[9px] text-accent-hover", children: "\u0441\u0435\u0439\u0447\u0430\u0441" }), state === 'done' && _jsx(Check, { className: "h-3 w-3" })] }));
}
export default function InterviewCalendarPage() {
    const { data, isError } = useInterviewCalendarQuery();
    const company = data?.company ?? 'YANDEX';
    const daysLeft = data?.days_left ?? 17;
    const role = data?.role ?? 'Senior Backend';
    const sections = data?.sections ?? 'Алгоритмы + System Design + Behavioral';
    const readiness = data?.readiness_pct ?? 62;
    const countdown = data?.countdown ?? '17д 04ч 12м';
    const todayTasks = data?.today_tasks ?? [
        { id: 't1', title: 'Two Pointers · Easy', sub: '15 мин · 2 задачи', status: 'done' },
        { id: 't2', title: 'Mock System Design · кэш-инвалидация', sub: '40 мин · с AI-интервьюером', status: 'active' },
        { id: 't3', title: 'Behavioral · STAR-история про конфликт', sub: '20 мин · запись + разбор', status: 'future' },
    ];
    const strengths = data?.strengths ?? STRENGTHS;
    const weaknesses = data?.weaknesses ?? WEAKNESSES;
    const aiRec = data?.ai_recommendation ?? 'Завтра — 60 минут на DP: Knapsack + LIS. После — 1 mock с AI-интервьюером (System Design: дизайн ленты Twitter). Это закроет 2 главных пробела перед собесом.';
    return (_jsxs(AppShellV2, { children: [_jsx("div", { className: "relative h-auto overflow-hidden bg-gradient-to-br from-surface-3 to-accent lg:h-[220px]", children: _jsxs("div", { className: "flex h-full flex-col items-start justify-between gap-4 px-4 py-6 sm:px-8 lg:flex-row lg:items-center lg:gap-0 lg:px-20 lg:py-8", children: [_jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("span", { className: "inline-flex w-fit items-center gap-2 rounded-md bg-warn/20 px-3 py-1 font-mono text-[11px] font-bold tracking-[0.08em] text-warn", children: [_jsx("span", { className: "h-1.5 w-1.5 animate-pulse rounded-full bg-warn" }), "\u0410\u041A\u0422\u0418\u0412\u041D\u0410\u042F \u041F\u041E\u0414\u0413\u041E\u0422\u041E\u0412\u041A\u0410 \u00B7 ", company.toUpperCase()] }), _jsxs("h1", { className: "font-display text-2xl sm:text-3xl lg:text-[36px] font-extrabold text-text-primary", children: ["\u0421\u043E\u0431\u0435\u0441\u0435\u0434\u043E\u0432\u0430\u043D\u0438\u0435 \u0447\u0435\u0440\u0435\u0437 ", daysLeft, " \u0434\u043D\u0435\u0439"] }), _jsxs("p", { className: "text-sm text-white/80", children: [role, " \u00B7 ", sections] }), isError && _jsx(ErrorChip, {}), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-xs text-white/80", children: "\u0413\u043E\u0442\u043E\u0432\u043D\u043E\u0441\u0442\u044C" }), _jsx("div", { className: "h-2 w-[160px] sm:w-[240px] overflow-hidden rounded-full bg-black/40", children: _jsx("div", { className: "h-full rounded-full bg-gradient-to-r from-cyan to-accent", style: { width: `${readiness}%` } }) }), _jsxs("span", { className: "font-mono text-sm font-bold text-cyan", children: [readiness, "%"] })] })] }), _jsxs("div", { className: "flex flex-col gap-3 rounded-xl bg-bg/40 p-5 backdrop-blur", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-white/70", children: "\u041E\u0421\u0422\u0410\u041B\u041E\u0421\u042C" }), _jsx("span", { className: "font-display text-3xl font-extrabold text-text-primary", children: countdown }), _jsx(Button, { variant: "ghost", size: "sm", className: "border-white/30 text-text-primary hover:bg-white/10", icon: _jsx(Calendar, { className: "h-3.5 w-3.5" }), children: "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0434\u0430\u0442\u0443" })] })] }) }), _jsxs("div", { className: "flex flex-col gap-4 px-4 py-8 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:py-10", children: [_jsxs("div", { className: "flex flex-1 flex-col gap-8", children: [_jsxs("div", { className: "flex flex-col gap-3", children: [_jsx("h2", { className: "font-display text-lg font-bold text-text-primary", children: "\u041F\u043B\u0430\u043D \u043D\u0430 \u0441\u0435\u0433\u043E\u0434\u043D\u044F" }), _jsx("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3", children: todayTasks.map((t) => (_jsxs(Card, { className: `flex-col gap-2 p-5 ${t.status === 'active' ? 'border-accent shadow-glow' : ''} ${t.status === 'future' ? 'opacity-60' : ''}`, children: [_jsxs("div", { className: "flex items-center justify-between", children: [t.status === 'done' && _jsx("span", { className: "grid h-6 w-6 place-items-center rounded-full bg-success text-bg", children: _jsx(Check, { className: "h-3.5 w-3.5" }) }), t.status === 'active' && _jsx("span", { className: "rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-bold text-accent-hover", children: "\u0421\u0415\u0419\u0427\u0410\u0421" }), t.status === 'future' && _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: "\u041F\u041E\u0417\u0416\u0415" })] }), _jsx("span", { className: "font-display text-sm font-bold text-text-primary", children: t.title }), _jsx("span", { className: "text-xs text-text-muted", children: t.sub })] }, t.id))) })] }), _jsxs("div", { className: "flex flex-col gap-3", children: [_jsx("h2", { className: "font-display text-lg font-bold text-text-primary", children: "21-\u0434\u043D\u0435\u0432\u043D\u044B\u0439 \u043F\u043B\u0430\u043D" }), _jsx("div", { className: "flex flex-col gap-2", children: [0, 1, 2].map((row) => (_jsx("div", { className: "grid grid-cols-7 gap-2", children: Array.from({ length: 7 }).map((_, col) => {
                                                const d = row * 7 + col + 1;
                                                let state = 'future';
                                                if (d <= 3)
                                                    state = 'done';
                                                else if (d === 4)
                                                    state = 'active';
                                                else if (d === 21)
                                                    state = 'final';
                                                return _jsx(DayCell, { d: d, state: state }, d);
                                            }) }, row))) })] })] }), _jsxs("div", { className: "flex w-full flex-col gap-4 lg:w-[360px]", children: [_jsxs(Card, { className: "flex-col gap-3 border-success/40 p-5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(TrendingUp, { className: "h-4 w-4 text-success" }), _jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u0421\u0438\u043B\u044C\u043D\u044B\u0435 \u0441\u0442\u043E\u0440\u043E\u043D\u044B" })] }), strengths.map((s) => (_jsxs("div", { className: "flex flex-col gap-1", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-xs text-text-secondary", children: s.label }), _jsxs("span", { className: "font-mono text-xs font-bold text-success", children: [s.value, "%"] })] }), _jsx("div", { className: "h-1.5 overflow-hidden rounded-full bg-surface-2", children: _jsx("div", { className: "h-full rounded-full bg-success", style: { width: `${s.value}%` } }) })] }, s.label)))] }), _jsxs(Card, { className: "flex-col gap-3 border-danger/40 p-5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(AlertTriangle, { className: "h-4 w-4 text-danger" }), _jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u0421\u043B\u0430\u0431\u044B\u0435 \u043C\u0435\u0441\u0442\u0430" })] }), weaknesses.map((s) => (_jsxs("div", { className: "flex flex-col gap-1", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-xs text-text-secondary", children: s.label }), _jsxs("span", { className: "font-mono text-xs font-bold text-danger", children: [s.value, "%"] })] }), _jsx("div", { className: "h-1.5 overflow-hidden rounded-full bg-surface-2", children: _jsx("div", { className: "h-full rounded-full bg-danger", style: { width: `${s.value}%` } }) })] }, s.label)))] }), _jsxs(Card, { className: "flex-col gap-3 p-5 bg-gradient-to-br from-accent to-pink border-accent/40 shadow-glow", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Sparkles, { className: "h-4 w-4 text-text-primary" }), _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-primary", children: "AI \u0420\u0415\u041A\u041E\u041C\u0415\u041D\u0414\u0410\u0426\u0418\u042F" })] }), _jsx("button", { className: "grid h-7 w-7 place-items-center rounded-md bg-white/20 text-text-primary hover:bg-white/30", children: _jsx(RefreshCw, { className: "h-3.5 w-3.5" }) })] }), _jsx("p", { className: "text-xs leading-relaxed text-white/90", children: aiRec }), _jsx(Button, { variant: "ghost", size: "sm", className: "border-white/30 text-text-primary hover:bg-white/10", children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432 \u043F\u043B\u0430\u043D" })] })] })] })] }));
}
