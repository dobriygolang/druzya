import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// StatusPage — public uptime / transparency surface.
//
// Replaces the apigen-era hard-coded service grid + dated "20 апр 2026"
// incident list with live data from GET /api/v1/status (public endpoint).
//
// Refetches every 30s — same TTL as the server-side Redis cache, so the
// browser sees the freshest snapshot the moment it expires upstream.
// TODO i18n
import { Link } from 'react-router-dom';
import { Check, ArrowLeft, AlertTriangle, AlertCircle } from 'lucide-react';
import { Button } from '../components/Button';
import { useStatusPageQuery } from '../lib/queries/status';
function TopBar() {
    return (_jsxs("div", { className: "flex h-auto items-center justify-between gap-3 border-b border-border bg-surface-1 px-4 py-3 sm:px-7 lg:h-14 lg:py-0", children: [_jsxs("div", { className: "flex items-center gap-2.5", children: [_jsx("span", { className: "grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-sm font-extrabold text-text-primary", children: "9" }), _jsx("span", { className: "font-display text-base font-bold text-text-primary", children: "druz9 status" }), _jsx("span", { className: "rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[9px] text-text-muted", children: "v3.2" })] }), _jsx(Link, { to: "/sanctum", children: _jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(ArrowLeft, { className: "h-3.5 w-3.5" }), children: "\u041D\u0430 \u0433\u043B\u0430\u0432\u043D\u0443\u044E" }) })] }));
}
function Hero({ status, uptime90d, generatedAt, }) {
    const cfg = heroConfigForStatus(status);
    const seconds = secondsAgo(generatedAt);
    return (_jsxs("div", { className: "flex flex-col items-center justify-center gap-3.5 px-4 py-8 sm:px-8 lg:px-20 lg:py-10", children: [_jsx("div", { className: `grid h-24 w-24 place-items-center rounded-full ${cfg.bg}`, style: { boxShadow: `inset 0 0 0 3px ${cfg.ring}` }, children: cfg.icon }), _jsx("h1", { className: `font-display text-2xl lg:text-[32px] font-extrabold ${cfg.text} text-center`, children: cfg.title }), _jsxs("p", { className: "text-sm text-text-secondary", children: ["\u0410\u043F\u0442\u0430\u0439\u043C ", uptime90d, " \u0437\u0430 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 90 \u0434\u043D\u0435\u0439 \u00B7 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E ", seconds === null ? '—' : `${seconds} ${pluralizeSeconds(seconds)} назад`] })] }));
}
function heroConfigForStatus(s) {
    switch (s) {
        case 'operational':
            return {
                bg: 'bg-success/20',
                ring: '#10B981',
                text: 'text-success',
                title: 'Все системы работают',
                icon: _jsx(Check, { className: "h-14 w-14 text-success", strokeWidth: 3 }),
            };
        case 'degraded':
            return {
                bg: 'bg-warn/20',
                ring: '#F59E0B',
                text: 'text-warn',
                title: 'Частичная деградация',
                icon: _jsx(AlertTriangle, { className: "h-14 w-14 text-warn", strokeWidth: 3 }),
            };
        case 'down':
        default:
            return {
                bg: 'bg-danger/20',
                ring: '#EF4444',
                text: 'text-danger',
                title: 'Перебои в работе',
                icon: _jsx(AlertCircle, { className: "h-14 w-14 text-danger", strokeWidth: 3 }),
            };
    }
}
function ServicesList({ services }) {
    // We render a fixed number of "history bars" per service: 30 dummy bars
    // because we don't yet expose a per-day history series. Bars all show as
    // ok unless the current state is degraded/down — in which case the most
    // recent ~5 bars flip color, matching the visual mockup. When the
    // backend grows a real bucketed history this is the place to plug it in.
    return (_jsxs("div", { className: "overflow-hidden rounded-2xl bg-surface-2", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border px-6 py-4", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0421\u0435\u0440\u0432\u0438\u0441\u044B" }), _jsx("span", { className: "rounded-full bg-surface-3 px-2.5 py-0.5 font-mono text-[10px] text-text-muted", children: "Refresh in 30s" })] }), services.length === 0 && (_jsx("div", { className: "px-6 py-10 text-center font-mono text-sm text-text-muted", children: "\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445 \u043E \u0441\u0435\u0440\u0432\u0438\u0441\u0430\u0445" })), services.map((s) => {
                const bars = buildSparkBars(s.status);
                return (_jsxs("div", { className: "flex flex-col gap-3 border-b border-border/50 px-4 py-3.5 last:border-0 sm:flex-row sm:items-center sm:gap-4 sm:px-6", children: [_jsx("span", { className: `h-2.5 w-2.5 rounded-full ${s.status === 'operational' ? 'bg-success' : s.status === 'degraded' ? 'bg-warn' : 'bg-danger'}` }), _jsxs("div", { className: "flex w-44 flex-col", children: [_jsx("span", { className: "text-sm font-semibold text-text-primary", children: s.name }), _jsxs("span", { className: "font-mono text-[10px] text-text-muted", children: [s.slug, typeof s.latency_ms === 'number' && s.latency_ms > 0 ? ` · ${s.latency_ms} ms` : ''] })] }), _jsx("div", { className: "flex h-6 flex-1 items-center gap-[1px]", children: bars.map((b, i) => (_jsx("span", { className: `h-6 w-[3px] rounded-sm ${b === 'ok' ? 'bg-success' : b === 'degraded' ? 'bg-warn' : 'bg-danger'}` }, i))) }), _jsxs("div", { className: "flex w-28 flex-col items-end", children: [_jsx("span", { className: `font-mono text-sm font-semibold ${s.status === 'operational' ? 'text-success' : s.status === 'degraded' ? 'text-warn' : 'text-danger'}`, children: s.uptime_30d }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: "uptime 30d" })] })] }, s.slug || s.name));
            })] }));
}
function buildSparkBars(status) {
    const total = 30;
    const out = [];
    for (let i = 0; i < total; i++)
        out.push('ok');
    if (status === 'degraded') {
        for (let i = total - 5; i < total; i++)
            out[i] = 'degraded';
    }
    else if (status === 'down') {
        for (let i = total - 3; i < total; i++)
            out[i] = 'down';
    }
    return out;
}
function IncidentsCard({ incidents }) {
    return (_jsxs("div", { className: "rounded-2xl bg-surface-2 p-6", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u041D\u0435\u0434\u0430\u0432\u043D\u0438\u0435 \u0438\u043D\u0446\u0438\u0434\u0435\u043D\u0442\u044B" }), incidents.length === 0 && (_jsx("div", { className: "mt-4 rounded-[10px] bg-surface-1 p-4 text-center font-mono text-sm text-text-muted", children: "\u0418\u043D\u0446\u0438\u0434\u0435\u043D\u0442\u043E\u0432 \u043D\u0435 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u043E." })), _jsx("div", { className: "mt-4 flex flex-col gap-3", children: incidents.map((inc) => {
                    const resolved = inc.ended_at !== null && inc.ended_at !== undefined && inc.ended_at !== '';
                    return (_jsxs("div", { className: "rounded-[10px] bg-surface-1 p-3.5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: `rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${resolved ? 'bg-success/15 text-success' : severityChip(inc.severity)}`, children: resolved ? 'RESOLVED' : (inc.severity || 'open').toUpperCase() }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: new Date(inc.started_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) })] }), _jsx("h4", { className: "mt-2 font-display text-sm font-bold text-text-primary", children: inc.title }), inc.description && _jsx("p", { className: "mt-1 text-xs text-text-secondary", children: inc.description }), inc.affected_services.length > 0 && (_jsx("div", { className: "mt-2 flex flex-wrap gap-1", children: inc.affected_services.map((s) => (_jsx("span", { className: "rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-text-muted", children: s }, s))) }))] }, inc.id));
                }) })] }));
}
function severityChip(sev) {
    switch (sev) {
        case 'critical':
            return 'bg-danger/15 text-danger';
        case 'major':
            return 'bg-warn/15 text-warn';
        case 'minor':
        default:
            return 'bg-cyan/15 text-cyan';
    }
}
function secondsAgo(iso) {
    if (!iso)
        return null;
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts))
        return null;
    return Math.max(0, Math.round((Date.now() - ts) / 1000));
}
function pluralizeSeconds(n) {
    // Лёгкая ru-pluralization: 1 секунду, 2-4 секунды, 5+ секунд.
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11)
        return 'секунду';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14))
        return 'секунды';
    return 'секунд';
}
function MetricsCard({ uptime90d, incidentCount }) {
    const rows = [
        ['Аптайм 90d', uptime90d],
        ['Инцидентов', String(incidentCount)],
    ];
    return (_jsxs("div", { className: "flex-1 rounded-2xl bg-surface-2 p-6", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u041C\u0435\u0442\u0440\u0438\u043A\u0438 90 \u0434\u043D\u0435\u0439" }), _jsx("div", { className: "mt-4 flex flex-col gap-3", children: rows.map(([k, v]) => (_jsxs("div", { className: "flex items-center justify-between border-b border-border pb-2 last:border-0", children: [_jsx("span", { className: "text-sm text-text-secondary", children: k }), _jsx("span", { className: "font-mono text-sm font-semibold text-text-primary", children: v })] }, k))) })] }));
}
function SubscribeCard() {
    return (_jsxs("div", { className: "flex-1 rounded-2xl bg-surface-2 p-6", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u041F\u043E\u0434\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F \u043D\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F" }), _jsx("p", { className: "mt-1 text-xs text-text-secondary", children: "\u041F\u0438\u0441\u044C\u043C\u043E \u043F\u0440\u0438 \u043A\u0430\u0436\u0434\u043E\u043C \u0438\u043D\u0446\u0438\u0434\u0435\u043D\u0442\u0435 \u0438 \u0435\u0433\u043E resolve." }), _jsxs("div", { className: "mt-4 flex gap-2", children: [_jsx("input", { className: "flex-1 rounded-md border border-border bg-surface-1 px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted", placeholder: "you@example.com" }), _jsx(Button, { variant: "primary", size: "sm", children: "\u041F\u043E\u0434\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F" })] })] }));
}
export default function StatusPage() {
    const { data, isPending, error } = useStatusPageQuery();
    if (isPending) {
        return (_jsxs("div", { className: "min-h-screen bg-bg text-text-primary", children: [_jsx(TopBar, {}), _jsxs("div", { className: "mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-16", children: [_jsx("div", { className: "h-24 w-24 animate-pulse rounded-full bg-surface-2" }), _jsx("div", { className: "h-6 w-64 animate-pulse rounded bg-surface-2" }), _jsx("div", { className: "h-4 w-48 animate-pulse rounded bg-surface-2" }), _jsx("div", { className: "mt-6 h-64 w-full animate-pulse rounded-2xl bg-surface-2" })] })] }));
    }
    if (error || !data) {
        return (_jsxs("div", { className: "min-h-screen bg-bg text-text-primary", children: [_jsx(TopBar, {}), _jsxs("div", { className: "mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-16 text-center", children: [_jsx(AlertCircle, { className: "h-14 w-14 text-danger" }), _jsx("h1", { className: "font-display text-2xl font-extrabold text-text-primary", children: "\u0421\u0435\u0440\u0432\u0438\u0441 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D" }), _jsx("p", { className: "text-sm text-text-secondary", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0441\u0442\u0430\u0442\u0443\u0441\u0430. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u043F\u043E\u0437\u0436\u0435." })] })] }));
    }
    return (_jsxs("div", { className: "min-h-screen bg-bg text-text-primary", children: [_jsx(TopBar, {}), _jsx(Hero, { status: data.overall_status, uptime90d: data.uptime_90d, generatedAt: data.generated_at }), _jsxs("div", { className: "flex flex-col gap-5 px-4 pb-6 sm:px-8 lg:px-20 lg:pb-7", children: [_jsx(ServicesList, { services: data.services }), _jsx(IncidentsCard, { incidents: data.incidents }), _jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:gap-5", children: [_jsx(SubscribeCard, {}), _jsx(MetricsCard, { uptime90d: data.uptime_90d, incidentCount: data.incidents.length })] })] })] }));
}
