import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { ArrowLeft, Eye, Send, Link2, Share2, Skull } from 'lucide-react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
const goLines = [
    'func twoSum(nums []int, target int) []int {',
    '    result := []int{}',
    '    for i, n := range nums {',
    '        for j := i + 1; j < len(nums); j++ {',
    '            if nums[j] == target-n {',
    '                result = append(result, i, j)',
    '                return result // ☠ here it died',
    '            }',
    '        } // никогда не дойдёт',
    '    }',
    '    return result',
    '}',
];
function TopBar() {
    return (_jsxs("div", { className: "flex h-16 items-center justify-between gap-3 border-b border-border bg-surface-1 px-4 sm:px-6", children: [_jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(ArrowLeft, { className: "h-4 w-4" }), children: "\u041D\u0430\u0437\u0430\u0434" }), _jsxs("div", { className: "flex items-center gap-2 font-mono text-xs text-text-muted", children: [_jsx(Eye, { className: "h-3.5 w-3.5" }), _jsx("span", { children: "2 134 \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u043E\u0432 \u00B7 \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u0442\u0441\u044F live" })] }), _jsx(Button, { variant: "primary", size: "sm", icon: _jsx(Share2, { className: "h-3.5 w-3.5" }), children: "\u0428\u0435\u0440\u0438\u0442\u044C" })] }));
}
function Hero() {
    return (_jsx("div", { className: "flex justify-center px-4 py-8 sm:px-8 lg:px-20 lg:py-14", style: {
            background: 'linear-gradient(180deg, #1a0510 0%, #0A0A0F 50%, #1a0510 100%)',
        }, children: _jsxs("div", { className: "flex w-full max-w-[720px] flex-col items-center gap-6 rounded-2xl border-2 border-danger p-6 sm:p-8 lg:gap-7 lg:p-12", style: { background: '#0A0A14', boxShadow: '0 30px 80px rgba(239,68,68,0.6)' }, children: [_jsx("span", { className: "font-mono text-sm tracking-[0.2em] text-danger", children: "\u2726 \u2726 \u2726" }), _jsx("span", { className: "italic text-text-secondary", children: "\u0417\u0434\u0435\u0441\u044C \u043F\u043E\u043A\u043E\u0438\u0442\u0441\u044F \u0440\u0435\u0448\u0435\u043D\u0438\u0435" }), _jsx("h1", { className: "font-display text-2xl lg:text-[28px] font-extrabold text-text-primary", children: "@dima" }), _jsx("span", { className: "font-mono text-xs text-text-muted", children: "22 \u0430\u043F\u0440\u0435\u043B\u044F 2026 \u00B7 14:32" }), _jsx("div", { className: "h-px w-full bg-border" }), _jsx("p", { className: "max-w-[600px] text-center italic text-text-secondary", children: "\u041F\u0430\u043B\u043E \u043E\u0442 O(n\u00B2) \u0441\u043B\u043E\u0436\u043D\u043E\u0441\u0442\u0438 \u0438 \u0437\u0430\u0431\u044B\u0442\u043E\u0433\u043E edge case... \u041F\u0440\u043E\u0436\u0438\u043B\u043E 23 \u043C\u0438\u043D\u0443\u0442\u044B \u2014 \u0445\u0440\u0430\u0431\u0440\u043E, \u043D\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u0443\u043C\u043D\u043E..." }), _jsx("div", { className: "h-px w-full bg-border" }), _jsxs("div", { className: "flex w-full flex-wrap justify-center gap-6 lg:gap-8", children: [_jsxs("div", { className: "flex flex-col items-center gap-1", children: [_jsx("span", { className: "font-display text-2xl font-bold text-danger", children: "23\u043C" }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "\u043F\u0440\u043E\u0436\u0438\u043B\u043E" })] }), _jsxs("div", { className: "flex flex-col items-center gap-1", children: [_jsx("span", { className: "font-display text-2xl font-bold text-warn", children: "8/15" }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "\u0442\u0435\u0441\u0442\u043E\u0432" })] }), _jsxs("div", { className: "flex flex-col items-center gap-1", children: [_jsx("span", { className: "font-display text-2xl font-bold text-danger", children: "O(n\u00B2)" }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "complexity" })] })] }), _jsx("span", { className: "font-mono text-xs tracking-[0.15em] text-danger", children: "\u2726 Requiescat In Pace \u2726" })] }) }));
}
function DiffCard() {
    return (_jsxs(Card, { className: "flex-col gap-0 p-0", interactive: false, children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border px-5 py-3", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0427\u0442\u043E \u0443\u0431\u0438\u043B\u043E" }), _jsx("span", { className: "rounded-full bg-danger/15 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-danger", children: "edge case" })] }), _jsxs("div", { className: "flex", children: [_jsx("div", { className: "flex w-12 flex-col border-r border-border bg-surface-2 py-3 text-right", children: Array.from({ length: 12 }).map((_, i) => (_jsx("span", { className: `px-3 font-mono text-[11px] ${i === 6 ? 'bg-danger/20 text-danger' : 'text-text-muted'}`, children: i + 1 }, i))) }), _jsx("div", { className: "flex flex-1 flex-col py-3", children: goLines.map((line, i) => {
                            const highlight = i === 2 || i === 6;
                            return (_jsx("code", { className: `whitespace-pre px-4 font-mono text-[12px] ${highlight ? 'bg-danger/15 text-text-primary' : 'text-text-secondary'}`, children: line }, i));
                        }) })] }), _jsxs("div", { className: "flex items-center justify-between border-t border-border px-5 py-3", children: [_jsx("span", { className: "font-mono text-xs text-text-muted", children: "\u041B\u0438\u043D\u0438\u0438 3-7 \u00B7 O(n\u00B2) loop \u00B7 5000+ inputs" }), _jsx("span", { className: "rounded-full bg-danger/15 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-danger", children: "Test #14 \u00B7 2.3s timeout" })] })] }));
}
function FixCard() {
    return (_jsxs("div", { className: "rounded-xl border border-accent-hover bg-gradient-to-br from-accent/15 to-pink/15 p-6", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0427\u0442\u043E \u043D\u0443\u0436\u043D\u043E \u0431\u044B\u043B\u043E \u0441\u0434\u0435\u043B\u0430\u0442\u044C" }), _jsx("p", { className: "mt-2 max-w-[560px] text-sm text-text-secondary", children: "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C hash map \u0434\u043B\u044F O(n) lookup. \u041E\u0434\u0438\u043D \u043F\u0440\u043E\u0445\u043E\u0434 \u2014 \u0438 \u043F\u043E\u0431\u0435\u0434\u0430. \u0421\u043B\u043E\u0436\u043D\u043E\u0441\u0442\u044C \u043F\u0430\u0434\u0430\u0435\u0442 \u0441 \u043A\u0432\u0430\u0434\u0440\u0430\u0442\u0438\u0447\u043D\u043E\u0439 \u0434\u043E \u043B\u0438\u043D\u0435\u0439\u043D\u043E\u0439." }), _jsx("pre", { className: "mt-4 overflow-hidden rounded-lg bg-surface-1 p-4 font-mono text-[12px] text-cyan", children: `m := map[int]int{}
for i, n := range nums {
    if j, ok := m[target-n]; ok { return []int{j, i} }
    m[n] = i
}` }), _jsx(Button, { variant: "primary", size: "sm", className: "mt-5", children: "\u041F\u043E\u043F\u0440\u043E\u0431\u043E\u0432\u0430\u0442\u044C \u0441\u043D\u043E\u0432\u0430" })] }));
}
function StatsCard() {
    const rows = [
        ['Время жизни', '23 минуты'],
        ['Submissions', '3'],
        ['Тестов прошло', '8/15'],
        ['Memory', '12.4 MB'],
        ['Прич. смерти', 'TLE on #14'],
    ];
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u041C\u0435\u0442\u0440\u0438\u043A\u0438 \u0441\u043C\u0435\u0440\u0442\u0438" }), rows.map(([k, v]) => (_jsxs("div", { className: "flex justify-between border-b border-border pb-2 last:border-0", children: [_jsx("span", { className: "text-xs text-text-muted", children: k }), _jsx("span", { className: "font-mono text-xs text-text-primary", children: v })] }, k)))] }));
}
function SharePreviewCard() {
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u041F\u043E\u0434\u0435\u043B\u0438\u0442\u044C\u0441\u044F" }), _jsxs("div", { className: "flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3", children: [_jsx(Avatar, { size: "sm", gradient: "pink-violet", initials: "\u0414" }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx("span", { className: "text-xs font-semibold text-text-primary", children: "@dima" }), _jsx("span", { className: "text-[11px] text-text-muted", children: "\u043F\u0430\u043B\u043E \u043E\u0442 O(n\u00B2)" })] }), _jsx("span", { className: "rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent-hover", children: "druz9" })] }), _jsxs("div", { className: "grid grid-cols-4 gap-2", children: [_jsx("button", { className: "grid place-items-center rounded-md border border-border bg-surface-2 py-2 text-cyan hover:bg-surface-3", children: _jsx(Share2, { className: "h-4 w-4" }) }), _jsx("button", { className: "grid place-items-center rounded-md border border-border bg-surface-2 py-2 text-cyan hover:bg-surface-3", children: _jsx(Send, { className: "h-4 w-4" }) }), _jsx("button", { className: "grid place-items-center rounded-md border border-border bg-surface-2 py-2 text-pink hover:bg-surface-3", children: _jsx(Share2, { className: "h-4 w-4" }) }), _jsx("button", { className: "grid place-items-center rounded-md border border-border bg-surface-2 py-2 text-text-secondary hover:bg-surface-3", children: _jsx(Link2, { className: "h-4 w-4" }) })] })] }));
}
function OtherObituaries() {
    const items = [
        ['@kirill_dev', 'Пал от stack overflow'],
        ['@nastya', 'Утонул в N+1 query'],
        ['@misha', 'Скончался от race condition'],
    ];
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0414\u0440\u0443\u0433\u0438\u0435 \u043C\u043E\u0433\u0438\u043B\u043A\u0438" }), items.map(([n, s]) => (_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Skull, { className: "h-4 w-4 text-text-muted" }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx("span", { className: "text-xs font-semibold text-text-primary", children: n }), _jsx("span", { className: "text-[11px] text-text-muted", children: s })] })] }, n)))] }));
}
export default function CodeObituaryPage() {
    return (_jsxs("div", { className: "min-h-screen bg-bg text-text-primary", children: [_jsx(TopBar, {}), _jsx(Hero, {}), _jsxs("div", { className: "flex flex-col gap-4 px-4 py-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:py-7", children: [_jsxs("div", { className: "flex flex-1 flex-col gap-6", children: [_jsx(DiffCard, {}), _jsx(FixCard, {})] }), _jsxs("div", { className: "flex w-full flex-col gap-6 lg:w-[380px]", children: [_jsx(StatsCard, {}), _jsx(SharePreviewCard, {}), _jsx(OtherObituaries, {})] })] })] }));
}
