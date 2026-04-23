import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Flame, Lock, Play, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { cn } from '../lib/cn';
import { useDailyKataQuery, useStreakQuery } from '../lib/queries/daily';
function Hero() {
    const { t } = useTranslation('daily');
    const { data: kata, isError } = useDailyKataQuery();
    const { data: streak } = useStreakQuery();
    const day = streak?.current ?? 0;
    const title = kata?.task?.title ?? '—';
    const difficulty = kata?.task?.difficulty ?? '—';
    const section = kata?.task?.section ?? '—';
    return (_jsxs("div", { className: "flex flex-col items-start justify-between gap-5 px-4 py-6 sm:px-8 lg:flex-row lg:items-center lg:gap-0 lg:px-10 lg:py-0", style: {
            minHeight: 200,
            background: 'linear-gradient(10deg, #F472B6 0%, #582CFF 100%)',
        }, children: [_jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/90 px-3 py-1 font-mono text-[11px] font-bold tracking-[0.1em] text-bg", children: [_jsx(Flame, { className: "h-3 w-3" }), " ", t('day_of', { day })] }), _jsx("h1", { className: "font-display text-3xl font-extrabold leading-[1.05] text-white sm:text-4xl lg:text-[44px]", children: title }), isError && (_jsx("span", { className: "rounded-full bg-danger/30 px-2 py-0.5 font-mono text-[10px] font-semibold text-white", children: t('load_failed') })), _jsxs("div", { className: "flex flex-wrap items-center gap-2 sm:gap-3", children: [_jsx(MetaTag, { children: difficulty }), _jsx(MetaTag, { children: section }), _jsx(MetaTag, { children: "850 XP" }), _jsx(MetaTag, { children: "O(log n)" })] })] }), _jsxs("div", { className: "flex w-full flex-row items-center justify-between gap-2 lg:w-auto lg:flex-col lg:items-end", children: [_jsx("span", { className: "font-mono text-[11px] uppercase tracking-[0.1em] text-white/80", children: t('passed_today') }), _jsx("span", { className: "font-display text-[28px] font-extrabold text-white", children: kata?.already_submitted ? '✓' : '—' }), _jsx("span", { className: "font-mono text-[13px] text-cyan", children: kata?.already_submitted ? 'ты сдал сегодня' : 'не сдано' })] })] }));
}
function MetaTag({ children }) {
    return (_jsx("span", { className: "rounded-md border border-white/30 bg-white/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-white", children: children }));
}
const DESC_TABS = ['description', 'examples', 'discussion', 'hints'];
function DescriptionCard() {
    const { t } = useTranslation('daily');
    const [tab, setTab] = useState('description');
    const constraints = t('constraints_list', { returnObjects: true });
    return (_jsxs(Card, { className: "w-full flex-col gap-0 p-0 lg:w-[380px]", interactive: false, children: [_jsx("div", { className: "flex items-center gap-1 border-b border-border px-2", children: DESC_TABS.map((tk) => {
                    const active = tab === tk;
                    const locked = tk === 'hints';
                    return (_jsxs("button", { onClick: () => setTab(tk), className: cn('relative h-11 px-3 text-[13px] font-semibold transition-colors', active
                            ? 'text-text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-accent'
                            : 'text-text-muted hover:text-text-primary'), children: [t(`tabs.${tk}`), " ", locked && _jsx(Lock, { className: "ml-1 inline h-3 w-3" })] }, tk));
                }) }), _jsxs("div", { className: "flex flex-col gap-4 p-5", children: [_jsx("p", { className: "text-[13px] leading-relaxed text-text-secondary", children: t('desc_p1') }), _jsx("p", { className: "text-[13px] leading-relaxed text-text-secondary", children: t('desc_p2') }), _jsxs("div", { className: "flex flex-col gap-2 rounded-lg bg-surface-1 p-4", children: [_jsx("span", { className: "font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted", children: t('example') }), _jsx("pre", { className: "overflow-x-auto font-mono text-[12px] leading-relaxed text-text-primary", children: `Input:  nums = [4,5,6,7,0,1,2], target = 0
Output: 4

Input:  nums = [4,5,6,7,0,1,2], target = 3
Output: -1` })] }), _jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("span", { className: "font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-text-muted", children: t('constraints') }), _jsx("ul", { className: "flex flex-col gap-1 pl-4 text-[12px] text-text-secondary", children: constraints.map((c, i) => (_jsx("li", { className: "list-disc", children: c }, i))) })] })] })] }));
}
const CODE_LINES = [
    'package main',
    '',
    'func search(nums []int, target int) int {',
    '\tlo, hi := 0, len(nums)-1',
    '\tfor lo <= hi {',
    '\t\tmid := (lo + hi) / 2',
    '\t\tif nums[mid] == target { return mid }',
    '\t\t// TODO: handle rotation',
    '\t}',
];
function Editor() {
    const { t } = useTranslation('daily');
    return (_jsxs("div", { className: "flex min-h-[400px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-surface-1", children: [_jsxs("div", { className: "flex items-center gap-2 border-b border-border px-3", children: [_jsx("div", { className: "flex h-10 items-center gap-2 border-b-2 border-accent px-3 text-[13px] font-semibold text-text-primary", children: "solution.go" }), _jsx("span", { className: "rounded-md bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan", children: "GO" })] }), _jsxs("div", { className: "flex flex-1 overflow-auto font-mono text-[13px] leading-[1.7]", children: [_jsx("div", { className: "flex shrink-0 select-none flex-col items-end border-r border-border bg-bg/40 px-3 py-3 text-text-muted", children: CODE_LINES.map((_, i) => (_jsx("span", { children: i + 1 }, i))) }), _jsx("pre", { className: "flex-1 px-4 py-3 text-text-primary", children: CODE_LINES.join('\n') })] }), _jsxs("div", { className: "flex items-center justify-between border-t border-border px-4 py-3", children: [_jsx("span", { className: "font-mono text-[12px] text-text-muted", children: t('tests_not_run') }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Button, { variant: "ghost", icon: _jsx(Play, { className: "h-3.5 w-3.5" }), size: "sm", children: t('run') }), _jsx(Button, { variant: "primary", icon: _jsx(Send, { className: "h-3.5 w-3.5" }), size: "sm", className: "shadow-glow", children: t('submit') })] })] })] }));
}
function StreakCard() {
    const { t } = useTranslation('daily');
    const { data: streak } = useStreakQuery();
    const current = streak?.current ?? 0;
    const history = streak?.history?.slice(-14) ?? Array.from({ length: 14 }, (_, i) => i < 12);
    const days = Array.from({ length: 14 }, (_, i) => Boolean(history[i]));
    return (_jsxs(Card, { className: "flex-col gap-3 p-4", children: [_jsx("h3", { className: "font-display text-[13px] font-bold text-text-primary", children: t('streak_progress') }), _jsx("div", { className: "grid grid-cols-7 gap-1.5", children: days.map((done, i) => (_jsx("div", { className: cn('aspect-square rounded-sm', done ? 'bg-gradient-to-br from-warn to-pink' : 'bg-surface-1') }, i))) }), _jsxs("div", { className: "mt-1 flex flex-col items-center gap-0.5", children: [_jsxs("span", { className: "font-display text-[26px] font-extrabold text-warn", children: [current, " \uD83D\uDD25"] }), _jsx("span", { className: "text-[11px] text-text-muted", children: t('consecutive_days') })] })] }));
}
const UNLOCKS = [
    { name: 'Streak Master', cur: 12, tgt: 14 },
    { name: 'Speed Demon', cur: 6, tgt: 10 },
    { name: 'DP Apprentice', cur: 3, tgt: 10 },
];
function UnlocksCard() {
    const { t } = useTranslation('daily');
    return (_jsxs(Card, { className: "flex-col gap-3 p-4", children: [_jsx("h3", { className: "font-display text-[13px] font-bold text-text-primary", children: t('unlocks') }), _jsx("div", { className: "flex flex-col gap-3", children: UNLOCKS.map((u) => (_jsxs("div", { className: "flex flex-col gap-1", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[12px] font-semibold text-text-secondary", children: u.name }), _jsxs("span", { className: "font-mono text-[11px] text-text-muted", children: [u.cur, "/", u.tgt] })] }), _jsx("div", { className: "h-1 overflow-hidden rounded-full bg-black/30", children: _jsx("div", { className: "h-full rounded-full bg-cyan", style: { width: `${(u.cur / u.tgt) * 100}%` } }) })] }, u.name))) })] }));
}
export default function DailyPage() {
    return (_jsxs(AppShellV2, { children: [_jsx(Hero, {}), _jsxs("div", { className: "flex flex-col gap-6 px-4 py-6 sm:px-8 lg:flex-row lg:px-10 lg:py-8", style: { minHeight: 'calc(100vh - 72px - 200px)' }, children: [_jsx(DescriptionCard, {}), _jsx(Editor, {}), _jsxs("div", { className: "flex w-full flex-col gap-4 lg:w-[240px]", children: [_jsx(StreakCard, {}), _jsx(UnlocksCard, {})] })] })] }));
}
