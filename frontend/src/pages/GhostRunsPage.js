import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { Plus, Settings, Play, Send } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
const ghosts = [
    { name: 'Твой прошлый run', sub: '5 дней назад · 4:21', gradient: 'violet-cyan', on: true },
    { name: '@alexey', sub: '#1 global · 1:47', gradient: 'cyan-violet', on: true },
    { name: 'AI Reference', sub: 'optimal · 1:32', gradient: 'gold', on: true },
    { name: '@kirill_dev', sub: 'друг · 3:08', gradient: 'pink-violet', on: true },
    { name: 'Median Senior', sub: 'mid-bench · 6:00', gradient: 'pink-red', on: false, dim: true },
];
const code = [
    'package main',
    '',
    'import "fmt"',
    '',
    'func twoSum(nums []int, target int) []int {',
    '    seen := map[int]int{}',
    '    for i, n := range nums {',
    '        if j, ok := seen[target-n]; ok {',
    '            return []int{j, i}',
    '        }',
    '        seen[n] = i',
    '    }',
    '    return nil',
    '}',
    'func main() { fmt.Println(twoSum([]int{2,7,11,15}, 9)) }',
];
function Header() {
    return (_jsxs("div", { className: "flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-16 lg:flex-row lg:items-center lg:justify-between lg:py-0", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: "GHOST RUNS \u00B7 \u041F\u0420\u0410\u041A\u0422\u0418\u041A\u0410" }), _jsx("span", { className: "text-text-muted", children: "\u00B7" }), _jsx("span", { className: "font-display text-base font-bold text-text-primary", children: "Two Sum \u00B7 vs Ghosts" })] }), _jsx("span", { className: "rounded-full bg-accent/15 px-3 py-1 font-mono text-xs font-semibold text-accent-hover", children: "\uD83D\uDC7B 4 ghosts active" }), _jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(Settings, { className: "h-3.5 w-3.5" }), children: "\u041D\u0430\u0441\u0442\u0440\u043E\u0438\u0442\u044C ghosts" })] }));
}
function GhostRow({ g }) {
    return (_jsxs("div", { className: `flex items-center gap-2.5 rounded-[10px] border border-border bg-surface-2 p-3 ${g.dim ? 'opacity-50' : ''}`, children: [_jsx(Avatar, { size: "sm", gradient: g.gradient, initials: g.name[1]?.toUpperCase() }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx("span", { className: "text-[12px] font-semibold text-text-primary", children: g.name }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: g.sub })] }), _jsx("div", { className: `relative h-4 w-7 rounded-full ${g.on ? 'bg-accent' : 'bg-surface-3'}`, children: _jsx("span", { className: `absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${g.on ? 'left-3.5' : 'left-0.5'}` }) })] }));
}
function LeftPanel() {
    return (_jsxs("div", { className: "flex w-full flex-col gap-3 border-b border-border bg-surface-1 p-4 lg:w-[280px] lg:border-b-0 lg:border-r", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0435 ghosts" }), ghosts.map((g) => (_jsx(GhostRow, { g: g }, g.name))), _jsx("div", { className: "flex-1" }), _jsxs("button", { className: "flex items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong px-3 py-2 text-xs text-text-muted hover:bg-surface-2", children: [_jsx(Plus, { className: "h-3.5 w-3.5" }), " \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C ghost"] }), _jsx("div", { className: "rounded-lg border border-border bg-surface-2 p-3", children: _jsx("p", { className: "text-[11px] text-text-secondary", children: "\uD83D\uDC7B Ghost \u043D\u0435 \u0431\u043B\u043E\u043A\u0438\u0440\u0443\u0435\u0442 \u2014 \u041F\u0440\u043E\u0437\u0440\u0430\u0447\u043D\u044B\u0435 \u043A\u0443\u0440\u0441\u043E\u0440\u044B \u0438\u0434\u0443\u0442 \u043F\u0430\u0440\u0430\u043B\u043B\u0435\u043B\u044C\u043D\u043E" }) })] }));
}
function CenterEditor() {
    const inlineGhosts = {
        3: { label: '@alexey is here', color: 'text-cyan bg-cyan/15' },
        5: { label: '▮ ты', color: 'text-accent-hover bg-accent/15' },
        7: { label: 'AI ref typed here · 8s ago', color: 'text-warn bg-warn/15' },
        9: { label: '@kirill ↑ 12s back', color: 'text-pink bg-pink/15' },
        11: { label: 'you (5 days ago)', color: 'text-text-secondary bg-white/5' },
    };
    return (_jsxs("div", { className: "flex flex-1 flex-col", children: [_jsxs("div", { className: "flex h-10 items-center justify-between border-b border-border bg-surface-1 px-4", children: [_jsx("span", { className: "rounded-md bg-surface-2 px-3 py-1 font-mono text-[12px] text-text-primary", children: "solution.go" }), _jsx("span", { className: "font-mono text-[11px] text-accent-hover", children: "1:24 elapsed" })] }), _jsxs("div", { className: "flex flex-1 overflow-auto", children: [_jsx("div", { className: "flex w-12 flex-col border-r border-border bg-surface-2 py-3 text-right", children: code.map((_, i) => (_jsx("span", { className: `px-3 font-mono text-[11px] ${i === 5 ? 'bg-accent/15 text-accent-hover' : 'text-text-muted'}`, children: i + 1 }, i))) }), _jsx("div", { className: "flex flex-1 flex-col py-3", children: code.map((line, i) => (_jsxs("div", { className: "flex flex-col", children: [_jsx("code", { className: "whitespace-pre px-4 font-mono text-[12px] text-text-secondary", children: line || ' ' }), inlineGhosts[i] && (_jsx("span", { className: `ml-4 mb-1 inline-flex w-fit items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] ${inlineGhosts[i].color}`, children: inlineGhosts[i].label }))] }, i))) })] }), _jsxs("div", { className: "flex h-14 items-center gap-3 border-t border-border bg-surface-1 px-4", children: [_jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(Play, { className: "h-3.5 w-3.5" }), children: "Run" }), _jsx(Button, { variant: "primary", size: "sm", icon: _jsx(Send, { className: "h-3.5 w-3.5" }), children: "Submit" }), _jsx("span", { className: "font-mono text-xs text-text-muted", children: "12/15 tests" }), _jsx("div", { className: "h-2 flex-1 overflow-hidden rounded-full bg-surface-2", children: _jsx("div", { className: "h-full w-[80%] rounded-full bg-success" }) })] })] }));
}
const standings = [
    { rank: 1, name: 'AI Reference', sub: 'optimal solution', time: '1:32 ✓ DONE', gradient: 'gold', done: true },
    { rank: 2, name: '@alexey', sub: '#1 global', time: '1:47', gradient: 'cyan-violet' },
    { rank: 3, name: '@kirill_dev', sub: 'друг', time: '3:08', gradient: 'pink-violet' },
    { rank: 4, name: '@you', sub: 'IN PROGRESS', time: '1:24', gradient: 'violet-cyan', active: true },
    { rank: 5, name: 'your past', sub: '5d ago', time: '4:21', gradient: 'violet-cyan', past: true },
    { rank: 6, name: '@nastya', sub: 'друг', time: '5:14', gradient: 'pink-red' },
];
function RightLeaderboard() {
    return (_jsxs("div", { className: "flex w-full flex-col gap-3.5 border-t border-border bg-surface-2 p-5 lg:w-[320px] lg:border-l lg:border-t-0", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: "Race \u00B7 Live Standings" }), _jsx("span", { className: "h-2 w-2 animate-pulse rounded-full bg-danger" })] }), standings.map((s) => (_jsxs("div", { className: `flex items-center gap-3 rounded-[10px] bg-surface-1 p-3 ${s.active ? 'border border-accent' : 'border border-border'} ${s.past ? 'opacity-60' : ''}`, children: [_jsxs("span", { className: "grid h-7 w-7 place-items-center rounded-full bg-surface-3 font-display text-[13px] font-bold text-text-primary", children: ["#", s.rank] }), _jsx(Avatar, { size: "sm", gradient: s.gradient, initials: s.name[1]?.toUpperCase() }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx("span", { className: "text-[12px] font-semibold text-text-primary", children: s.name }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: s.sub })] }), _jsx("span", { className: `font-mono text-[11px] ${s.done ? 'text-warn' : 'text-text-secondary'}`, children: s.time }), s.active && (_jsx("span", { className: "rounded-full bg-accent/20 px-1.5 py-0.5 font-mono text-[9px] text-accent-hover", children: "\u0442\u044B" }))] }, s.rank))), _jsx("div", { className: "rounded-lg border border-border bg-surface-1 p-3 text-center", children: _jsx("p", { className: "text-[11px] text-text-secondary", children: "\uD83C\uDFAF \u0426\u0435\u043B\u044C: \u043F\u043E\u0431\u0438\u0442\u044C \u0442\u0432\u043E\u0451 \u043F\u0440\u043E\u0448\u043B\u043E\u0435" }) })] }));
}
export default function GhostRunsPage() {
    return (_jsxs(AppShellV2, { children: [_jsx(Header, {}), _jsxs("div", { className: "flex flex-col lg:h-[calc(100vh-72px-64px)] lg:flex-row", children: [_jsx(LeftPanel, {}), _jsx(CenterEditor, {}), _jsx(RightLeaderboard, {})] })] }));
}
