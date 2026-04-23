import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// AdminPage — operator console.
//
// Replaces the apigen-era hard-coded counters / task table with live data
// from the backend admin module:
//   - useAdminDashboardQuery — live counters (60s Redis cache server-side).
//   - useAdminUsersQuery     — paged user listing with active-ban metadata.
//   - useAdminReportsQuery   — moderation queue.
//
// Auth gate: useProfileQuery resolves the current viewer; users without
// role='admin' are redirected to /sanctum. The backend enforces the same
// gate, this is purely UX so non-admins don't see a blank 403 shell.
// TODO i18n
import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Search, ShieldOff, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
import { useProfileQuery } from '../lib/queries/profile';
import { useAdminDashboardQuery, useAdminUsersQuery, useAdminReportsQuery, useBanUserMutation, useUnbanUserMutation, } from '../lib/queries/admin';
function Sidebar({ tab, setTab, pendingReports }) {
    const items = [
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'users', label: 'Users' },
        {
            id: 'reports',
            label: 'Reports',
            chip: pendingReports > 0 ? String(pendingReports) : undefined,
            chipColor: 'bg-danger/20 text-danger',
        },
    ];
    return (_jsxs("aside", { className: "flex w-full flex-col border-b border-border bg-surface-1 lg:w-60 lg:border-b-0 lg:border-r", children: [_jsxs("div", { className: "flex items-center gap-2.5 border-b border-border px-5 py-4", children: [_jsx("span", { className: "grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-sm font-extrabold text-text-primary", children: "9" }), _jsx("span", { className: "font-display text-sm font-bold text-text-primary", children: "druz9 ADMIN" }), _jsx("span", { className: "ml-auto rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[9px] text-text-muted", children: "v3.2" })] }), _jsxs("nav", { className: "flex flex-1 flex-row gap-2 overflow-x-auto px-3 py-4 lg:flex-col lg:gap-1", children: [items.map((it) => (_jsxs("button", { onClick: () => setTab(it.id), className: `flex items-center justify-between rounded-md px-3 py-1.5 text-[13px] ${it.id === tab
                            ? 'border-l-2 border-accent bg-accent/10 text-text-primary'
                            : 'text-text-secondary hover:bg-surface-2'}`, children: [_jsx("span", { children: it.label }), it.chip && (_jsx("span", { className: `rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold ${it.chipColor ?? 'bg-surface-3 text-text-secondary'}`, children: it.chip }))] }, it.id))), _jsxs(Link, { to: "/status", className: "mt-1 flex items-center justify-between rounded-md px-3 py-1.5 text-[13px] text-text-secondary hover:bg-surface-2", children: [_jsx("span", { children: "Public status" }), _jsx("span", { className: "font-mono text-[9px] text-text-muted", children: "\u2197" })] })] }), _jsxs("div", { className: "flex items-center gap-2.5 border-t border-border px-4 py-3", children: [_jsx(Avatar, { size: "sm", gradient: "pink-violet", initials: "A" }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx("span", { className: "text-[12px] font-semibold text-text-primary", children: "admin" }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: "root" })] })] })] }));
}
function StatCard({ label, value, color }) {
    return (_jsxs("div", { className: "flex flex-col rounded-lg border border-border bg-surface-1 px-4 py-2", children: [_jsx("span", { className: "font-mono text-[10px] font-semibold tracking-[0.08em] text-text-muted", children: label }), _jsx("span", { className: `font-display text-xl font-extrabold ${color ?? 'text-text-primary'}`, children: value })] }));
}
function DashboardPanel() {
    const { data, isPending, error } = useAdminDashboardQuery();
    if (isPending) {
        return _jsx(PanelSkeleton, { rows: 4 });
    }
    if (error || !data) {
        return _jsx(ErrorBox, { message: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0443" });
    }
    return (_jsxs("div", { className: "flex flex-col gap-5 px-4 py-5 sm:px-7", children: [_jsxs("section", { children: [_jsx("h2", { className: "mb-2 font-display text-sm font-bold text-text-secondary", children: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0438" }), _jsxs("div", { className: "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5", children: [_jsx(StatCard, { label: "\u0412\u0441\u0435\u0433\u043E", value: fmt(data.users_total) }), _jsx(StatCard, { label: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0441\u0435\u0433\u043E\u0434\u043D\u044F", value: fmt(data.users_active_today), color: "text-success" }), _jsx(StatCard, { label: "\u0417\u0430 \u043D\u0435\u0434\u0435\u043B\u044E", value: fmt(data.users_active_week) }), _jsx(StatCard, { label: "\u0417\u0430 \u043C\u0435\u0441\u044F\u0446", value: fmt(data.users_active_month) }), _jsx(StatCard, { label: "\u0417\u0430\u0431\u0430\u043D\u0435\u043D\u043E", value: fmt(data.users_banned), color: data.users_banned > 0 ? 'text-danger' : 'text-text-muted' })] })] }), _jsxs("section", { children: [_jsx("h2", { className: "mb-2 font-display text-sm font-bold text-text-secondary", children: "\u0410\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u044C" }), _jsxs("div", { className: "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4", children: [_jsx(StatCard, { label: "\u041C\u0430\u0442\u0447\u0435\u0439 \u0441\u0435\u0433\u043E\u0434\u043D\u044F", value: fmt(data.matches_today) }), _jsx(StatCard, { label: "\u041C\u0430\u0442\u0447\u0435\u0439 \u0437\u0430 \u043D\u0435\u0434\u0435\u043B\u044E", value: fmt(data.matches_week) }), _jsx(StatCard, { label: "Kata \u0441\u0435\u0433\u043E\u0434\u043D\u044F", value: fmt(data.katas_today) }), _jsx(StatCard, { label: "Kata \u0437\u0430 \u043D\u0435\u0434\u0435\u043B\u044E", value: fmt(data.katas_week) })] })] }), _jsxs("section", { children: [_jsx("h2", { className: "mb-2 font-display text-sm font-bold text-text-secondary", children: "\u0421\u0435\u0439\u0447\u0430\u0441 \u0438\u0434\u0443\u0442" }), _jsxs("div", { className: "grid grid-cols-2 gap-3 lg:grid-cols-3", children: [_jsx(StatCard, { label: "Mock-\u0441\u0435\u0441\u0441\u0438\u0439", value: fmt(data.active_mock_sessions), color: "text-cyan" }), _jsx(StatCard, { label: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u043C\u0430\u0442\u0447\u0435\u0439", value: fmt(data.active_arena_matches), color: "text-cyan" }), _jsx(StatCard, { label: "Anti-cheat \u0441\u0438\u0433\u043D\u0430\u043B\u043E\u0432 24\u0447", value: fmt(data.anticheat_signals_24h), color: data.anticheat_signals_24h > 0 ? 'text-warn' : 'text-text-muted' })] })] }), _jsxs("section", { children: [_jsx("h2", { className: "mb-2 font-display text-sm font-bold text-text-secondary", children: "\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u043C\u043E\u0434\u0435\u0440\u0430\u0446\u0438\u0438" }), _jsx("div", { className: "grid grid-cols-1 gap-3 lg:grid-cols-2", children: _jsx(StatCard, { label: "\u0416\u0430\u043B\u043E\u0431 \u043D\u0430 \u0440\u0430\u0441\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u0438\u0438", value: fmt(data.reports_pending), color: data.reports_pending > 0 ? 'text-warn' : 'text-text-muted' }) })] }), _jsxs("p", { className: "mt-1 font-mono text-[10px] text-text-muted", children: ["\u0421\u043D\u0438\u043C\u043E\u043A \u043E\u0442 ", new Date(data.generated_at).toLocaleString('ru-RU')] })] }));
}
function UsersPanel() {
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('');
    const [page, setPage] = useState(1);
    const params = useMemo(() => ({ query, status, page, limit: 25 }), [query, status, page]);
    const { data, isPending, error } = useAdminUsersQuery(params);
    const banMut = useBanUserMutation();
    const unbanMut = useUnbanUserMutation();
    return (_jsxs("div", { className: "flex flex-col gap-3 px-4 py-5 sm:px-7", children: [_jsxs("div", { className: "flex flex-col gap-2 sm:flex-row sm:items-center", children: [_jsxs("div", { className: "flex h-9 flex-1 items-center gap-2 rounded-md border border-border bg-surface-1 px-3", children: [_jsx(Search, { className: "h-3.5 w-3.5 text-text-muted" }), _jsx("input", { value: query, onChange: (e) => {
                                    setQuery(e.target.value);
                                    setPage(1);
                                }, placeholder: "\u041F\u043E\u0438\u0441\u043A \u043F\u043E username / email", className: "flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none" })] }), _jsxs("select", { value: status, onChange: (e) => {
                            setStatus(e.target.value);
                            setPage(1);
                        }, className: "h-9 rounded-md border border-border bg-surface-1 px-3 text-sm text-text-primary", children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435" }), _jsx("option", { value: "active", children: "\u0422\u043E\u043B\u044C\u043A\u043E \u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0435" }), _jsx("option", { value: "banned", children: "\u0422\u043E\u043B\u044C\u043A\u043E \u0437\u0430\u0431\u0430\u043D\u0435\u043D\u043D\u044B\u0435" })] })] }), isPending && _jsx(PanelSkeleton, { rows: 6 }), error && _jsx(ErrorBox, { message: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u0435\u0439" }), data && (_jsxs(_Fragment, { children: [_jsx("div", { className: "overflow-x-auto rounded-lg border border-border", children: _jsxs("table", { className: "w-full min-w-[760px]", children: [_jsx("thead", { className: "bg-surface-1", children: _jsxs("tr", { className: "text-left font-mono text-[10px] font-semibold tracking-[0.08em] text-text-muted", children: [_jsx("th", { className: "px-3 py-2.5", children: "USERNAME" }), _jsx("th", { className: "px-3 py-2.5", children: "EMAIL" }), _jsx("th", { className: "px-3 py-2.5", children: "ROLE" }), _jsx("th", { className: "px-3 py-2.5", children: "STATUS" }), _jsx("th", { className: "px-3 py-2.5", children: "CREATED" }), _jsx("th", { className: "px-3 py-2.5 text-right", children: "ACTIONS" })] }) }), _jsxs("tbody", { children: [data.items.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 6, className: "px-3 py-6 text-center font-mono text-[12px] text-text-muted", children: "\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E" }) })), data.items.map((u) => (_jsx(UserRow, { user: u, onBan: (reason) => banMut.mutate({ user_id: u.id, reason }), onUnban: () => unbanMut.mutate(u.id), busy: banMut.isPending || unbanMut.isPending }, u.id)))] })] }) }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("span", { className: "font-mono text-[11px] text-text-muted", children: ["\u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 ", data.page, " \u00B7 \u0432\u0441\u0435\u0433\u043E ", data.total] }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { variant: "ghost", size: "sm", disabled: page <= 1, onClick: () => setPage((p) => Math.max(1, p - 1)), children: "\u2190 \u041D\u0430\u0437\u0430\u0434" }), _jsx(Button, { variant: "ghost", size: "sm", disabled: data.items.length < 25, onClick: () => setPage((p) => p + 1), children: "\u0412\u043F\u0435\u0440\u0451\u0434 \u2192" })] })] })] }))] }));
}
function UserRow({ user, onBan, onUnban, busy, }) {
    return (_jsxs("tr", { className: "border-t border-border bg-bg hover:bg-surface-1", children: [_jsx("td", { className: "px-3 py-3", children: _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "text-[13px] font-semibold text-text-primary", children: user.username }), user.display_name && (_jsx("span", { className: "font-mono text-[10px] text-text-muted", children: user.display_name }))] }) }), _jsx("td", { className: "px-3 py-3 font-mono text-[12px] text-text-secondary", children: user.email || '—' }), _jsx("td", { className: "px-3 py-3", children: _jsx("span", { className: "rounded-full bg-cyan/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan", children: user.role }) }), _jsx("td", { className: "px-3 py-3", children: user.is_banned ? (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: "BANNED" })) : (_jsx("span", { className: "rounded-full bg-success/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-success", children: "ACTIVE" })) }), _jsx("td", { className: "px-3 py-3 font-mono text-[11px] text-text-muted", children: new Date(user.created_at).toLocaleDateString('ru-RU') }), _jsx("td", { className: "px-3 py-3 text-right", children: user.is_banned ? (_jsx(Button, { variant: "ghost", size: "sm", disabled: busy, onClick: onUnban, icon: _jsx(ShieldCheck, { className: "h-3.5 w-3.5" }), children: "\u0420\u0430\u0437\u0431\u0430\u043D\u0438\u0442\u044C" })) : (_jsx(Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => {
                        const reason = window.prompt('Причина бана?');
                        if (reason && reason.trim())
                            onBan(reason.trim());
                    }, icon: _jsx(ShieldOff, { className: "h-3.5 w-3.5" }), children: "\u0417\u0430\u0431\u0430\u043D\u0438\u0442\u044C" })) })] }));
}
function ReportsPanel() {
    const [status, setStatus] = useState('');
    const { data, isPending, error } = useAdminReportsQuery(status);
    return (_jsxs("div", { className: "flex flex-col gap-3 px-4 py-5 sm:px-7", children: [_jsx("div", { className: "flex items-center gap-2", children: _jsxs("select", { value: status, onChange: (e) => setStatus(e.target.value), className: "h-9 rounded-md border border-border bg-surface-1 px-3 text-sm text-text-primary", children: [_jsx("option", { value: "", children: "Pending" }), _jsx("option", { value: "resolved", children: "Resolved" }), _jsx("option", { value: "dismissed", children: "Dismissed" }), _jsx("option", { value: "all", children: "All" })] }) }), isPending && _jsx(PanelSkeleton, { rows: 3 }), error && _jsx(ErrorBox, { message: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0436\u0430\u043B\u043E\u0431\u044B" }), data && data.items.length === 0 && (_jsx("div", { className: "rounded-lg border border-dashed border-border bg-surface-1 px-4 py-10 text-center font-mono text-[12px] text-text-muted", children: "\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u043F\u0443\u0441\u0442\u0430" })), data && data.items.length > 0 && (_jsx("div", { className: "flex flex-col gap-3", children: data.items.map((r) => (_jsxs("div", { className: "rounded-lg border border-border bg-surface-1 p-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(AlertTriangle, { className: "h-4 w-4 text-warn" }), _jsx("span", { className: "font-display text-sm font-bold text-text-primary", children: r.reason })] }), _jsx("span", { className: `rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${r.status === 'pending'
                                        ? 'bg-warn/15 text-warn'
                                        : r.status === 'resolved'
                                            ? 'bg-success/15 text-success'
                                            : 'bg-surface-3 text-text-muted'}`, children: r.status.toUpperCase() })] }), _jsx("p", { className: "mt-2 text-xs text-text-secondary", children: r.description || 'Без комментария.' }), _jsxs("div", { className: "mt-2 flex items-center justify-between font-mono text-[11px] text-text-muted", children: [_jsxs("span", { children: [r.reporter_name || r.reporter_id.slice(0, 8), " \u2192 ", r.reported_name || r.reported_id.slice(0, 8)] }), _jsx("span", { children: new Date(r.created_at).toLocaleString('ru-RU') })] })] }, r.id))) }))] }));
}
function PanelSkeleton({ rows }) {
    return (_jsx("div", { className: "flex flex-col gap-3 px-4 py-5 sm:px-7", children: Array.from({ length: rows }).map((_, i) => (_jsx("div", { className: "h-12 animate-pulse rounded-lg bg-surface-1" }, i))) }));
}
function ErrorBox({ message }) {
    return (_jsx("div", { className: "mx-4 my-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger sm:mx-7", children: message }));
}
function fmt(n) {
    return new Intl.NumberFormat('ru-RU').format(n);
}
export default function AdminPage() {
    const profile = useProfileQuery();
    const dashboard = useAdminDashboardQuery();
    const [tab, setTab] = useState('dashboard');
    // Auth gate — the backend returns 403 for non-admins; we mirror the
    // outcome here so a non-admin user lands on /sanctum instead of an empty
    // shell. /profile/me must return successfully (a logged-in user); if
    // it 401s the apiClient already redirects to /welcome.
    if (profile.isPending) {
        return (_jsx("div", { className: "flex min-h-screen items-center justify-center bg-bg text-text-muted", children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430\u2026" }));
    }
    // Surface server-side admin gate failure as a redirect. The dashboard
    // hook is the canonical "am I admin?" probe — if the role check fails,
    // the apiClient throws ApiError with status 403.
    const dashErrStatus = dashboard.error?.status;
    if (dashErrStatus === 403) {
        return _jsx(Navigate, { to: "/sanctum", replace: true });
    }
    const pending = dashboard.data?.reports_pending ?? 0;
    // profile is referenced solely to ensure the bearer is valid before we
    // try to render the admin shell — its body isn't read.
    void profile;
    return (_jsxs("div", { className: "flex min-h-screen flex-col bg-bg text-text-primary lg:flex-row", children: [_jsx(Sidebar, { tab: tab, setTab: setTab, pendingReports: pending }), _jsxs("main", { className: "flex flex-1 flex-col", children: [_jsx("div", { className: "flex h-auto flex-col gap-1 border-b border-border bg-bg px-4 py-3 sm:px-7 lg:h-14 lg:flex-row lg:items-center lg:justify-between lg:py-0", children: _jsxs("div", { children: [_jsx("h1", { className: "font-display text-lg font-bold text-text-primary", children: tab === 'dashboard' ? 'Dashboard' : tab === 'users' ? 'Users' : 'Reports' }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: "\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u043E\u043D\u043D\u0430\u044F \u043F\u0430\u043D\u0435\u043B\u044C druz9" })] }) }), tab === 'dashboard' && _jsx(DashboardPanel, {}), tab === 'users' && _jsx(UsersPanel, {}), tab === 'reports' && _jsx(ReportsPanel, {})] })] }));
}
