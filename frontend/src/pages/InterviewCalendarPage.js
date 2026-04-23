import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// /calendar — план подготовки к собеседованию.
//
// Источник правды — `daily.GetCalendar` (REST: GET /api/v1/daily/calendar)
// через `useInterviewCalendarQuery` в queries/calendar.ts. Все «виджетные»
// поля, которые backend не отдаёт (sections-метка, strengths/weaknesses-
// прогрессбары, AI-рекомендация), здесь УБРАНЫ — раньше они показывались
// захардкоженными цифрами и вводили пользователя в заблуждение. Когда домен
// расширится, добавим их обратно как реальные данные.
//
// Стратегия empty-states:
//   - 404 от бэка → пользователю показывается «Создай план подготовки»
//     с CTA на /daily.
//   - есть план, но пуст today_tasks → блок свернут.
//   - week_plan пуст → grid не рисуется.
import { Calendar, Check, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useInterviewCalendarQuery, priorityLabelRU } from '../lib/queries/calendar';
function ErrorChip() {
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C" }));
}
function HeaderSkeleton() {
    return (_jsx("div", { className: "relative h-auto overflow-hidden bg-gradient-to-br from-surface-3 to-accent lg:h-[220px]", children: _jsx("div", { className: "flex h-full flex-col items-start justify-between gap-4 px-4 py-6 sm:px-8 lg:flex-row lg:items-center lg:gap-0 lg:px-20 lg:py-8", children: _jsxs("div", { className: "flex w-full max-w-lg flex-col gap-3", children: [_jsx("div", { className: "h-3 w-40 animate-pulse rounded bg-white/20" }), _jsx("div", { className: "h-8 w-72 animate-pulse rounded bg-white/20" }), _jsx("div", { className: "h-3 w-56 animate-pulse rounded bg-white/15" })] }) }) }));
}
function EmptyCalendar() {
    return (_jsx(AppShellV2, { children: _jsx("div", { className: "flex w-full items-center justify-center px-4 py-12 sm:px-8 lg:px-20", children: _jsxs("div", { className: "flex w-full max-w-[640px] flex-col items-center gap-5 rounded-2xl border border-border bg-surface-1 p-8 text-center", children: [_jsx("div", { className: "grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-accent/30 to-pink/30", children: _jsx(Calendar, { className: "h-6 w-6 text-accent-hover" }) }), _jsx("h2", { className: "font-display text-2xl font-bold text-text-primary", children: "\u041F\u043B\u0430\u043D \u043F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u043A\u0438 \u0435\u0449\u0451 \u043D\u0435 \u0441\u043E\u0437\u0434\u0430\u043D" }), _jsx("p", { className: "max-w-[480px] text-sm text-text-secondary", children: "\u0423\u043A\u0430\u0436\u0438 \u0434\u0430\u0442\u0443 \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043E\u0432\u0430\u043D\u0438\u044F \u0438 \u043A\u043E\u043C\u043F\u0430\u043D\u0438\u044E \u2014 \u043C\u044B \u0441\u043E\u0431\u0435\u0440\u0451\u043C \u0435\u0436\u0435\u0434\u043D\u0435\u0432\u043D\u044B\u0435 \u0437\u0430\u0434\u0430\u0447\u0438 \u0438 \u043E\u0446\u0435\u043D\u0438\u043C \u0433\u043E\u0442\u043E\u0432\u043D\u043E\u0441\u0442\u044C \u043F\u043E \u0440\u0430\u0437\u0434\u0435\u043B\u0430\u043C." }), _jsx(Link, { to: "/daily", className: "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-text-primary shadow-glow hover:bg-accent/90", children: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u043F\u043B\u0430\u043D" })] }) }) }));
}
function DayCell({ d, state }) {
    const cls = state === 'done' ? 'border-success/40 bg-success/10 text-success' :
        state === 'active' ? 'border-accent bg-accent/15 text-text-primary shadow-glow' :
            state === 'final' ? 'border-danger/60 bg-danger/15 text-danger shadow-[0_0_20px_rgba(239,68,68,0.4)]' :
                'border-border bg-surface-1 text-text-muted';
    return (_jsxs("div", { className: `flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg border ${cls}`, children: [_jsx("span", { className: "font-display text-sm font-bold", children: state === 'final' ? 'СОБЕС' : d }), state === 'active' && _jsx("span", { className: "font-mono text-[9px] text-accent-hover", children: "\u0441\u0435\u0433\u043E\u0434\u043D\u044F" }), state === 'done' && _jsx(Check, { className: "h-3 w-3" })] }));
}
// renderWeekGrid строит 21-дневную сетку, ставя «active» на сегодняшний
// день (по индексу относительно days_left) и «final» — на последний.
// Всё, что раньше = done; всё после, кроме final = future.
function renderWeekGrid(daysLeft) {
    const totalDays = 21;
    // Если до собеса больше 21 дня — рисуем 3 будущих недели; если меньше —
    // первые (totalDays - daysLeft) считаем «done», текущий — «active»,
    // последний — «final» (день X).
    const todayIdx = Math.max(0, Math.min(totalDays - 1, totalDays - daysLeft));
    const finalIdx = Math.max(todayIdx, Math.min(totalDays - 1, todayIdx + Math.min(daysLeft, totalDays - 1)));
    return [0, 1, 2].map((row) => (_jsx("div", { className: "grid grid-cols-7 gap-2", children: Array.from({ length: 7 }).map((_, col) => {
            const d = row * 7 + col;
            let state = 'future';
            if (d < todayIdx)
                state = 'done';
            else if (d === todayIdx)
                state = 'active';
            else if (d === finalIdx)
                state = 'final';
            return _jsx(DayCell, { d: d + 1, state: state }, d);
        }) }, row)));
}
export default function InterviewCalendarPage() {
    const { data, isError, isLoading, error } = useInterviewCalendarQuery();
    const status = error?.status;
    if (isLoading) {
        return (_jsxs(AppShellV2, { children: [_jsx(HeaderSkeleton, {}), _jsx("div", { className: "flex flex-col gap-4 px-4 py-8 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:py-10", children: _jsxs("div", { className: "flex flex-1 flex-col gap-4", children: [_jsx("div", { className: "h-32 animate-pulse rounded-xl border border-border bg-surface-1" }), _jsx("div", { className: "h-48 animate-pulse rounded-xl border border-border bg-surface-1" })] }) })] }));
    }
    if (status === 404 || (!data && !isError)) {
        return _jsx(EmptyCalendar, {});
    }
    if (!data) {
        return (_jsx(AppShellV2, { children: _jsx("div", { className: "px-4 py-12 sm:px-8 lg:px-20", children: _jsx(ErrorChip, {}) }) }));
    }
    const { role, days_left, readiness_pct, countdown, today_tasks, weak_zones } = data;
    const hasCountdown = countdown.length > 0;
    const heading = days_left > 0 ? `Собеседование через ${days_left} дней` : 'Собеседование сегодня';
    return (_jsxs(AppShellV2, { children: [_jsx("div", { className: "relative h-auto overflow-hidden bg-gradient-to-br from-surface-3 to-accent lg:h-[220px]", children: _jsxs("div", { className: "flex h-full flex-col items-start justify-between gap-4 px-4 py-6 sm:px-8 lg:flex-row lg:items-center lg:gap-0 lg:px-20 lg:py-8", children: [_jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("span", { className: "inline-flex w-fit items-center gap-2 rounded-md bg-warn/20 px-3 py-1 font-mono text-[11px] font-bold tracking-[0.08em] text-warn", children: [_jsx("span", { className: "h-1.5 w-1.5 animate-pulse rounded-full bg-warn" }), "\u0410\u041A\u0422\u0418\u0412\u041D\u0410\u042F \u041F\u041E\u0414\u0413\u041E\u0422\u041E\u0412\u041A\u0410"] }), _jsx("h1", { className: "font-display text-2xl sm:text-3xl lg:text-[36px] font-extrabold text-text-primary", children: heading }), _jsx("p", { className: "text-sm text-white/80", children: role }), isError && _jsx(ErrorChip, {}), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-xs text-white/80", children: "\u0413\u043E\u0442\u043E\u0432\u043D\u043E\u0441\u0442\u044C" }), _jsx("div", { className: "h-2 w-[160px] sm:w-[240px] overflow-hidden rounded-full bg-black/40", children: _jsx("div", { className: "h-full rounded-full bg-gradient-to-r from-cyan to-accent", style: { width: `${Math.max(0, Math.min(100, readiness_pct))}%` } }) }), _jsxs("span", { className: "font-mono text-sm font-bold text-cyan", children: [readiness_pct, "%"] })] })] }), hasCountdown && (_jsxs("div", { className: "flex flex-col gap-3 rounded-xl bg-bg/40 p-5 backdrop-blur", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-white/70", children: "\u041E\u0421\u0422\u0410\u041B\u041E\u0421\u042C" }), _jsx("span", { className: "font-display text-3xl font-extrabold text-text-primary", children: countdown }), _jsx(Button, { variant: "ghost", size: "sm", className: "border-white/30 text-text-primary hover:bg-white/10", icon: _jsx(Calendar, { className: "h-3.5 w-3.5" }), children: "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0434\u0430\u0442\u0443" })] }))] }) }), _jsxs("div", { className: "flex flex-col gap-4 px-4 py-8 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:py-10", children: [_jsxs("div", { className: "flex flex-1 flex-col gap-8", children: [_jsxs("div", { className: "flex flex-col gap-3", children: [_jsx("h2", { className: "font-display text-lg font-bold text-text-primary", children: "\u041F\u043B\u0430\u043D \u043D\u0430 \u0441\u0435\u0433\u043E\u0434\u043D\u044F" }), today_tasks.length === 0 ? (_jsxs(Card, { className: "flex-col gap-2 p-5 text-sm text-text-muted", children: ["\u041D\u0430 \u0441\u0435\u0433\u043E\u0434\u043D\u044F \u0437\u0430\u0434\u0430\u0447 \u043D\u0435\u0442 \u2014 \u043E\u0442\u0434\u044B\u0445\u0430\u0439 \u0438\u043B\u0438 \u0432\u043E\u0437\u044C\u043C\u0438 kata \u0438\u0437", ' ', _jsx(Link, { to: "/daily", className: "text-accent-hover hover:underline", children: "/daily" }), "."] })) : (_jsx("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3", children: today_tasks.map((t) => (_jsxs(Card, { className: `flex-col gap-2 p-5 ${t.status === 'active' ? 'border-accent shadow-glow' : ''} ${t.status === 'future' ? 'opacity-60' : ''}`, children: [_jsxs("div", { className: "flex items-center justify-between", children: [t.status === 'done' && (_jsx("span", { className: "grid h-6 w-6 place-items-center rounded-full bg-success text-bg", children: _jsx(Check, { className: "h-3.5 w-3.5" }) })), t.status === 'active' && (_jsx("span", { className: "rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-bold text-accent-hover", children: "\u0421\u0415\u0419\u0427\u0410\u0421" })), t.status === 'future' && (_jsx("span", { className: "font-mono text-[10px] text-text-muted", children: "\u041F\u041E\u0417\u0416\u0415" }))] }), _jsx("span", { className: "font-display text-sm font-bold text-text-primary", children: t.title }), _jsx("span", { className: "text-xs text-text-muted", children: t.sub })] }, t.id))) }))] }), _jsxs("div", { className: "flex flex-col gap-3", children: [_jsx("h2", { className: "font-display text-lg font-bold text-text-primary", children: "21-\u0434\u043D\u0435\u0432\u043D\u044B\u0439 \u043F\u043B\u0430\u043D" }), _jsx("div", { className: "flex flex-col gap-2", children: renderWeekGrid(days_left) })] })] }), _jsxs("div", { className: "flex w-full flex-col gap-4 lg:w-[360px]", children: [weak_zones.length > 0 && (_jsxs(Card, { className: "flex-col gap-3 border-danger/40 p-5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(AlertTriangle, { className: "h-4 w-4 text-danger" }), _jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u0421\u043B\u0430\u0431\u044B\u0435 \u0437\u043E\u043D\u044B" })] }), weak_zones.map((wz) => (_jsxs("div", { className: "flex items-center justify-between rounded-md bg-surface-2 px-3 py-2", children: [_jsx("span", { className: "text-xs text-text-secondary", children: wz.atlas_node_key }), _jsx("span", { className: "font-mono text-[10px] font-bold uppercase text-danger", children: priorityLabelRU(wz.priority) })] }, wz.atlas_node_key))), _jsx(Link, { to: "/atlas", className: "mt-1 inline-flex items-center justify-center rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text-secondary hover:border-border-strong hover:text-text-primary", children: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0430\u0442\u043B\u0430\u0441" })] })), _jsxs(Card, { className: "flex-col gap-2 p-5", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u041D\u0435\u0434\u0435\u043B\u044C\u043D\u044B\u0439 \u043F\u043B\u0430\u043D" }), data.week_plan.length === 0 ? (_jsx("span", { className: "text-xs text-text-muted", children: "\u041F\u043B\u0430\u043D \u043D\u0430 \u043D\u0435\u0434\u0435\u043B\u044E \u043F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442." })) : (data.week_plan.slice(0, 7).map((entry) => (_jsxs("div", { className: "flex items-center justify-between border-b border-border/60 py-1.5 last:border-b-0", children: [_jsx("span", { className: "font-mono text-[11px] text-text-muted", children: entry.date }), _jsxs("span", { className: "font-mono text-[11px] text-text-secondary", children: [entry.tasks.length, " \u0437\u0430\u0434\u0430\u0447"] })] }, entry.date))))] })] })] })] }));
}
