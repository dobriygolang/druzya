import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { Skull, Lightbulb, CheckCircle2 } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
const lines = [
    'func twoSum(nums []int, target int) []int {',
    '    if len(nums) < 2 { return nil }',
    '    m := make(map[int]int)',
    '    for i, n := range nums {',
    '        complement := target - n',
    '        // looking for complement',
    '        _ = complement',
    '        // ...',
    '    }',
    '    m[nums[0]] = 0 // ← подозрительно',
    '    for i := 1; i < len(nums); i++ {',
    '        c := target - nums[i]',
    '        if j, ok := m[c]; ok {',
    '            return []int{j, i}',
    '        }',
    '        m[nums[i]] = i',
    '    }',
    '    return nil',
    '}',
];
function PageHeader() {
    return (_jsxs("div", { className: "flex flex-col items-start gap-4 px-4 pb-4 pt-6 sm:px-8 lg:flex-row lg:items-end lg:justify-between lg:px-20 lg:pb-6 lg:pt-8", children: [_jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("h1", { className: "font-display text-2xl lg:text-[28px] font-extrabold text-text-primary", children: "\uD83E\uDEA6 Necromancy Mode" }), _jsx("p", { className: "text-sm text-text-secondary", children: "\u041F\u043E\u0434\u043D\u0438\u043C\u0438 \u043C\u0451\u0440\u0442\u0432\u043E\u0435 \u0440\u0435\u0448\u0435\u043D\u0438\u0435, \u043D\u0430\u0439\u0434\u0438 \u0433\u0434\u0435 \u043E\u043D\u043E \u043F\u0430\u043B\u043E. +XP \u0437\u0430 \u043A\u0430\u0436\u0434\u044B\u0439 \u043D\u0430\u0439\u0434\u0435\u043D\u043D\u044B\u0439 \u0431\u0430\u0433." })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "rounded-full bg-warn/15 px-3 py-1 font-mono text-xs font-semibold text-warn", children: "127 / 412 \u0440\u0430\u0441\u043A\u0440\u044B\u0442\u043E" }), _jsx("button", { className: "rounded-md border border-border bg-surface-1 px-3 py-1.5 font-mono text-xs text-text-secondary", children: "Hard \u25BE" })] })] }));
}
function CorpseCard() {
    return (_jsxs("div", { className: "flex flex-1 flex-col overflow-hidden rounded-[14px] border-2 border-danger bg-surface-1", children: [_jsxs("div", { className: "flex items-center justify-between px-6 py-3.5", style: { background: '#2A0510' }, children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "grid h-9 w-9 place-items-center rounded-full bg-danger/20", children: _jsx(Skull, { className: "h-5 w-5 text-danger" }) }), _jsxs("div", { className: "flex flex-col", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u041C\u0451\u0440\u0442\u0432\u043E\u0435 \u0440\u0435\u0448\u0435\u043D\u0438\u0435 #847" }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "Anonymous \u00B7 Two Sum \u00B7 23 \u043C\u0438\u043D\u0443\u0442\u044B \u0436\u0438\u0437\u043D\u0438" })] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "rounded-full bg-danger/20 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-danger", children: "FAIL \u00B7 Test #14" }), _jsx("span", { className: "rounded-full bg-warn/15 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-warn", children: "Reward: +250 XP" })] })] }), _jsxs("div", { className: "flex flex-1", children: [_jsx("div", { className: "flex w-12 flex-col border-r border-border bg-surface-2 py-3 text-right", children: lines.map((_, i) => (_jsx("span", { className: "px-3 font-mono text-[11px] text-text-muted", children: i + 1 }, i))) }), _jsx("div", { className: "flex flex-1 flex-col py-3", children: lines.map((line, i) => (_jsx("code", { className: "cursor-pointer whitespace-pre px-4 font-mono text-[12px] text-text-secondary hover:bg-danger/10 hover:text-text-primary", children: line }, i))) })] }), _jsxs("div", { className: "flex h-16 items-center justify-between border-t border-border bg-surface-2 px-5", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-sm text-text-secondary", children: "\u041A\u043B\u0438\u043A\u043D\u0438 \u043D\u0430 \u0441\u0442\u0440\u043E\u043A\u0443 \u0441 \u0431\u0430\u0433\u043E\u043C" }), _jsx("span", { className: "rounded-full bg-surface-3 px-2.5 py-0.5 font-mono text-[11px] text-text-muted", children: "\u043F\u043E\u043F\u044B\u0442\u043A\u0430 1/3" })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(Lightbulb, { className: "h-3.5 w-3.5" }), children: "\u041F\u043E\u0434\u0441\u043A\u0430\u0437\u043A\u0430 (-50 XP)" }), _jsx(Button, { variant: "primary", size: "sm", icon: _jsx(CheckCircle2, { className: "h-3.5 w-3.5" }), children: "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C \u0432\u044B\u0431\u043E\u0440" })] })] })] }));
}
function TestCard() {
    return (_jsxs(Card, { className: "flex-col gap-3 border-danger/40 p-5", interactive: false, children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u0422\u0435\u0441\u0442 \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0443\u0431\u0438\u043B" }), _jsx("pre", { className: "overflow-hidden rounded-lg bg-surface-2 p-3 font-mono text-[11px] text-text-secondary", children: `Input:    [3,3], target=6
Expected: [0,1]
Got:      [0,0]  ← mismatch` })] }));
}
function BountyCard() {
    const rows = [
        ['1-я попытка', '+250 XP', 'text-success'],
        ['2-я попытка', '+150 XP', 'text-warn'],
        ['3-я попытка', '+50 XP', 'text-text-secondary'],
        ['Не угадал', '0 XP', 'text-danger'],
    ];
    return (_jsxs("div", { className: "rounded-xl border border-border bg-gradient-to-br from-danger/15 to-accent/15 p-5", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "Bug Bounty" }), rows.map(([k, v, c]) => (_jsxs("div", { className: "mt-3 flex items-center justify-between", children: [_jsx("span", { className: "text-xs text-text-secondary", children: k }), _jsx("span", { className: `font-mono text-xs font-semibold ${c}`, children: v })] }, k)))] }));
}
function RankCard() {
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "Necromancer Rank" }), _jsxs("div", { className: "flex items-baseline gap-2", children: [_jsx("span", { className: "font-display text-[40px] font-extrabold text-warn", children: "127" }), _jsx("span", { className: "font-mono text-xs text-text-muted", children: "\u0440\u0430\u0441\u043A\u0440\u044B\u0442\u044B\u0445 \u0431\u0430\u0433\u043E\u0432" })] }), _jsxs("div", { className: "flex flex-col gap-2", children: [_jsxs("div", { className: "flex justify-between font-mono text-[11px] text-text-muted", children: [_jsx("span", { children: "\u0413\u0440\u0435\u0439\u0432-\u0434\u0438\u0433\u0433\u0435\u0440" }), _jsx("span", { children: "\u0420\u0438\u0442\u0443\u0430\u043B\u0438\u0441\u0442" })] }), _jsx("div", { className: "h-2 overflow-hidden rounded-full bg-surface-2", children: _jsx("div", { className: "h-full w-[42%] rounded-full bg-gradient-to-r from-warn to-pink" }) }), _jsx("span", { className: "text-[11px] text-text-muted", children: "73 \u0434\u043E \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0433\u043E \u0440\u0430\u043D\u0433\u0430" })] })] }));
}
function RecentFinds() {
    const items = [
        ['#846', 'off-by-one', '+250'],
        ['#831', 'race condition', '+150'],
        ['#812', 'null deref', '+250'],
        ['#799', 'wrong base case', '+50'],
        ['#788', 'integer overflow', '+250'],
    ];
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u041C\u043E\u0438 \u043D\u0430\u0445\u043E\u0434\u043A\u0438" }), items.map(([id, name, xp]) => (_jsxs("div", { className: "flex items-center gap-2.5 border-b border-border pb-2 last:border-0", children: [_jsx(Skull, { className: "h-4 w-4 text-text-muted" }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx("span", { className: "text-[12px] font-semibold text-text-primary", children: id }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: name })] }), _jsx("span", { className: "font-mono text-[11px] font-semibold text-warn", children: xp })] }, id)))] }));
}
export default function NecromancyPage() {
    return (_jsxs(AppShellV2, { children: [_jsx(PageHeader, {}), _jsxs("div", { className: "flex flex-col gap-4 px-4 pb-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:pb-7", children: [_jsx("div", { className: "flex w-full flex-col gap-4 lg:w-[280px]", children: _jsx(RecentFinds, {}) }), _jsx("div", { className: "flex flex-1 flex-col", children: _jsx(CorpseCard, {}) }), _jsxs("div", { className: "flex w-full flex-col gap-4 lg:w-[360px]", children: [_jsx(TestCard, {}), _jsx(BountyCard, {}), _jsx(RankCard, {})] })] })] }));
}
