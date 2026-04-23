import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Eye, Scissors, Gem, FileCode, CircleDot, Send, Play, } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
import { WSStatus } from '../components/ws/WSStatus';
import { useChannel } from '../lib/ws';
function Banner({ viewers }) {
    return (_jsxs("div", { className: "flex flex-col gap-3 border-b border-danger px-4 py-3 sm:px-6 lg:h-16 lg:flex-row lg:items-center lg:justify-between lg:px-8 lg:py-0", style: { background: 'rgba(239,68,68,0.15)' }, children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "h-2.5 w-2.5 animate-pulse rounded-full bg-danger" }), _jsx("span", { className: "rounded-full bg-danger/30 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-danger", children: "LIVE" }), _jsx("span", { className: "font-mono text-[12px] text-text-primary", children: "Round 2 \u00B7 BO3 \u00B7 Diamond Open R16" })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("span", { className: "inline-flex items-center gap-1.5 rounded-full bg-cyan/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-cyan", children: [_jsx(Eye, { className: "h-3 w-3" }), " ", viewers, " \u0441\u043C\u043E\u0442\u0440\u044F\u0442"] }), _jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(Scissors, { className: "h-3.5 w-3.5 text-warn" }), children: "Clip last 10s" }), _jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(Gem, { className: "h-3.5 w-3.5 text-warn" }), className: "border-warn text-warn", children: "\u041F\u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C" })] })] }));
}
function PlayerHeader({ nick, tier, stats, gradient, mirror, }) {
    return (_jsxs("div", { className: ['flex items-center gap-4', mirror ? 'flex-row-reverse text-right' : ''].join(' '), children: [_jsx(Avatar, { size: "lg", gradient: gradient, initials: nick.charAt(1).toUpperCase(), status: "online" }), _jsxs("div", { className: "flex flex-col gap-0.5", children: [_jsx("span", { className: "font-display text-[16px] font-bold text-text-primary", children: nick }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: tier }), _jsx("span", { className: "font-mono text-[11px] text-text-secondary", children: stats })] })] }));
}
function MatchHeader() {
    return (_jsxs("div", { className: "flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-6 lg:h-24 lg:flex-row lg:items-center lg:justify-between lg:px-10 lg:py-0", children: [_jsx(PlayerHeader, { nick: "@alexey", tier: "Grandmaster \u00B7 3 420 LP", stats: "62 keystrokes/min \u00B7 12/15 tests", gradient: "cyan-violet" }), _jsxs("div", { className: "flex flex-col items-center gap-1.5", children: [_jsx("span", { className: "font-mono text-[10px] tracking-[0.12em] text-accent-hover", children: "ROUND 2 \u00B7 LIVE" }), _jsx("span", { className: "font-display text-[28px] font-extrabold leading-none text-text-primary", children: "08:42" }), _jsxs("div", { className: "flex gap-1.5", children: [_jsx("span", { className: "h-2 w-5 rounded-full bg-success" }), _jsx("span", { className: "h-2 w-5 rounded-full bg-accent animate-pulse" }), _jsx("span", { className: "h-2 w-5 rounded-full bg-border" })] })] }), _jsx(PlayerHeader, { nick: "@vasya", tier: "Diamond II \u00B7 2 980 LP", stats: "48 keystrokes/min \u00B7 8/15 tests", gradient: "pink-violet", mirror: true })] }));
}
const CODE_A = [
    'package main',
    '',
    'func twoSum(nums []int, target int) []int {',
    '\tleft, right := 0, len(nums)-1',
    '\tfor left < right {',
    '\t\tsum := nums[left] + nums[right]',
    '\t\tif sum == target {',
    '\t\t\treturn []int{left, right}',
    '\t\t}',
    '\t\tif sum < target {',
    '\t\t\tleft++',
    '\t\t} else {',
    '\t\t\tright--',
    '\t\t}',
];
const CODE_B = [
    'package main',
    '',
    'func twoSum(nums []int, target int) []int {',
    '\tn := len(nums)',
    '\tfor i := 0; i < n; i++ {',
    '\t\tfor j := i + 1; j < n; j++ {',
    '\t\t\tif nums[i]+nums[j] == target {',
    '\t\t\t\treturn []int{i, j}',
    '\t\t\t}',
    '\t\t\t// FAIL: timeout',
    '\t\t}',
    '\t}',
    '\treturn nil',
    '}',
];
function Editor({ border, tab, lines, highlight, failLine, typing, }) {
    return (_jsxs("div", { className: `flex flex-1 flex-col overflow-hidden rounded-xl border-2 ${border} bg-surface-1`, children: [_jsxs("div", { className: "flex h-9 items-center gap-2 border-b border-border bg-bg px-3", children: [_jsx(FileCode, { className: "h-3.5 w-3.5 text-accent-hover" }), _jsx("span", { className: "font-mono text-[12px] text-text-primary", children: tab }), typing && (_jsxs("span", { className: "ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-success", children: [_jsx(CircleDot, { className: "h-3 w-3 animate-pulse" }), "typing"] }))] }), _jsxs("div", { className: "flex flex-1 overflow-hidden", children: [_jsx("div", { className: "flex w-10 flex-col items-end border-r border-border bg-bg px-2 py-2 font-mono text-[11px] leading-[18px] text-text-muted", children: lines.map((_, i) => (_jsx("span", { className: i === highlight ? 'text-accent-hover' : i === failLine ? 'text-danger' : '', children: i + 1 }, i))) }), _jsx("pre", { className: "flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-[18px] text-text-secondary", children: lines.map((line, i) => (_jsx("div", { className: i === highlight
                                ? 'rounded-sm bg-accent/15 px-1 text-text-primary'
                                : i === failLine
                                    ? 'rounded-sm bg-danger/15 px-1 text-danger'
                                    : '', children: line || '\u00A0' }, i))) })] })] }));
}
function ChatCard({ msgs, viewers }) {
    return (_jsxs("div", { className: "flex h-[380px] flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "font-display text-[13px] font-bold text-text-primary", children: "\u0427\u0430\u0442 \u0441\u0442\u0440\u0438\u043C\u0430" }), _jsx("span", { className: "rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan", children: viewers })] }), _jsxs("div", { className: "flex flex-1 flex-col gap-1.5 overflow-y-auto", children: [msgs.slice(-30).map((m, i) => (_jsxs("div", { className: "flex items-start gap-2", children: [_jsx(Avatar, { size: "sm", gradient: "violet-cyan", initials: m.nick.charAt(1).toUpperCase() }), _jsxs("div", { className: "flex-1", children: [_jsx("span", { className: `font-mono text-[11px] font-semibold ${m.color}`, children: m.nick }), ' ', _jsx("span", { className: "text-[11px] text-text-secondary", children: m.text })] })] }, i))), _jsx("div", { className: "my-1 text-center font-mono text-[10px] italic text-accent-hover", children: "@you joined as spectator" })] }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: ['🔥', '💪', '😱', '🤯', '👏', '😅'].map((e) => (_jsx("button", { className: "grid h-7 w-7 place-items-center rounded-full bg-surface-3 text-sm hover:bg-surface-1", children: e }, e))) }), _jsxs("div", { className: "flex items-center gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5", children: [_jsx("input", { className: "flex-1 bg-transparent font-sans text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none", placeholder: "\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435..." }), _jsx("button", { className: "text-text-muted hover:text-text-primary", children: _jsx(Send, { className: "h-3.5 w-3.5" }) })] })] }));
}
function OtherMatchesCard() {
    const m = [
        { p1: '@kirill_dev', p2: '@nastya', viewers: 89 },
        { p1: '@elena', p2: '@petr', viewers: 54 },
        { p1: '@misha', p2: '@artem', viewers: 31 },
    ];
    return (_jsxs("div", { className: "flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3", children: [_jsx("h3", { className: "font-display text-[13px] font-bold text-text-primary", children: "\u0414\u0440\u0443\u0433\u0438\u0435 \u043C\u0430\u0442\u0447\u0438" }), m.map((x, i) => (_jsxs("div", { className: "flex items-center gap-2 rounded-md bg-surface-1 px-2 py-1.5", children: [_jsx("span", { className: "h-1.5 w-1.5 animate-pulse rounded-full bg-danger" }), _jsxs("span", { className: "flex-1 font-mono text-[11px] text-text-primary", children: [x.p1, " vs ", x.p2] }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: x.viewers })] }, i)))] }));
}
function BetCard() {
    return (_jsxs("div", { className: "flex flex-col gap-2.5 rounded-xl bg-gradient-to-br from-accent to-pink p-3.5 shadow-glow", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-display text-[13px] font-bold text-text-primary", children: "Bet 100 \uD83D\uDC8E" }), _jsx(Gem, { className: "h-4 w-4 text-warn" })] }), _jsxs("div", { className: "flex gap-2", children: [_jsxs("button", { className: "flex-1 rounded-md bg-white/15 px-2 py-2 text-center hover:bg-white/25", children: [_jsx("div", { className: "font-mono text-[10px] text-white/80", children: "@alexey" }), _jsx("div", { className: "font-display text-[14px] font-bold text-text-primary", children: "1.4x" })] }), _jsxs("button", { className: "flex-1 rounded-md bg-white/15 px-2 py-2 text-center hover:bg-white/25", children: [_jsx("div", { className: "font-mono text-[10px] text-warn", children: "Underdog" }), _jsx("div", { className: "font-display text-[14px] font-bold text-text-primary", children: "@vasya 2.8x" })] })] })] }));
}
function ReplayScrubber() {
    return (_jsxs("div", { className: "hidden h-24 flex-col gap-2 border-t border-border bg-surface-1 px-4 py-4 sm:px-8 lg:flex lg:px-20", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("button", { className: "grid h-9 w-9 place-items-center rounded-full bg-accent text-text-primary hover:bg-accent-hover", children: _jsx(Play, { className: "h-4 w-4", fill: "currentColor" }) }), _jsxs("span", { className: "font-mono text-[12px] text-text-primary", children: ["08:42 / ", _jsx("span", { className: "text-danger", children: "LIVE" })] }), _jsx("div", { className: "ml-2 flex rounded-md border border-border bg-surface-2", children: ['0.5x', '1x', '2x', '4x'].map((s) => (_jsx("button", { className: [
                                'px-2.5 py-1 font-mono text-[11px] font-semibold',
                                s === '1x' ? 'bg-accent text-text-primary' : 'text-text-secondary hover:bg-surface-3',
                            ].join(' '), children: s }, s))) }), _jsxs("div", { className: "relative ml-4 h-7 flex-1 overflow-hidden rounded-md bg-surface-2", children: [_jsx("div", { className: "absolute inset-y-0 left-0 w-[72%] bg-gradient-to-r from-cyan to-accent" }), _jsx("div", { className: "absolute inset-y-0 left-[72%] h-full w-1 bg-text-primary" }), [
                                { x: '12%', color: 'bg-warn' },
                                { x: '28%', color: 'bg-danger' },
                                { x: '45%', color: 'bg-cyan' },
                                { x: '60%', color: 'border border-text-muted bg-transparent' },
                                { x: '95%', color: 'bg-warn' },
                            ].map((m, i) => (_jsx("span", { className: `absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full ${m.color}`, style: { left: m.x } }, i)))] })] }), _jsx("div", { className: "flex justify-between font-mono text-[10px] text-text-muted", children: ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00'].map((t) => (_jsx("span", { children: t }, t))) })] }));
}
const INITIAL_MSGS = [
    { nick: '@dasha', color: 'text-pink', text: 'alexey красавчик, two pointers!' },
    { nick: '@maks', color: 'text-cyan', text: 'vasya brute force, не успеет' },
    { nick: '@kira', color: 'text-warn', text: 'GG если успеет до таймаута' },
    { nick: '@ivan', color: 'text-success', text: 'я бы через hashmap решил' },
];
export default function SpectatorPage() {
    const { matchId } = useParams();
    const channel = matchId ? `spectator/${matchId}` : '';
    const { lastEvent, data, status } = useChannel(channel);
    const [viewers, setViewers] = useState(142);
    const [msgs, setMsgs] = useState(INITIAL_MSGS);
    const [codeA, setCodeA] = useState(CODE_A);
    const [codeB, setCodeB] = useState(CODE_B);
    const [highlightA, setHighlightA] = useState(8);
    const [failB, setFailB] = useState(9);
    useEffect(() => {
        if (!lastEvent || !data)
            return;
        if (lastEvent === 'viewer_count') {
            setViewers(Number(data.count) || 0);
        }
        else if (lastEvent === 'chat_message') {
            const m = data;
            setMsgs((prev) => [...prev, m].slice(-50));
        }
        else if (lastEvent === 'code_update') {
            const u = data;
            if (u.side === 'a') {
                setCodeA(u.lines);
                setHighlightA(u.highlight);
            }
            else {
                setCodeB(u.lines);
                setFailB(u.highlight);
            }
        }
    }, [lastEvent, data]);
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "relative flex min-h-[calc(100vh-64px)] flex-col lg:h-[calc(100vh-72px)]", children: [_jsx("div", { className: "absolute right-4 top-4 z-10", children: _jsx(WSStatus, { status: status }) }), _jsx(Banner, { viewers: viewers }), _jsx(MatchHeader, {}), _jsxs("div", { className: "flex flex-1 flex-col gap-4 overflow-auto px-4 py-4 sm:px-8 lg:flex-row lg:overflow-hidden lg:px-20", children: [_jsxs("div", { className: "flex flex-1 flex-col gap-4 lg:flex-row", children: [_jsx(Editor, { border: "border-cyan", tab: "alexey.go", lines: codeA, highlight: highlightA, typing: true }), _jsx(Editor, { border: "border-pink", tab: "vasya.go", lines: codeB, failLine: failB })] }), _jsxs("div", { className: "flex w-full flex-col gap-4 overflow-y-auto lg:w-[320px]", children: [_jsx(ChatCard, { msgs: msgs, viewers: viewers }), _jsx(OtherMatchesCard, {}), _jsx(BetCard, {})] })] }), _jsx(ReplayScrubber, {})] }) }));
}
