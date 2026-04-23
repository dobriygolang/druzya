import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// WeeklyReportPage — /report.
//
// Все агрегаты (XP, секции, weekly compare, streak, stress narrative)
// приходят с бэка через useWeeklyReportQuery → /api/v1/profile/me/report.
// Backend держит 5-min Redis-кеш + инвалидацию по событиям MatchCompleted/
// XPGained, см. profile/infra/report_cache.go.
import { Brain, Download, ChevronDown, Headphones } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { useWeeklyReportQuery } from '../lib/queries/weekly';
function ErrorChip() {
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C" }));
}
function HeaderRow({ period, actions, isError, }) {
    return (_jsxs("div", { className: "flex flex-col items-start gap-4 px-4 pt-6 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-20 lg:pt-8", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("h1", { className: "font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary", children: "Weekly AI Report" }), _jsxs("p", { className: "text-sm text-text-secondary", children: [period, " \u00B7 ", actions, " \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439 \u00B7 \u0441\u043A\u043E\u043B\u044C\u0437\u044F\u0449\u0438\u0439 7-\u0434\u043D\u0435\u0432\u043D\u044B\u0439 \u0430\u0433\u0440\u0435\u0433\u0430\u0442"] }), isError && _jsx(ErrorChip, {})] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("button", { className: "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-secondary", children: ["\u041F\u0440\u043E\u0448\u043B\u0430\u044F \u043D\u0435\u0434\u0435\u043B\u044F ", _jsx(ChevronDown, { className: "h-3.5 w-3.5" })] }), _jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(Download, { className: "h-3.5 w-3.5" }), children: "\u042D\u043A\u0441\u043F\u043E\u0440\u0442" })] })] }));
}
function MetricCard({ label, chip, chipColor, big, bigColor, sub, }) {
    return (_jsxs("div", { className: "flex h-[130px] flex-1 flex-col gap-2 rounded-2xl bg-surface-2 p-5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: label }), chip && (_jsx("span", { className: `rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${chipColor}`, children: chip }))] }), _jsx("span", { className: `font-display text-2xl lg:text-[32px] font-extrabold ${bigColor}`, children: big }), _jsx("span", { className: "text-[11px] text-text-muted", children: sub })] }));
}
function StatsRow({ stats }) {
    const isPositive = (delta) => delta.startsWith('+') && delta !== '+0%';
    return (_jsxs("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4", children: [_jsx(MetricCard, { label: "\u041E\u0411\u0429\u0418\u0419 XP", chip: stats.xp.delta, chipColor: isPositive(stats.xp.delta) ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger', big: stats.xp.value, bigColor: "text-accent-hover", sub: "\u0437\u0430 7 \u0434\u043D\u0435\u0439" }), _jsx(MetricCard, { label: "\u041C\u0410\u0422\u0427\u0415\u0419", chip: stats.matches.delta, chipColor: isPositive(stats.matches.delta) ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger', big: stats.matches.value, bigColor: "text-text-primary", sub: `${stats.matches.wins} W · ${stats.matches.losses} L` }), _jsx(MetricCard, { label: "\u0421\u0422\u0420\u0418\u041A", big: stats.streak.value, bigColor: "text-warn", sub: `лучшая ${stats.streak.best}` }), _jsx(MetricCard, { label: "\u0421\u0420\u0415\u0414\u041D\u0418\u0419 LP/\u041C\u0410\u0422\u0427", big: stats.avg_lp.value, bigColor: "text-success", sub: stats.avg_lp.total })] }));
}
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
function heatLevel(hour, day, daily) {
    // Бэк отдаёт 7 значений активности по дням (0..4). Распределяем эту
    // плотность равномерно по часам этого дня; чем больше day-aggregate, тем
    // выше базовая яркость для всех его клеток. Если бэк вернул [], всё 0.
    const base = daily[day] ?? 0;
    if (base <= 0)
        return 0;
    if (hour >= 9 && hour <= 22)
        return Math.min(4, base);
    return Math.max(0, base - 1);
}
const LEVEL_BG = ['bg-surface-1', 'bg-accent/20', 'bg-accent/40', 'bg-accent', 'bg-accent-hover'];
function Heatmap({ daily }) {
    return (_jsxs("div", { className: "flex flex-col gap-5 rounded-2xl bg-surface-2 p-7", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h2", { className: "font-display text-lg font-bold text-text-primary", children: "\u0410\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u044C \u043F\u043E \u0434\u043D\u044F\u043C \u0438 \u0447\u0430\u0441\u0430\u043C" }), _jsxs("div", { className: "flex gap-1 rounded-md bg-surface-1 p-1", children: [_jsx("button", { className: "rounded bg-accent px-3 py-1 text-xs font-semibold text-text-primary", children: "Heatmap" }), _jsx("button", { className: "px-3 py-1 text-xs text-text-secondary", children: "Calendar" }), _jsx("button", { className: "px-3 py-1 text-xs text-text-secondary", children: "Bar" })] })] }), _jsxs("div", { className: "flex overflow-x-auto", children: [_jsx("div", { className: "flex flex-col justify-around pr-2 text-right", children: DAYS.map((d) => (_jsx("span", { className: "font-mono text-[10px] text-text-muted", children: d }, d))) }), _jsx("div", { className: "flex flex-1 gap-1", children: Array.from({ length: 24 }).map((_, h) => (_jsxs("div", { className: "flex flex-1 flex-col items-center gap-1", children: [_jsx("div", { className: "flex flex-col gap-[3px]", children: DAYS.map((_, d) => (_jsx("div", { className: `h-[18px] w-[18px] rounded-[3px] ${LEVEL_BG[heatLevel(h, d, daily)]}` }, d))) }), _jsx("span", { className: "font-mono text-[9px] text-text-muted", children: h })] }, h))) })] }), _jsxs("div", { className: "flex items-center justify-end gap-2", children: [_jsx("span", { className: "font-mono text-[10px] text-text-muted", children: "\u041C\u0435\u043D\u044C\u0448\u0435" }), LEVEL_BG.map((bg, i) => (_jsx("div", { className: `h-3 w-3 rounded-[3px] ${bg}` }, i))), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: "\u0411\u043E\u043B\u044C\u0448\u0435" })] })] }));
}
function StrongSections({ rows }) {
    if (rows.length === 0) {
        return (_jsxs("div", { className: "flex flex-col gap-3 rounded-2xl border border-success bg-surface-2 p-5", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u0421\u0438\u043B\u044C\u043D\u044B\u0435 \u0441\u0435\u043A\u0446\u0438\u0438" }), _jsx("p", { className: "text-[12px] text-text-muted", children: "\u041F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 \u2014 \u0441\u044B\u0433\u0440\u0430\u0439 \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u043C\u0430\u0442\u0447\u0435\u0439." })] }));
    }
    return (_jsxs("div", { className: "flex flex-col gap-3 rounded-2xl border border-success bg-surface-2 p-5", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u0421\u0438\u043B\u044C\u043D\u044B\u0435 \u0441\u0435\u043A\u0446\u0438\u0438" }), rows.map((r) => (_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "grid h-9 w-9 place-items-center rounded-full bg-success/20 font-display text-sm font-bold text-success", children: r.id }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx("span", { className: "text-sm font-semibold text-text-primary", children: r.name }), _jsx("span", { className: "text-[11px] text-text-muted", children: r.sub })] }), _jsx("span", { className: "font-mono text-sm font-bold text-success", children: r.xp })] }, r.id + r.name)))] }));
}
function WeakSections({ rows }) {
    if (rows.length === 0) {
        return (_jsxs("div", { className: "flex flex-col gap-3 rounded-2xl border border-danger bg-surface-2 p-5", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u0421\u043B\u0430\u0431\u044B\u0435 \u0441\u0435\u043A\u0446\u0438\u0438" }), _jsx("p", { className: "text-[12px] text-text-muted", children: "\u0421\u043B\u0430\u0431\u044B\u0445 \u0441\u0435\u043A\u0446\u0438\u0439 \u043D\u0435\u0442 \u2014 \u043E\u0442\u043B\u0438\u0447\u043D\u0430\u044F \u043D\u0435\u0434\u0435\u043B\u044F." })] }));
    }
    return (_jsxs("div", { className: "flex flex-col gap-3 rounded-2xl border border-danger bg-surface-2 p-5", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u0421\u043B\u0430\u0431\u044B\u0435 \u0441\u0435\u043A\u0446\u0438\u0438" }), rows.map((r) => (_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: `grid h-9 w-9 place-items-center rounded-full font-display text-sm font-bold ${r.tone === 'danger' ? 'bg-danger/20 text-danger' : 'bg-warn/20 text-warn'}`, children: r.id }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx("span", { className: "text-sm font-semibold text-text-primary", children: r.name }), _jsx("span", { className: "text-[11px] text-text-muted", children: r.sub })] }), _jsx("span", { className: `font-mono text-sm font-bold ${r.tone === 'danger' ? 'text-danger' : 'text-warn'}`, children: r.xp })] }, r.id + r.name)))] }));
}
function StressPattern({ text }) {
    if (!text)
        return null;
    return (_jsxs("div", { className: "flex flex-col gap-3 rounded-2xl border border-accent-hover bg-gradient-to-br from-accent/20 to-pink/20 p-5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Brain, { className: "h-4 w-4 text-pink" }), _jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u041F\u0441\u0438\u0445\u043E\u043B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u043F\u0430\u0442\u0442\u0435\u0440\u043D" })] }), _jsx("p", { className: "text-xs leading-relaxed text-text-secondary", children: text })] }));
}
function ActionsCard({ rows }) {
    if (rows.length === 0) {
        return (_jsxs("div", { className: "flex flex-col gap-3 rounded-2xl border border-accent bg-surface-2 p-5", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u043D\u0430 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0443\u044E \u043D\u0435\u0434\u0435\u043B\u044E" }), _jsx("p", { className: "text-[12px] text-text-muted", children: "\u0420\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0430\u0446\u0438\u0438 \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u043F\u043E\u0441\u043B\u0435 \u0431\u043B\u0438\u0436\u0430\u0439\u0448\u0438\u0445 \u043C\u0430\u0442\u0447\u0435\u0439." })] }));
    }
    return (_jsxs("div", { className: "flex flex-col gap-3 rounded-2xl border border-accent bg-surface-2 p-5", children: [_jsxs("h3", { className: "font-display text-sm font-bold text-text-primary", children: [rows.length, " \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u043D\u0430 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0443\u044E \u043D\u0435\u0434\u0435\u043B\u044E"] }), rows.map((r, i) => (_jsxs("div", { className: "flex items-start gap-2 border-b border-border pb-2 last:border-0", children: [_jsx("span", { className: `mt-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${r.p === 'P1' ? 'bg-danger/15 text-danger' : 'bg-warn/15 text-warn'}`, children: r.p }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx("span", { className: "text-xs font-semibold text-text-primary", children: r.text }), r.sub && _jsx("span", { className: "text-[11px] text-text-muted", children: r.sub })] })] }, i)))] }));
}
function PodcastCard({ podcast }) {
    if (!podcast.title)
        return null;
    return (_jsxs("div", { className: "flex flex-col gap-3 rounded-2xl bg-surface-2 p-5", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u041F\u043E\u0434\u043A\u0430\u0441\u0442 \u043D\u0435\u0434\u0435\u043B\u0438" }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "grid h-12 w-12 place-items-center rounded-md bg-gradient-to-br from-pink to-accent", children: _jsx(Headphones, { className: "h-5 w-5 text-text-primary" }) }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsxs("span", { className: "text-xs font-semibold text-text-primary", children: [podcast.title, " \u00B7 ", podcast.duration] }), _jsx("span", { className: "text-[11px] text-text-muted", children: podcast.sub })] })] })] }));
}
function CompareWeeks({ rows }) {
    if (rows.length === 0)
        return null;
    return (_jsxs("div", { className: "flex flex-col gap-3 rounded-2xl bg-surface-2 p-5", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 4 \u043D\u0435\u0434\u0435\u043B\u0438" }), rows.map((r) => (_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "w-8 font-mono text-[11px] text-text-muted", children: r.label }), _jsx("div", { className: "h-2 flex-1 overflow-hidden rounded-full bg-surface-1", children: _jsx("div", { className: "h-full rounded-full bg-gradient-to-r from-cyan to-accent", style: { width: r.w } }) }), _jsx("span", { className: "w-14 text-right font-mono text-[11px] text-text-secondary", children: r.xp })] }, r.label)))] }));
}
const EMPTY_STATS = {
    xp: { value: '0', delta: '0%' },
    matches: { value: '0', wins: 0, losses: 0, delta: '0%' },
    streak: { value: '0', best: 0 },
    avg_lp: { value: '+0.0', total: '+0 lp всего' },
};
export default function WeeklyReportPage() {
    const { data, isError, isLoading } = useWeeklyReportQuery();
    // Loading skeleton — нули вместо хардкода, чтобы фронт не врал, пока бэк
    // отвечает. После готового запроса — рендерим реальные значения.
    const stats = data?.stats ?? EMPTY_STATS;
    const period = data?.period ?? (isLoading ? '…' : '—');
    const actions = data?.actions_count ?? 0;
    return (_jsxs(AppShellV2, { children: [_jsx(HeaderRow, { period: period, actions: actions, isError: isError }), _jsxs("div", { className: "flex flex-col gap-6 px-4 pb-6 pt-6 sm:px-8 lg:px-20 lg:pb-7", children: [_jsx(StatsRow, { stats: stats }), _jsx(Heatmap, { daily: data?.heatmap ?? [] }), _jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:gap-6", children: [_jsxs("div", { className: "flex flex-1 flex-col gap-5", children: [_jsx(StrongSections, { rows: data?.strong_sections ?? [] }), _jsx(WeakSections, { rows: data?.weak_sections ?? [] }), _jsx(StressPattern, { text: data?.stress_pattern ?? '' })] }), _jsxs("div", { className: "flex w-full flex-col gap-5 lg:w-[360px]", children: [_jsx(ActionsCard, { rows: data?.actions ?? [] }), _jsx(PodcastCard, { podcast: data?.podcast ?? { title: '', duration: '', sub: '' } }), _jsx(CompareWeeks, { rows: data?.compare_weeks ?? [] })] })] })] })] }));
}
