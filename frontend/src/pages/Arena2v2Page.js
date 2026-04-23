import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { useParams } from 'react-router-dom';
import { MessageCircle, HelpCircle, Flag, FileCode } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
import { useArenaMatchQuery } from '../lib/queries/arena';
function ErrorChip() {
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C" }));
}
function TeamPlayer({ nick, tier, chip, chipTone, gradient, mirror = false, }) {
    const chipCls = chipTone === 'success'
        ? 'bg-success/20 text-success'
        : chipTone === 'warn'
            ? 'bg-warn/20 text-warn'
            : chipTone === 'danger'
                ? 'bg-danger/20 text-danger'
                : 'bg-cyan/20 text-cyan';
    return (_jsxs("div", { className: [
            'flex items-center gap-2 rounded-[10px] bg-surface-2 p-2',
            mirror ? 'flex-row-reverse' : '',
        ].join(' '), children: [_jsx(Avatar, { size: "md", gradient: gradient, initials: nick.charAt(1).toUpperCase(), status: "online" }), _jsxs("div", { className: ['flex flex-col gap-0.5', mirror ? 'items-end' : ''].join(' '), children: [_jsx("span", { className: "font-display text-[13px] font-bold text-text-primary", children: nick }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: tier })] }), _jsx("span", { className: `rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${chipCls}`, children: chip })] }));
}
function MatchHeader() {
    return (_jsxs("div", { className: "flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-[100px] lg:flex-row lg:items-center lg:justify-between lg:px-10 lg:py-0", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(TeamPlayer, { nick: "@you", tier: "Diamond III \u00B7 2840", chip: "12/15", chipTone: "success", gradient: "cyan-violet" }), _jsx(TeamPlayer, { nick: "@nastya", tier: "Diamond IV \u00B7 2610", chip: "8/15", chipTone: "warn", gradient: "success-cyan" })] }), _jsxs("div", { className: "flex flex-col items-center gap-1", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.12em] text-accent-hover", children: "RANKED 2V2 \u00B7 ROUND 1" }), _jsx("span", { className: "font-display text-3xl font-extrabold leading-none text-text-primary lg:text-[36px]", children: "12:43" }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "\u0411\u043E\u0439 \u043A\u043E\u043C\u0430\u043D\u0434 \u00B7 BO3" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(TeamPlayer, { nick: "@kirill_dev", tier: "Diamond II \u00B7 2980", chip: "14/15", chipTone: "cyan", gradient: "pink-violet", mirror: true }), _jsx(TeamPlayer, { nick: "@vasya", tier: "Platinum I \u00B7 2310", chip: "6/15", chipTone: "warn", gradient: "pink-red", mirror: true })] })] }));
}
const GO_CODE_A = [
    'package main',
    '',
    'func findMedianSortedArrays(a, b []int) float64 {',
    '\tif len(a) > len(b) {',
    '\t\ta, b = b, a',
    '\t}',
    '\tlo, hi := 0, len(a)',
    '\tfor lo <= hi {',
    '\t\ti := (lo + hi) / 2',
    '\t\tj := (len(a)+len(b)+1)/2 - i',
];
const GO_CODE_B = [
    'package main',
    '',
    'func topoSort(g [][]int) []int {',
    '\tn := len(g)',
    '\tin := make([]int, n)',
    '\tfor _, e := range g {',
    '\t\tin[e[1]]++',
    '\t}',
    '\tq := []int{}',
    '\tres := make([]int, 0, n)',
];
function AssignmentStrip({ label, title, tags, chip, chipTone, progress, }) {
    const chipCls = chipTone === 'success' ? 'bg-success/20 text-success' : 'bg-warn/20 text-warn';
    const barCls = chipTone === 'success' ? 'bg-success' : 'bg-warn';
    return (_jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan", children: label }), _jsx("h3", { className: "font-display text-[17px] font-bold text-text-primary", children: title }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: tags.map((t, i) => (_jsx("span", { className: i === 0
                                ? 'rounded-full bg-pink/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-pink'
                                : i === 1
                                    ? 'rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan'
                                    : 'rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent-hover', children: t }, t))) })] }), _jsxs("div", { className: "flex min-w-[120px] flex-col items-end gap-2", children: [_jsx("span", { className: `rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${chipCls}`, children: chip }), _jsx("div", { className: "h-1.5 w-[110px] overflow-hidden rounded-full bg-black/40", children: _jsx("div", { className: `h-full ${barCls}`, style: { width: `${progress}%` } }) })] })] }));
}
function MiniEditor({ tabName, lines, highlight }) {
    return (_jsxs("div", { className: "flex flex-col overflow-hidden rounded-lg bg-surface-1", children: [_jsxs("div", { className: "flex h-9 items-center gap-2 border-b border-border bg-bg px-3", children: [_jsx(FileCode, { className: "h-3.5 w-3.5 text-accent-hover" }), _jsx("span", { className: "font-mono text-[11px] text-text-primary", children: tabName })] }), _jsxs("div", { className: "flex overflow-hidden", children: [_jsx("div", { className: "flex w-8 flex-col items-end border-r border-border bg-bg px-2 py-2 font-mono text-[11px] leading-[18px] text-text-muted", children: lines.map((_, i) => (_jsx("span", { children: i + 1 }, i))) }), _jsx("pre", { className: "flex-1 overflow-x-auto px-3 py-2 font-mono text-[11px] leading-[18px] text-text-secondary", children: lines.map((line, i) => (_jsx("div", { className: i === highlight ? 'rounded-sm bg-accent/15 px-1 text-text-primary' : '', children: line || '\u00A0' }, i))) })] })] }));
}
function Pane({ borderColor, label, title, tags, chip, chipTone, progress, tabName, lines, highlight, }) {
    return (_jsxs("div", { className: `flex flex-1 flex-col gap-3.5 rounded-[14px] border-2 ${borderColor} bg-surface-2 p-3.5`, children: [_jsx(AssignmentStrip, { label: label, title: title, tags: tags, chip: chip, chipTone: chipTone, progress: progress }), _jsx(MiniEditor, { tabName: tabName, lines: lines, highlight: highlight })] }));
}
function BottomBar() {
    return (_jsxs("div", { className: "flex flex-col gap-4 border-t border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-20 lg:flex-row lg:items-center lg:justify-between lg:px-8", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "grid h-9 w-9 place-items-center rounded-full bg-cyan/15", children: _jsx(MessageCircle, { className: "h-4 w-4 text-cyan" }) }), _jsxs("div", { className: "flex flex-col gap-0.5", children: [_jsxs("span", { className: "text-[13px] text-text-primary", children: [_jsx("span", { className: "font-semibold text-accent-hover", children: "@nastya:" }), " \u044F \u0437\u0430\u0441\u0442\u0440\u044F\u043B\u0430 \u043D\u0430 DFS, \u043F\u043E\u043C\u043E\u0433\u0438!"] }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "\u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u043E" })] }), _jsx(Button, { variant: "ghost", size: "sm", className: "ml-2", children: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0447\u0430\u0442" })] }), _jsxs("div", { className: "flex items-center gap-5", children: [_jsxs("div", { className: "flex flex-col items-center gap-0.5", children: [_jsx("span", { className: "font-mono text-[10px] tracking-[0.12em] text-text-muted", children: "TEAM SCORE" }), _jsx("span", { className: "font-display text-[22px] font-extrabold text-success", children: "20 / 30" })] }), _jsx("span", { className: "font-mono text-xs text-text-muted", children: "vs" }), _jsxs("div", { className: "flex flex-col items-center gap-0.5", children: [_jsx("span", { className: "font-mono text-[10px] tracking-[0.12em] text-text-muted", children: "ENEMY" }), _jsx("span", { className: "font-display text-[22px] font-extrabold text-danger", children: "14 / 30" })] })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Button, { variant: "primary", icon: _jsx(HelpCircle, { className: "h-4 w-4" }), children: "\u041F\u043E\u043C\u043E\u0447\u044C @nastya" }), _jsx(Button, { variant: "ghost", icon: _jsx(Flag, { className: "h-4 w-4" }), children: "\u0421\u0434\u0430\u0442\u044C\u0441\u044F" })] })] }));
}
export default function Arena2v2Page() {
    const { matchId } = useParams();
    const { data: match, isError } = useArenaMatchQuery(matchId);
    const taskATitle = match?.task?.title ?? 'Median of Two Arrays';
    const taskBTitle = 'Topological Sort';
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex min-h-[calc(100vh-64px)] flex-col lg:h-[calc(100vh-72px)]", children: [isError && (_jsx("div", { className: "flex justify-end px-4 py-2", children: _jsx(ErrorChip, {}) })), _jsx(MatchHeader, {}), _jsxs("div", { className: "flex flex-1 flex-col gap-4 overflow-auto px-4 py-4 sm:px-6 lg:flex-row lg:overflow-hidden lg:px-8", children: [_jsx(Pane, { borderColor: "border-cyan", label: "\u0417\u0410\u0414\u0410\u0427\u0410 A \u00B7 @you", title: taskATitle, tags: ['Hard', 'Binary Search', '1200 XP'], chip: "12/15 \u2713", chipTone: "success", progress: 80, tabName: "median.go", lines: GO_CODE_A, highlight: 7 }), _jsx(Pane, { borderColor: "border-success", label: "\u0417\u0410\u0414\u0410\u0427\u0410 B \u00B7 @nastya", title: taskBTitle, tags: ['Medium', 'Graph', '900 XP'], chip: "8/15 \u2699", chipTone: "warn", progress: 53, tabName: "topo.go", lines: GO_CODE_B, highlight: 5 })] }), _jsx(BottomBar, {}), _jsx("div", { className: "hidden", children: matchId })] }) }));
}
