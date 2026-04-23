import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { Link } from 'react-router-dom';
import { Check, ArrowLeft } from 'lucide-react';
import { Button } from '../components/Button';
function TopBar() {
    return (_jsxs("div", { className: "flex h-auto items-center justify-between gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-7 lg:h-14 lg:py-0", children: [_jsxs("div", { className: "flex items-center gap-2.5", children: [_jsx("span", { className: "grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-sm font-extrabold text-text-primary", children: "9" }), _jsx("span", { className: "font-display text-base font-bold text-text-primary", children: "druz9 status" }), _jsx("span", { className: "rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[9px] text-text-muted", children: "v3.2" })] }), _jsx(Link, { to: "/sanctum", children: _jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(ArrowLeft, { className: "h-3.5 w-3.5" }), children: "\u041D\u0430 \u0433\u043B\u0430\u0432\u043D\u0443\u044E" }) })] }));
}
function Hero() {
    return (_jsxs("div", { className: "flex flex-col items-center justify-center gap-3.5 px-4 py-8 sm:px-8 lg:px-20 lg:py-10", children: [_jsx("div", { className: "grid h-24 w-24 place-items-center rounded-full bg-success/20", style: { boxShadow: 'inset 0 0 0 3px #10B981' }, children: _jsx(Check, { className: "h-14 w-14 text-success", strokeWidth: 3 }) }), _jsx("h1", { className: "font-display text-2xl lg:text-[32px] font-extrabold text-success text-center", children: "\u0412\u0441\u0435 \u0441\u0438\u0441\u0442\u0435\u043C\u044B \u0440\u0430\u0431\u043E\u0442\u0430\u044E\u0442" }), _jsx("p", { className: "text-sm text-text-secondary", children: "\u0410\u043F\u0442\u0430\u0439\u043C 99.97% \u0437\u0430 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 90 \u0434\u043D\u0435\u0439 \u00B7 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E 23 \u0441\u0435\u043A\u0443\u043D\u0434\u044B \u043D\u0430\u0437\u0430\u0434" })] }));
}
const services = [
    { name: 'Web App', sub: 'app.druz9.io', uptime: '100%', status: 'ok', bars: Array.from({ length: 30 }).map(() => 'ok') },
    { name: 'REST API', sub: 'api.druz9.io', uptime: '99.99%', status: 'ok', bars: Array.from({ length: 30 }).map((_, i) => (i === 22 ? 'warn' : 'ok')) },
    { name: 'WebSocket', sub: 'ws.druz9.io', uptime: '99.95%', status: 'ok', bars: Array.from({ length: 30 }).map((_, i) => (i === 8 || i === 18 ? 'warn' : 'ok')) },
    { name: 'PostgreSQL', sub: 'primary db', uptime: '100%', status: 'ok', bars: Array.from({ length: 30 }).map(() => 'ok') },
    { name: 'Redis', sub: 'cache cluster', uptime: '100%', status: 'ok', bars: Array.from({ length: 30 }).map(() => 'ok') },
    { name: 'MinIO', sub: 'object storage', uptime: '99.99%', status: 'ok', bars: Array.from({ length: 30 }).map((_, i) => (i === 14 ? 'warn' : 'ok')) },
    { name: 'Judge0', sub: 'code execution · degraded', uptime: '99.4%', status: 'warn', bars: Array.from({ length: 30 }).map((_, i) => ([5, 6, 7, 19, 25].includes(i) ? 'warn' : 'ok')) },
    { name: 'OpenRouter', sub: 'LLM gateway', uptime: '99.8%', status: 'ok', bars: Array.from({ length: 30 }).map((_, i) => ([11, 24].includes(i) ? 'warn' : 'ok')) },
];
function ServicesList() {
    return (_jsxs("div", { className: "overflow-hidden rounded-2xl bg-surface-2", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border px-6 py-4", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0421\u0435\u0440\u0432\u0438\u0441\u044B" }), _jsx("span", { className: "rounded-full bg-surface-3 px-2.5 py-0.5 font-mono text-[10px] text-text-muted", children: "Refresh in 30s" })] }), services.map((s) => (_jsxs("div", { className: "flex flex-col gap-3 border-b border-border/50 px-4 py-3.5 last:border-0 sm:flex-row sm:items-center sm:gap-4 sm:px-6", children: [_jsx("span", { className: `h-2.5 w-2.5 rounded-full ${s.status === 'ok' ? 'bg-success' : 'bg-warn'}` }), _jsxs("div", { className: "flex w-44 flex-col", children: [_jsx("span", { className: "text-sm font-semibold text-text-primary", children: s.name }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: s.sub })] }), _jsx("div", { className: "flex h-6 flex-1 items-center gap-[1px]", children: s.bars.map((b, i) => (_jsx("span", { className: `h-6 w-[3px] rounded-sm ${b === 'ok' ? 'bg-success' : 'bg-warn'}` }, i))) }), _jsxs("div", { className: "flex w-28 flex-col items-end", children: [_jsx("span", { className: `font-mono text-sm font-semibold ${s.status === 'ok' ? 'text-success' : 'text-warn'}`, children: s.uptime }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: "uptime 90d" })] })] }, s.name)))] }));
}
const incidents = [
    {
        title: 'Judge0 — повышенная задержка выполнения кода',
        body: 'Очередь джобов росла из-за проблем с одним worker-узлом. Узел перезапущен, очередь рассосалась.',
        date: '20 апр 2026',
    },
    {
        title: 'OpenRouter — частичные отказы вызовов LLM',
        body: 'Upstream provider давал 5xx около 8 минут. Переключились на резервный route.',
        date: '12 апр 2026',
    },
    {
        title: 'WebSocket — кратковременные дисконнекты',
        body: 'Релиз ingress контроллера вызвал re-handshake. Откат за 2 минуты.',
        date: '5 апр 2026',
    },
];
function IncidentsCard() {
    return (_jsxs("div", { className: "rounded-2xl bg-surface-2 p-6", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u041D\u0435\u0434\u0430\u0432\u043D\u0438\u0435 \u0438\u043D\u0446\u0438\u0434\u0435\u043D\u0442\u044B" }), _jsx("div", { className: "mt-4 flex flex-col gap-3", children: incidents.map((inc) => (_jsxs("div", { className: "rounded-[10px] bg-surface-1 p-3.5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "rounded-full bg-success/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-success", children: "RESOLVED" }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: inc.date })] }), _jsx("h4", { className: "mt-2 font-display text-sm font-bold text-text-primary", children: inc.title }), _jsx("p", { className: "mt-1 text-xs text-text-secondary", children: inc.body }), _jsx("div", { className: "mt-3 flex items-center gap-2", children: ['Зарегистрирован', 'Investigation', 'Fix', 'Resolved'].map((step, i) => (_jsxs("div", { className: "flex flex-1 items-center gap-2", children: [_jsx("span", { className: "h-2 w-2 rounded-full bg-success" }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: step }), i < 3 && _jsx("span", { className: "h-px flex-1 bg-border" })] }, step))) })] }, inc.title))) })] }));
}
function SubscribeCard() {
    return (_jsxs("div", { className: "flex-1 rounded-2xl bg-surface-2 p-6", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u041F\u043E\u0434\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F \u043D\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F" }), _jsx("p", { className: "mt-1 text-xs text-text-secondary", children: "\u041F\u0438\u0441\u044C\u043C\u043E \u043F\u0440\u0438 \u043A\u0430\u0436\u0434\u043E\u043C \u0438\u043D\u0446\u0438\u0434\u0435\u043D\u0442\u0435 \u0438 \u0435\u0433\u043E resolve." }), _jsxs("div", { className: "mt-4 flex gap-2", children: [_jsx("input", { className: "flex-1 rounded-md border border-border bg-surface-1 px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted", placeholder: "you@example.com" }), _jsx(Button, { variant: "primary", size: "sm", children: "\u041F\u043E\u0434\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F" })] })] }));
}
function MetricsCard() {
    const rows = [
        ['Аптайм 90d', '99.97%'],
        ['Инцидентов', '3'],
        ['Latency p95', '142ms'],
        ['MTTR', '11 мин'],
    ];
    return (_jsxs("div", { className: "flex-1 rounded-2xl bg-surface-2 p-6", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u041C\u0435\u0442\u0440\u0438\u043A\u0438 90 \u0434\u043D\u0435\u0439" }), _jsx("div", { className: "mt-4 flex flex-col gap-3", children: rows.map(([k, v]) => (_jsxs("div", { className: "flex items-center justify-between border-b border-border pb-2 last:border-0", children: [_jsx("span", { className: "text-sm text-text-secondary", children: k }), _jsx("span", { className: "font-mono text-sm font-semibold text-text-primary", children: v })] }, k))) })] }));
}
export default function StatusPage() {
    return (_jsxs("div", { className: "min-h-screen bg-bg text-text-primary", children: [_jsx(TopBar, {}), _jsx(Hero, {}), _jsxs("div", { className: "flex flex-col gap-5 px-4 pb-6 sm:px-8 lg:px-20 lg:pb-7", children: [_jsx(ServicesList, {}), _jsx(IncidentsCard, {}), _jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:gap-5", children: [_jsx(SubscribeCard, {}), _jsx(MetricsCard, {})] })] })] }));
}
