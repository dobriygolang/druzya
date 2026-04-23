import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TODO i18n
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShellV2 } from '../components/AppShell';
import { Avatar } from '../components/Avatar';
import { useArenaHistoryQuery } from '../lib/queries/matches';
// Filter dictionaries for the chip rows. Keep these in lock-step with
// shared/enums.* on the backend — the wire layer rejects unknown values.
const MODES = [
    { value: '', label: 'Все режимы' },
    { value: 'solo_1v1', label: '1v1' },
    { value: 'duo_2v2', label: '2v2' },
    { value: 'ranked', label: 'Ranked' },
    { value: 'hardcore', label: 'Hardcore' },
    { value: 'cursed', label: 'Cursed' },
];
const SECTIONS = [
    { value: '', label: 'Все секции' },
    { value: 'algorithms', label: 'Algorithms' },
    { value: 'sql', label: 'SQL' },
    { value: 'go', label: 'Go' },
    { value: 'system_design', label: 'System Design' },
    { value: 'behavioral', label: 'Behavioral' },
];
const PAGE_SIZES = [10, 20, 50];
function ErrorChip({ onRetry }) {
    return (_jsxs("div", { className: "flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger", children: [_jsx("span", { children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E." }), _jsx("button", { onClick: onRetry, className: "font-semibold underline hover:text-danger-hover", children: "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C" })] }));
}
function ResultPill({ result, lp }) {
    const map = {
        win: { bg: 'bg-success/15', text: 'text-success', label: 'WIN' },
        loss: { bg: 'bg-danger/15', text: 'text-danger', label: 'LOSS' },
        draw: { bg: 'bg-text-muted/15', text: 'text-text-muted', label: 'DRAW' },
        abandoned: { bg: 'bg-text-muted/15', text: 'text-text-muted', label: 'ABND' },
    };
    const style = map[result];
    const sign = lp > 0 ? '+' : '';
    return (_jsxs("div", { className: "flex flex-col items-end gap-1", children: [_jsx("span", { className: `rounded-md px-2 py-0.5 font-mono text-[10px] font-bold ${style.bg} ${style.text}`, children: style.label }), _jsxs("span", { className: `font-mono text-[11px] font-semibold ${style.text}`, children: [sign, lp, " LP"] })] }));
}
function ModeBadge({ mode }) {
    return (_jsx("span", { className: "rounded-full border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-text-secondary", children: mode || '—' }));
}
function formatDuration(sec) {
    if (!sec || sec <= 0)
        return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}
function formatTimeAgo(iso) {
    if (!iso)
        return '—';
    const ts = Date.parse(iso);
    if (Number.isNaN(ts))
        return '—';
    const diffMs = Date.now() - ts;
    const min = Math.floor(diffMs / 60_000);
    if (min < 1)
        return 'только что';
    if (min < 60)
        return `${min} мин назад`;
    const h = Math.floor(min / 60);
    if (h < 24)
        return `${h} ч назад`;
    const d = Math.floor(h / 24);
    if (d < 7)
        return `${d} д назад`;
    return new Date(ts).toLocaleDateString('ru-RU');
}
function HistoryRow({ entry, onClick }) {
    const initial = (entry.opponent_username || '?').charAt(0).toUpperCase();
    return (_jsxs("button", { onClick: onClick, className: "flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition hover:bg-surface-3/40 last:border-b-0", children: [_jsx("span", { className: `h-10 w-1 shrink-0 rounded-full ${entry.result === 'win' ? 'bg-success' : entry.result === 'loss' ? 'bg-danger' : 'bg-text-muted'}` }), _jsx(Avatar, { size: "md", gradient: entry.result === 'win' ? 'success-cyan' : 'pink-red', initials: initial, className: "!w-9 !h-9" }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col gap-1", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsxs("span", { className: "max-w-full truncate text-sm font-semibold text-text-primary", children: ["@", entry.opponent_username || 'unknown'] }), _jsx(ModeBadge, { mode: entry.mode }), _jsx("span", { className: "font-mono text-[10px] uppercase text-text-muted", children: entry.section })] }), _jsxs("div", { className: "flex items-center gap-3 font-mono text-[11px] text-text-muted", children: [_jsx("span", { children: formatTimeAgo(entry.finished_at) }), _jsx("span", { children: "\u2022" }), _jsx("span", { children: formatDuration(entry.duration_seconds) })] })] }), _jsx(ResultPill, { result: entry.result, lp: entry.lp_change })] }));
}
function SkeletonRow() {
    return (_jsxs("div", { className: "flex animate-pulse items-center gap-3 border-b border-border px-4 py-3 last:border-b-0", children: [_jsx("span", { className: "h-10 w-1 rounded-full bg-surface-3" }), _jsx("div", { className: "h-9 w-9 rounded-full bg-surface-3" }), _jsxs("div", { className: "flex flex-1 flex-col gap-2", children: [_jsx("div", { className: "h-3 w-32 rounded bg-surface-3" }), _jsx("div", { className: "h-2 w-20 rounded bg-surface-3" })] }), _jsx("div", { className: "h-8 w-12 rounded bg-surface-3" })] }));
}
function FilterChip({ active, onClick, children }) {
    return (_jsx("button", { onClick: onClick, className: active
            ? 'rounded-full border border-accent bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent-hover'
            : 'rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary', children: children }));
}
export default function MatchHistoryPage() {
    const navigate = useNavigate();
    const [mode, setMode] = useState('');
    const [section, setSection] = useState('');
    const [limit, setLimit] = useState(20);
    const [page, setPage] = useState(0);
    const offset = page * limit;
    const { data, isLoading, isError, refetch, isFetching } = useArenaHistoryQuery({ mode, section, limit, offset });
    const items = data?.items ?? [];
    const total = data?.total ?? 0;
    const totalPages = useMemo(() => (total > 0 ? Math.ceil(total / limit) : 0), [total, limit]);
    // Reset offset when filters change so the user doesn't end up on a page
    // that doesn't exist under the new filter.
    function applyFilter(setter) {
        return (v) => {
            setter(v);
            setPage(0);
        };
    }
    const wins = items.filter((i) => i.result === 'win').length;
    const losses = items.filter((i) => i.result === 'loss').length;
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8", children: [_jsxs("div", { className: "flex flex-col gap-3", children: [_jsx("h1", { className: "font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary", children: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043C\u0430\u0442\u0447\u0435\u0439" }), _jsxs("p", { className: "text-sm text-text-secondary", children: ["\u0412\u0441\u0435\u0433\u043E: ", _jsx("span", { className: "font-semibold text-text-primary", children: total }), items.length > 0 && (_jsxs("span", { children: [" \u00B7 \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435: ", wins, " \u043F\u043E\u0431\u0435\u0434 / ", losses, " \u043F\u043E\u0440\u0430\u0436\u0435\u043D\u0438\u0439"] }))] }), isError && _jsx(ErrorChip, { onRetry: () => refetch() })] }), _jsxs("div", { className: "flex flex-col gap-3 rounded-2xl border border-border bg-surface-2 p-4", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("span", { className: "font-mono text-[10px] uppercase text-text-muted", children: "Mode" }), MODES.map((m) => (_jsx(FilterChip, { active: mode === m.value, onClick: () => applyFilter(setMode)(m.value), children: m.label }, m.value || 'all')))] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("span", { className: "font-mono text-[10px] uppercase text-text-muted", children: "Section" }), SECTIONS.map((s) => (_jsx(FilterChip, { active: section === s.value, onClick: () => applyFilter(setSection)(s.value), children: s.label }, s.value || 'all')))] })] }), _jsxs("div", { className: "flex flex-col overflow-hidden rounded-2xl border border-border bg-surface-2", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border px-4 py-3", children: [_jsx("span", { className: "font-display text-sm font-bold text-text-primary", children: "\u041C\u0430\u0442\u0447\u0438" }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: isFetching ? 'обновление…' : `страница ${totalPages === 0 ? 0 : page + 1} из ${totalPages || 1}` })] }), isLoading ? (_jsx("div", { className: "flex flex-col", children: Array.from({ length: 6 }).map((_, i) => _jsx(SkeletonRow, {}, i)) })) : items.length === 0 ? (_jsxs("div", { className: "flex flex-col items-center gap-3 px-4 py-12 text-center", children: [_jsx("p", { className: "text-sm text-text-secondary", children: "\u0415\u0449\u0451 \u043D\u0435 \u0431\u044B\u043B\u043E \u043C\u0430\u0442\u0447\u0435\u0439 \u043F\u043E\u0434 \u044D\u0442\u0438\u043C \u0444\u0438\u043B\u044C\u0442\u0440\u043E\u043C." }), _jsx("button", { onClick: () => navigate('/arena'), className: "rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover", children: "\u0412 \u0430\u0440\u0435\u043D\u0443" })] })) : (_jsx("div", { className: "flex flex-col", children: items.map((entry) => (_jsx(HistoryRow, { entry: entry, onClick: () => navigate(`/arena/match/${entry.match_id}`) }, entry.match_id))) })), _jsxs("div", { className: "flex items-center justify-between gap-3 border-t border-border px-4 py-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "font-mono text-[10px] uppercase text-text-muted", children: "\u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435" }), PAGE_SIZES.map((sz) => (_jsx(FilterChip, { active: limit === sz, onClick: () => { setLimit(sz); setPage(0); }, children: sz }, sz)))] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: () => setPage((p) => Math.max(0, p - 1)), disabled: page === 0 || isFetching, className: "rounded-md border border-border bg-surface-1 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-40", children: "\u2190 \u041D\u0430\u0437\u0430\u0434" }), _jsx("button", { onClick: () => setPage((p) => p + 1), disabled: (page + 1) * limit >= total || isFetching, className: "rounded-md border border-border bg-surface-1 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary disabled:opacity-40", children: "\u0412\u043F\u0435\u0440\u0451\u0434 \u2192" })] })] })] })] }) }));
}
