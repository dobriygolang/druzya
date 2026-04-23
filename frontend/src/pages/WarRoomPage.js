import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Mic, MicOff, Flag, Send, RotateCcw } from 'lucide-react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { WSStatus } from '../components/ws/WSStatus';
import { useChannel } from '../lib/ws';
function CrisisBanner() {
    return (_jsxs("div", { className: "flex h-auto flex-col gap-3 px-4 py-3 sm:px-6 lg:h-20 lg:flex-row lg:items-center lg:justify-between lg:px-8 lg:py-0", style: { background: 'linear-gradient(90deg, #2A0510 0%, rgba(239,68,68,0.95) 100%)' }, children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "h-3 w-3 animate-pulse rounded-full bg-danger" }), _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-display text-base font-bold text-text-primary", children: "\uD83D\uDEA8 PRODUCTION \u0418\u041D\u0426\u0418\u0414\u0415\u041D\u0422 \u00B7 IRONCLAD GUILD" }), _jsx("span", { className: "font-mono text-[11px] text-white/80", children: "P0 \u00B7 4 minutes since incident" })] })] }), _jsx("div", { className: "font-display text-3xl font-extrabold text-text-primary", children: "\u041E\u0421\u0422\u0410\u041B\u041E\u0421\u042C 26:14" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(Mic, { className: "h-3.5 w-3.5" }), children: "Voice room" }), _jsx(Button, { variant: "danger", size: "sm", icon: _jsx(Flag, { className: "h-3.5 w-3.5" }), children: "\u0421\u0434\u0430\u0442\u044C\u0441\u044F" })] })] }));
}
function IncidentDescription() {
    return (_jsxs("div", { className: "flex flex-col gap-1 border-b border-border bg-surface-1 px-4 py-4 sm:px-6 lg:px-8", children: [_jsx("h2", { className: "font-display text-base font-bold text-text-primary", children: "Incident: API \u043F\u0430\u0434\u0430\u0435\u0442 \u043D\u0430 /api/v1/checkout, 500 errors \u043D\u0430 80%" }), _jsx("p", { className: "text-xs text-text-secondary", children: "\u0421\u0438\u043C\u043F\u0442\u043E\u043C\u044B \u043F\u043E\u044F\u0432\u0438\u043B\u0438\u0441\u044C \u043F\u043E\u0441\u043B\u0435 \u0434\u0435\u043F\u043B\u043E\u044F 12:47. CPU \u043D\u0430 api-pods \u0432 \u043D\u043E\u0440\u043C\u0435, \u043D\u043E DB latency \u0432\u0437\u043B\u0435\u0442\u0435\u043B\u0430. \u041B\u043E\u0433 \u0441\u044B\u043F\u0435\u0442 N+1 query \u043D\u0430 checkout flow. \u041A\u043E\u043C\u0430\u043D\u0434\u0430 \u2014 \u043D\u0430\u0439\u0442\u0438 \u0438 \u043F\u043E\u0444\u0438\u043A\u0441\u0438\u0442\u044C." })] }));
}
const members = [
    {
        name: '@you',
        role: 'Go backend',
        task: 'Фикс N+1 в checkout handler',
        progress: 60,
        status: 'coding',
        active: true,
        initials: 'Я',
        gradient: 'violet-cyan',
    },
    {
        name: '@nastya',
        role: 'SQL',
        task: 'Добавляет index на orders.user_id',
        progress: 80,
        status: 'querying',
        initials: 'Н',
        gradient: 'pink-violet',
    },
    {
        name: '@kirill_dev',
        role: 'System Design',
        task: 'Рисует архитектуру кеша',
        progress: 30,
        status: 'thinking',
        initials: 'К',
        gradient: 'cyan-violet',
    },
    {
        name: '@misha',
        role: 'DevOps',
        task: 'Готовит rollback и метрики',
        progress: 50,
        status: 'monitoring',
        initials: 'М',
        gradient: 'success-cyan',
    },
];
function MemberCard({ m }) {
    return (_jsxs("div", { className: `flex flex-col gap-3 rounded-[12px] border bg-surface-2 p-3.5 ${m.active ? 'border-accent' : 'border-border'}`, children: [_jsxs("div", { className: "flex items-center gap-2.5", children: [_jsx(Avatar, { size: "sm", gradient: m.gradient, initials: m.initials, status: "online" }), _jsx("span", { className: "flex-1 text-[13px] font-semibold text-text-primary", children: m.name }), _jsx("span", { className: "h-2 w-2 animate-pulse rounded-full bg-success" })] }), _jsx("span", { className: "w-fit rounded-full bg-accent/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent-hover", children: m.role }), _jsx("p", { className: "text-[11px] text-text-secondary", children: m.task }), _jsx("div", { className: "h-1.5 overflow-hidden rounded-full bg-surface-3", children: _jsx("div", { className: "h-full rounded-full bg-cyan", style: { width: `${m.progress}%` } }) }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: m.status })] }));
}
function LeftTeam({ liveMembers }) {
    return (_jsxs("div", { className: "flex w-full flex-col gap-4 border-b border-border bg-surface-1 p-4 lg:w-[320px] lg:border-b-0 lg:border-r", children: [_jsx("h3", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: "\u0412\u0410\u0428\u0410 \u041A\u041E\u041C\u0410\u041D\u0414\u0410 (4)" }), liveMembers.map((m) => (_jsx(MemberCard, { m: m }, m.name)))] }));
}
const codeLines = [
    'func CheckoutHandler(w http.ResponseWriter, r *http.Request) {',
    '    userID := getUser(r)',
    '    cart, err := db.LoadCart(userID)',
    '    if err != nil { http.Error(w, err.Error(), 500); return }',
    '',
    '    items := []Item{}',
    '    for _, id := range cart.ItemIDs {',
    '        item, err := db.GetItem(id) // ← N+1',
    '        if err != nil { continue }',
    '        price, _ := db.GetPrice(item.SKU) // ← N+1',
    '        tax, _ := db.GetTax(item.SKU) // ← N+1',
    '        promo, _ := db.GetPromo(item.SKU, userID) // ← N+1',
    '        items = append(items, item.WithPrice(price, tax, promo))',
    '    }',
    '',
    '    total := computeTotal(items)',
    '    json.NewEncoder(w).Encode(map[string]any{"items": items, "total": total})',
    '}',
];
function CenterWorkspace({ score }) {
    const tabs = [
        { name: 'Code · @you', active: true },
        { name: 'SQL · @nastya' },
        { name: 'Whiteboard · @kirill', dot: true },
        { name: 'Metrics · @misha' },
    ];
    return (_jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx("div", { className: "flex h-10 items-center gap-1 border-b border-border bg-surface-1 px-4", children: tabs.map((t, i) => (_jsxs("button", { className: `flex items-center gap-2 rounded-md px-3 py-1.5 font-mono text-[11px] ${t.active ? 'bg-surface-2 text-text-primary' : 'text-text-secondary hover:bg-surface-2'}`, children: [t.name, t.dot && _jsx("span", { className: "h-1.5 w-1.5 rounded-full bg-danger" })] }, i))) }), _jsxs("div", { className: "flex flex-1 overflow-auto", children: [_jsx("div", { className: "flex w-12 flex-col border-r border-border bg-surface-2 py-3 text-right", children: codeLines.map((_, i) => (_jsx("span", { className: "px-3 font-mono text-[11px] text-text-muted", children: i + 1 }, i))) }), _jsx("div", { className: "flex flex-1 flex-col py-3", children: codeLines.map((line, i) => {
                            const hl = i >= 7 && i <= 11;
                            return (_jsx("code", { className: `whitespace-pre px-4 font-mono text-[12px] ${hl ? 'bg-danger/10 text-text-primary' : 'text-text-secondary'}`, children: line || ' ' }, i));
                        }) })] }), _jsxs("div", { className: "flex h-14 items-center justify-between border-t border-border bg-surface-1 px-4", children: [_jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "danger", size: "sm", icon: _jsx(Send, { className: "h-3.5 w-3.5" }), children: "Hotfix Push" }), _jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(RotateCcw, { className: "h-3.5 w-3.5" }), children: "Rollback" })] }), _jsxs("span", { className: "rounded-full bg-warn/15 px-3 py-1 font-mono text-xs font-semibold text-warn", children: [score.label, ": 80% \u2192 ", score.errorRate, "%"] })] })] }));
}
function RightComms({ logs }) {
    return (_jsxs("div", { className: "flex w-full flex-col gap-4 border-t border-border bg-surface-1 p-4 lg:w-[320px] lg:border-l lg:border-t-0", children: [_jsxs("div", { className: "rounded-xl border border-border bg-gradient-to-br from-accent/30 to-danger/30 p-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold text-text-primary", children: "VOICE" }), _jsx("button", { className: "grid h-7 w-7 place-items-center rounded-full bg-white/10 text-text-primary", children: _jsx(MicOff, { className: "h-3.5 w-3.5" }) })] }), _jsx("div", { className: "mt-3 flex -space-x-1.5", children: ['violet-cyan', 'pink-violet', 'cyan-violet', 'success-cyan'].map((g, i) => (_jsx(Avatar, { size: "sm", gradient: g, initials: ['Я', 'Н', 'К', 'М'][i] }, i))) })] }), _jsxs(Card, { className: "flex-col gap-2 p-4", interactive: false, children: [_jsx("h3", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: "\u041B\u041E\u0413 \u0418\u041D\u0426\u0418\u0414\u0415\u041D\u0422\u0410" }), logs.slice(-12).map((l, i) => (_jsxs("div", { className: "flex items-start gap-2 border-b border-border pb-1.5 last:border-0", children: [_jsx("span", { className: `mt-1 h-1.5 w-1.5 rounded-full ${l.c}` }), _jsx("span", { className: "flex-1 font-mono text-[10px] text-text-secondary", children: l.t }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: l.time })] }, i)))] }), _jsxs(Card, { className: "flex-col gap-2 border-warn/40 p-4", interactive: false, children: [_jsx("h3", { className: "font-display text-sm font-bold text-warn", children: "\u041D\u0430\u0433\u0440\u0430\u0434\u0430 \u0437\u0430 \u043F\u043E\u0431\u0435\u0434\u0443" }), _jsxs("div", { className: "flex justify-between text-xs", children: [_jsx("span", { className: "text-text-secondary", children: "\u0413\u0438\u043B\u044C\u0434\u0438\u044F" }), _jsx("span", { className: "font-mono text-warn", children: "+1500 SP" })] }), _jsxs("div", { className: "flex justify-between text-xs", children: [_jsx("span", { className: "text-text-secondary", children: "\u0422\u044B" }), _jsx("span", { className: "font-mono text-warn", children: "+800 XP" })] }), _jsxs("div", { className: "flex justify-between text-xs", children: [_jsx("span", { className: "text-text-secondary", children: "\u0411\u0435\u0439\u0434\u0436" }), _jsx("span", { className: "font-mono text-warn", children: "\u00ABFirefighter\u00BB" })] })] })] }));
}
const INITIAL_LOGS = [
    { c: 'bg-danger', t: '[12:47] Alarm triggered: 500 errors > 75%', time: '4m ago' },
    { c: 'bg-warn', t: '[12:48] @misha: starting rollback prep', time: '3m' },
    { c: 'bg-cyan', t: '[12:49] @kirill: looks like N+1 in checkout', time: '3m' },
    { c: 'bg-accent', t: '[12:50] @you: pulling pprof', time: '3m' },
    { c: 'bg-pink', t: '[12:51] @nastya: index on orders missing', time: '2m' },
    { c: 'bg-success', t: '[12:52] errors dropped to 50%', time: '2m' },
];
export default function WarRoomPage() {
    const { incidentId } = useParams();
    const channel = `warroom/${incidentId ?? 'current'}`;
    const { lastEvent, data, status } = useChannel(channel);
    const [logs, setLogs] = useState(INITIAL_LOGS);
    const [liveMembers, setLiveMembers] = useState(members);
    const [score, setScore] = useState({ errorRate: 12, label: 'API errors' });
    useEffect(() => {
        if (!lastEvent || !data)
            return;
        if (lastEvent === 'log_event') {
            const e = data;
            setLogs((prev) => [...prev, { c: e.color ?? 'bg-cyan', t: e.text ?? '', time: e.time ?? 'now' }].slice(-50));
        }
        else if (lastEvent === 'member_status') {
            const u = data;
            setLiveMembers((prev) => prev.map((m) => (m.name === u.name ? { ...m, progress: u.progress, status: u.status } : m)));
        }
        else if (lastEvent === 'score_update') {
            const u = data;
            setScore({ errorRate: u.errorRate, label: u.label ?? 'API errors' });
        }
    }, [lastEvent, data]);
    return (_jsxs("div", { className: "relative min-h-screen bg-bg text-text-primary", children: [_jsx("div", { className: "absolute right-4 top-4 z-20", children: _jsx(WSStatus, { status: status }) }), _jsx(CrisisBanner, {}), _jsx(IncidentDescription, {}), _jsxs("div", { className: "flex flex-col lg:h-[calc(100vh-80px-92px)] lg:flex-row", children: [_jsx(LeftTeam, { liveMembers: liveMembers }), _jsx(CenterWorkspace, { score: score }), _jsx(RightComms, { logs: logs })] })] }));
}
