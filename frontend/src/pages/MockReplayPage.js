import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { useParams } from 'react-router-dom';
import { ArrowLeft, FileCode, Flame, Play, RotateCcw, Share2, Star, Eye, } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { useMockReplayQuery } from '../lib/queries/replay';
function ErrorChip() {
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C" }));
}
function Header() {
    return (_jsxs("div", { className: "flex flex-col gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:flex-row sm:h-16 sm:items-center sm:justify-between sm:px-8 sm:py-0", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("button", { className: "grid h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-surface-2", children: _jsx(ArrowLeft, { className: "h-5 w-5" }) }), _jsx("span", { className: "font-display text-sm font-bold text-text-primary", children: "Replay \u00B7 LRU Cache \u00B7 28 \u0430\u043F\u0440" }), _jsx("span", { className: "rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan", children: "PASSED" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(Share2, { className: "h-4 w-4" }), children: "\u041F\u043E\u0434\u0435\u043B\u0438\u0442\u044C\u0441\u044F" }), _jsx(Button, { variant: "primary", size: "sm", icon: _jsx(RotateCcw, { className: "h-4 w-4" }), children: "\u0420\u0435\u0432\u0430\u043D\u0448" })] })] }));
}
function CodePlayback({ frameLabel }) {
    const lines = [
        'package main',
        '',
        'import "container/list"',
        '',
        'type entry struct { key, val int }',
        '',
        'type LRUCache struct {',
        '    cap   int',
        '    data  map[int]*list.Element',
        '    order *list.List',
        '}',
        '',
        'func New(cap int) *LRUCache {',
        '    return &LRUCache{cap: cap,',
        '        data: map[int]*list.Element{},',
        '        order: list.New()}',
        '}',
        '',
        'func (c *LRUCache) Get(k int) int {',
        '    if e, ok := c.data[k]; ok {',
        '        c.order.MoveToFront(e)',
        '        return e.Value.(*entry).val',
        '    }',
    ];
    const annotations = {
        4: { color: 'bg-cyan/20 text-cyan', text: '>> 0:08' },
        7: { color: 'bg-warn/20 text-warn', text: 'paused 28s' },
        13: { color: 'bg-accent/20 text-accent-hover', text: 'return' },
    };
    return (_jsxs("div", { className: "flex min-w-0 flex-1 flex-col", children: [_jsxs("div", { className: "flex h-11 items-center justify-between border-b border-border px-4", children: [_jsxs("div", { className: "flex items-center gap-2.5", children: [_jsx(FileCode, { className: "h-4 w-4 text-text-secondary" }), _jsx("span", { className: "font-mono text-[13px] text-text-primary", children: "solution.go" })] }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: frameLabel })] }), _jsxs("div", { className: "flex flex-1 overflow-auto bg-surface-1", children: [_jsx("div", { className: "flex flex-col items-end px-3 py-3 font-mono text-[12px] text-text-muted select-none", children: lines.map((_, i) => (_jsx("span", { className: i === 11 ? 'text-accent-hover font-semibold' : '', children: i + 1 }, i))) }), _jsx("div", { className: "flex flex-1 flex-col py-3 pr-4 font-mono text-[12px] text-text-secondary", children: lines.map((line, i) => {
                            const a = annotations[i];
                            const isCursor = i === 11;
                            const isStrike = i === 17;
                            return (_jsxs("div", { className: "relative flex items-center gap-2", children: [_jsx("pre", { className: [
                                            'whitespace-pre',
                                            isCursor ? 'bg-accent/15 text-text-primary -mx-2 px-2 rounded' : '',
                                            isStrike ? 'line-through text-danger' : '',
                                        ].join(' '), children: line || ' ' }), isCursor && _jsx("span", { className: "inline-block h-4 w-0.5 animate-pulse bg-cyan" }), a && (_jsx("span", { className: `rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${a.color}`, children: a.text })), isStrike && (_jsx("span", { className: "rounded bg-danger/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-danger", children: "\u21BB wrong order" }))] }, i));
                        }) })] })] }));
}
function EventsSidebar({ events }) {
    const colorMap = {
        cyan: 'bg-cyan',
        warn: 'bg-warn',
        accent: 'bg-accent',
        danger: 'bg-danger',
        success: 'bg-success',
        pink: 'bg-pink',
    };
    return (_jsxs("div", { className: "flex w-full flex-col bg-surface-2 border-t border-border lg:w-[360px] lg:border-l lg:border-t-0", children: [_jsx("div", { className: "flex gap-1 border-b border-border px-3 pt-3", children: ['EVENTS', 'TYPING', 'TESTS', 'AI INSIGHT'].map((t, i) => (_jsx("button", { className: [
                        'rounded-t-md px-3 py-2 font-mono text-[11px] font-semibold',
                        i === 0
                            ? 'bg-surface-1 text-text-primary'
                            : 'text-text-muted hover:text-text-secondary',
                    ].join(' '), children: t }, t))) }), _jsx("div", { className: "flex flex-1 flex-col gap-3 overflow-auto p-4", children: events.map((e, i) => (_jsxs("div", { className: "flex items-start gap-3 rounded-lg bg-surface-1 p-3", children: [_jsx("span", { className: `mt-1.5 h-2 w-2 rounded-full ${colorMap[e.color] ?? 'bg-cyan'}` }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx("span", { className: "text-[13px] font-semibold text-text-primary", children: e.label }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: e.sub })] }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: e.time })] }, i))) })] }));
}
function Scrubber() {
    const markers = [
        { left: '8%', color: 'bg-cyan' },
        { left: '18%', color: 'bg-warn' },
        { left: '36%', color: 'bg-success' },
        { left: '52%', color: 'bg-danger' },
        { left: '68%', color: 'bg-accent' },
        { left: '88%', color: 'bg-warn', star: true },
    ];
    return (_jsxs("div", { className: "flex h-auto flex-col gap-3 border-t border-border bg-surface-1 px-4 py-4 sm:px-6 lg:h-[130px]", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-3 sm:gap-4", children: [_jsx("button", { className: "grid h-10 w-10 place-items-center rounded-full bg-accent text-text-primary shadow-glow hover:bg-accent-hover", children: _jsx(Play, { className: "h-4 w-4" }) }), _jsxs("span", { className: "font-mono text-[13px] text-text-primary", children: ["1:42 ", _jsx("span", { className: "text-text-muted", children: "/ 4:21" })] }), _jsx("div", { className: "flex rounded-md bg-surface-2 p-0.5", children: ['0.5x', '1x', '1.5x', '2x'].map((s) => (_jsx("button", { className: [
                                'rounded px-2.5 py-1 font-mono text-[11px] font-semibold',
                                s === '1x' ? 'bg-accent text-text-primary' : 'text-text-secondary',
                            ].join(' '), children: s }, s))) }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Eye, { className: "h-4 w-4 text-success" }), _jsx("span", { className: "text-[12px] text-text-secondary", children: "Show ghost" }), _jsx("span", { className: "h-4 w-7 rounded-full bg-success/40 p-0.5", children: _jsx("span", { className: "block h-3 w-3 translate-x-3 rounded-full bg-success" }) })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Flame, { className: "h-4 w-4 text-text-muted" }), _jsx("span", { className: "text-[12px] text-text-muted", children: "Heatmap" }), _jsx("span", { className: "h-4 w-7 rounded-full bg-border p-0.5", children: _jsx("span", { className: "block h-3 w-3 rounded-full bg-text-muted" }) })] })] }), _jsxs("div", { className: "relative", children: [_jsxs("div", { className: "relative h-8 overflow-hidden rounded-full bg-black/40", children: [_jsx("div", { className: "absolute inset-y-0 left-0 w-[40%] bg-gradient-to-r from-accent to-accent-hover" }), _jsx("div", { className: "absolute inset-y-0 left-[40%] w-0.5 bg-text-primary" }), markers.map((m, i) => (_jsx("div", { className: `absolute top-1.5 h-5 w-1.5 rounded-sm ${m.color}`, style: { left: m.left }, children: m.star && _jsx(Star, { className: "absolute -top-3 left-1/2 h-3 w-3 -translate-x-1/2 text-warn" }) }, i)))] }), _jsxs("div", { className: "mt-1.5 flex justify-between font-mono text-[10px] text-text-muted", children: [_jsx("span", { children: "0:00" }), _jsx("span", { children: "1:00" }), _jsx("span", { children: "2:00" }), _jsx("span", { children: "3:00" }), _jsx("span", { children: "4:21" })] })] })] }));
}
const FALLBACK_EVENTS = [
    { id: 'e1', color: 'cyan', label: 'Start typing', sub: 'lru.go open', time: '0:08' },
    { id: 'e2', color: 'warn', label: 'Long pause', sub: '28s thinking', time: '0:34' },
    { id: 'e3', color: 'accent', label: 'Refactor', sub: 'extracted helper', time: '1:12' },
    { id: 'e4', color: 'danger', label: 'Test fail', sub: 'eviction order', time: '1:42' },
    { id: 'e5', color: 'success', label: 'Test pass', sub: '15/15 ok', time: '2:55' },
    { id: 'e6', color: 'pink', label: 'Submit', sub: 'final answer', time: '4:21' },
];
export default function MockReplayPage() {
    const { sessionId } = useParams();
    const { data, isError } = useMockReplayQuery(sessionId);
    const events = data?.events ?? FALLBACK_EVENTS;
    const frameLabel = data ? `Frame ${data.current_frame} / ${data.total_frames}` : 'Frame 142 / 287';
    return (_jsxs(AppShellV2, { children: [_jsx(Header, {}), _jsxs("div", { className: "flex flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8", children: [isError && _jsx(ErrorChip, {}), _jsxs("div", { className: "flex h-auto flex-col overflow-hidden rounded-[14px] border border-border bg-surface-1 lg:h-[580px] lg:flex-row", children: [_jsx(CodePlayback, { frameLabel: frameLabel }), _jsx(EventsSidebar, { events: events })] }), _jsx("div", { className: "overflow-hidden rounded-[14px] border border-border", children: _jsx(Scrubber, {}) })] })] }));
}
