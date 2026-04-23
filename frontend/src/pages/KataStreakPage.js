import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Snowflake, Gem, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { useKataStreakQuery } from '../lib/queries/streak';
function ErrorChip() {
    const { t } = useTranslation('pages');
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: t('common.load_failed') }));
}
const MONTHS = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];
const CELL_COLOR = {
    success: 'bg-success',
    warn: 'bg-warn',
    danger: 'bg-danger',
    cyan: 'bg-cyan',
    future: 'bg-border-strong',
};
function Hero({ current, best, freezeTokens, freezeMax }) {
    const { t } = useTranslation('pages');
    return (_jsx("div", { className: "relative h-auto overflow-hidden bg-gradient-to-br from-surface-3 via-surface-3 to-warn/70 px-4 py-6 sm:px-8 lg:h-[220px] lg:px-20 lg:py-8", children: _jsxs("div", { className: "flex h-full flex-col items-start justify-between gap-6 lg:flex-row lg:items-center lg:gap-0", children: [_jsxs("div", { className: "flex flex-col gap-3", children: [_jsx("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-3 py-1 font-mono text-[11px] font-bold tracking-[0.08em] text-warn", children: t('kata_streak.streak_of', { n: current }) }), _jsxs("div", { className: "flex items-end gap-3", children: [_jsx("span", { className: "font-display text-6xl sm:text-7xl lg:text-[96px] font-extrabold leading-none text-text-primary", children: current }), _jsx("span", { className: "text-4xl sm:text-5xl lg:text-[64px] leading-none", children: "\uD83D\uDD25" }), _jsxs("div", { className: "flex flex-col gap-0.5 pb-2", children: [_jsx("span", { className: "font-mono text-sm text-text-secondary", children: t('kata_streak.days_in_row') }), _jsx("span", { className: "font-mono text-xs text-text-muted", children: t('kata_streak.best', { n: best }) })] })] })] }), _jsxs("div", { className: "flex flex-col items-end gap-3", children: [_jsx("span", { className: "font-mono text-[11px] font-bold tracking-[0.08em] text-text-secondary", children: t('kata_streak.freeze_tokens') }), _jsx("div", { className: "flex gap-2", children: Array.from({ length: freezeMax }).map((_, i) => (_jsx("div", { className: "grid h-8 w-8 place-items-center rounded-lg", style: { background: '#00000050' }, children: _jsx(Snowflake, { className: `h-4 w-4 ${i < freezeTokens ? 'text-cyan' : 'text-text-muted/40'}` }) }, i))) }), _jsx("span", { className: "font-mono text-xs text-text-secondary", children: t('kata_streak.available', { a: freezeTokens, b: freezeMax }) }), _jsxs(Button, { variant: "ghost", size: "sm", className: "border-white text-text-primary", children: [t('kata_streak.buy_more'), " ", _jsx(Gem, { className: "ml-1 inline h-3 w-3 text-cyan" })] })] })] }) }));
}
function CalendarCard({ year, done, missed, freeze, remaining, months }) {
    const { t } = useTranslation('pages');
    return (_jsxs("div", { className: "flex flex-col gap-5 rounded-2xl bg-surface-2 p-6", children: [_jsxs("div", { className: "flex items-end justify-between", children: [_jsx("h2", { className: "font-display text-xl font-bold text-text-primary", children: t('kata_streak.calendar', { year }) }), _jsxs("div", { className: "flex gap-6", children: [_jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-display text-base font-bold text-success", children: done }), _jsx("span", { className: "text-[10px] text-text-muted", children: t('kata_streak.done') })] }), _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-display text-base font-bold text-danger", children: missed }), _jsx("span", { className: "text-[10px] text-text-muted", children: t('kata_streak.missed') })] }), _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-display text-base font-bold text-cyan", children: freeze }), _jsx("span", { className: "text-[10px] text-text-muted", children: t('kata_streak.freeze') })] }), _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-display text-base font-bold text-text-secondary", children: remaining }), _jsx("span", { className: "text-[10px] text-text-muted", children: t('kata_streak.left') })] })] })] }), _jsx("div", { className: "flex justify-between gap-3 overflow-x-auto", children: months.map((mo, mi) => {
                    const cells = [];
                    for (let i = 0; i < 35; i++) {
                        if (i >= mo.total) {
                            cells.push('future');
                        }
                        else if (i < mo.done) {
                            const seed = (mi * 11 + i * 7) % 19;
                            if (seed === 0)
                                cells.push('cyan');
                            else if (seed === 1)
                                cells.push('warn');
                            else
                                cells.push('success');
                        }
                        else if (mo.done === 0 && mi >= 4) {
                            cells.push('future');
                        }
                        else {
                            cells.push('danger');
                        }
                    }
                    const isPast = mo.done > 0;
                    return (_jsxs("div", { className: "flex flex-1 flex-col items-center gap-2", children: [_jsx("span", { className: "font-mono text-[10px] font-semibold text-text-muted", children: mo.name }), _jsx("div", { className: "grid grid-cols-7 gap-[2px]", children: cells.map((c, i) => (_jsx("div", { className: `h-3 w-3 rounded-[2px] ${CELL_COLOR[c]}` }, i))) }), _jsxs("span", { className: `font-mono text-[10px] ${isPast ? 'text-success' : 'text-text-muted'}`, children: [mo.done, "/", mo.total] })] }, mo.name));
                }) })] }));
}
function TodayCard({ today }) {
    const { t } = useTranslation('pages');
    return (_jsxs("div", { className: "flex w-full flex-col gap-4 rounded-2xl bg-gradient-to-br from-surface-3 to-accent p-6 lg:w-[480px]", children: [_jsx("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-2.5 py-1 font-mono text-[11px] font-bold text-warn", children: t('kata_streak.today', { n: today.day }) }), _jsx("h3", { className: "font-display text-2xl font-bold text-text-primary", children: today.title }), _jsxs("div", { className: "flex gap-2", children: [_jsx("span", { className: "rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-text-secondary", children: today.difficulty }), _jsx("span", { className: "rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-text-secondary", children: today.section }), _jsx("span", { className: "rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] text-text-secondary", children: today.complexity })] }), _jsxs("div", { className: "mt-auto flex items-end justify-between", children: [_jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-display text-xl font-bold text-cyan", children: today.time_left }), _jsx("span", { className: "text-[11px] text-text-muted", children: t('kata_streak.time_left') })] }), _jsx(Button, { variant: "primary", iconRight: _jsx(ArrowRight, { className: "h-4 w-4" }), className: "bg-text-primary text-bg shadow-none hover:bg-white/90", children: t('kata_streak.solve_now') })] })] }));
}
function CursedCard() {
    const { t } = useTranslation('pages');
    return (_jsxs("div", { className: "flex flex-1 flex-col gap-3 rounded-2xl border-2 border-danger p-6", style: { background: 'linear-gradient(135deg, #2A0510 0%, #1A1A2E 100%)' }, children: [_jsx("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-danger/20 px-2.5 py-1 font-mono text-[11px] font-bold text-danger", children: t('kata_streak.cursed_friday') }), _jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: t('kata_streak.cursed_title') }), _jsx("p", { className: "text-xs text-text-secondary", children: t('kata_streak.cursed_desc') }), _jsx("div", { className: "mt-auto", children: _jsx("span", { className: "inline-flex items-center gap-1.5 rounded-full bg-danger/15 px-3 py-1 font-mono text-[11px] font-bold text-danger", children: t('kata_streak.cursed_next') }) })] }));
}
function BossCard() {
    const { t } = useTranslation('pages');
    return (_jsxs("div", { className: "flex flex-1 flex-col gap-3 rounded-2xl border-2 border-pink bg-gradient-to-br from-surface-3 to-pink p-6", children: [_jsx("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 font-mono text-[11px] font-bold text-text-primary", children: t('kata_streak.boss') }), _jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: t('kata_streak.boss_title') }), _jsx("p", { className: "text-xs text-white/80", children: t('kata_streak.boss_desc') }), _jsx("div", { className: "mt-auto", children: _jsx("span", { className: "inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 font-mono text-[11px] font-bold text-text-primary", children: t('kata_streak.boss_when') }) })] }));
}
export default function KataStreakPage() {
    const { data, isError } = useKataStreakQuery();
    const today = data?.today ?? { title: 'Binary Search Rotated', difficulty: 'Medium', section: 'Algorithms', complexity: 'O(log n)', time_left: 'осталось 14ч 32м', day: 12 };
    return (_jsxs(AppShellV2, { children: [_jsx(Hero, { current: data?.current ?? 12, best: data?.best ?? 47, freezeTokens: data?.freeze_tokens ?? 3, freezeMax: data?.freeze_max ?? 5 }), _jsxs("div", { className: "flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-7", children: [isError && _jsx(ErrorChip, {}), _jsx(CalendarCard, { year: data?.year ?? 2026, done: data?.total_done ?? 127, missed: data?.total_missed ?? 12, freeze: data?.total_freeze ?? 5, remaining: data?.remaining ?? 121, months: data?.months ?? MONTHS.map((m, mi) => ({ name: m, done: mi <= 3 ? (mi === 3 ? 22 : 31) : 0, total: 31 })) }), _jsxs("div", { className: "flex flex-col gap-4 lg:h-[280px] lg:flex-row lg:gap-5", children: [_jsx(TodayCard, { today: today }), _jsx(CursedCard, {}), _jsx(BossCard, {})] })] })] }));
}
