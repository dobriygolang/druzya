import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// /rating — Phase 2 leaderboard page.
//
// Reads:
//   - useMyRatingsQuery → /api/v1/rating/me  (rank/lp/league for current user)
//   - useLeaderboardQuery({section, mode}) → /api/v1/rating/leaderboard
//
// Filter chips drive URL search params (`?section=...&mode=...`) so the
// view is shareable and back-button friendly. Loading/empty/error states
// mirror the bible's defaults — skeleton table, friendly empty text, and
// a retry-on-error chip.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Trophy, RefreshCw } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { cn } from '../lib/cn';
import { useLeaderboardQuery, useMyRatingsQuery, } from '../lib/queries/rating';
const SECTIONS = [
    { key: 'algorithms', label: 'Алгоритмы' },
    { key: 'sql', label: 'SQL' },
    { key: 'go', label: 'Go' },
    { key: 'system_design', label: 'System Design' },
    { key: 'behavioral', label: 'Behavioral' },
];
const MODES = [
    { key: 'all', label: 'Все' },
    { key: 'solo_1v1', label: 'Solo 1v1' },
    { key: 'ranked', label: 'Ranked' },
    { key: 'hardcore', label: 'Hardcore' },
    { key: 'cursed', label: 'Cursed' },
];
function deriveLeague(elo) {
    if (elo >= 2200)
        return 'Master';
    if (elo >= 1900)
        return 'Diamond';
    if (elo >= 1600)
        return 'Platinum';
    if (elo >= 1300)
        return 'Gold';
    if (elo >= 1000)
        return 'Silver';
    return 'Bronze';
}
function Chip({ active, onClick, children, }) {
    return (_jsx("button", { type: "button", onClick: onClick, className: cn('rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors', active
            ? 'border-accent bg-accent/20 text-text-primary shadow-glow'
            : 'border-border bg-surface-2 text-text-muted hover:border-border-strong hover:text-text-secondary'), children: children }));
}
function MeHeader({ section }) {
    const meQ = useMyRatingsQuery();
    const me = meQ.data;
    const sectionRating = me?.ratings.find((r) => r.section === section);
    const elo = sectionRating?.elo ?? 0;
    const matches = sectionRating?.matches_count ?? 0;
    const decaying = sectionRating?.decaying ?? false;
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("span", { className: "font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted", children: "\u0422\u0432\u043E\u0439 \u0440\u0435\u0439\u0442\u0438\u043D\u0433" }), _jsx("h2", { className: "font-display text-2xl font-bold text-text-primary", children: meQ.isLoading ? '—' : `${elo} LP` })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "rounded-full bg-warn/15 px-3 py-1 font-mono text-[11px] font-bold uppercase text-warn", children: deriveLeague(elo) }), decaying && (_jsx("span", { className: "rounded-full bg-danger/15 px-3 py-1 font-mono text-[11px] font-bold uppercase text-danger", children: "decaying" }))] })] }), _jsxs("div", { className: "flex flex-wrap gap-4 text-[12px] text-text-muted", children: [_jsxs("span", { children: ["\u041C\u0430\u0442\u0447\u0435\u0439: ", _jsx("strong", { className: "text-text-secondary", children: matches })] }), _jsxs("span", { children: ["Global Score:", ' ', _jsx("strong", { className: "text-text-secondary", children: meQ.isLoading ? '—' : me?.global_power_score ?? 0 })] })] })] }));
}
function SkeletonRow({ i }) {
    return (_jsxs("tr", { className: "border-b border-border", children: [_jsx("td", { className: "px-3 py-3", children: _jsx("div", { className: "h-4 w-6 animate-pulse rounded bg-surface-2" }) }), _jsx("td", { className: "px-3 py-3", children: _jsx("div", { className: "h-4 w-32 animate-pulse rounded bg-surface-2" }) }), _jsx("td", { className: "px-3 py-3", children: _jsx("div", { className: "h-4 w-12 animate-pulse rounded bg-surface-2" }) }), _jsx("td", { className: "px-3 py-3", children: _jsx("div", { className: "h-4 w-16 animate-pulse rounded bg-surface-2" }) }), _jsx("td", { className: "hidden px-3 py-3 sm:table-cell", children: _jsx("div", { className: "h-4 w-12 animate-pulse rounded bg-surface-2" }) }), _jsx("td", { className: "hidden", children: i })] }));
}
function LeaderboardTable({ section, mode, }) {
    const lbQ = useLeaderboardQuery({ section, mode, limit: 100 });
    if (lbQ.isError) {
        return (_jsxs(Card, { className: "flex-col items-center gap-3 p-8 text-center", interactive: false, children: [_jsx("span", { className: "text-[14px] text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0440\u0435\u0439\u0442\u0438\u043D\u0433." }), _jsx(Button, { variant: "ghost", size: "sm", icon: _jsx(RefreshCw, { className: "h-3.5 w-3.5" }), onClick: () => lbQ.refetch(), children: "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C" })] }));
    }
    const entries = lbQ.data?.entries ?? [];
    if (!lbQ.isLoading && entries.length === 0) {
        return (_jsxs(Card, { className: "flex-col items-center gap-2 p-10 text-center", interactive: false, children: [_jsx(Trophy, { className: "h-10 w-10 text-text-muted" }), _jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: "\u0421\u0435\u0437\u043E\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u043D\u0430\u0447\u0430\u043B\u0441\u044F" }), _jsx("p", { className: "max-w-[420px] text-[13px] text-text-muted", children: "\u0420\u0435\u0439\u0442\u0438\u043D\u0433 \u043A\u043E\u043F\u0438\u0442\u0441\u044F \u2014 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0439\u0441\u044F \u0447\u0435\u0440\u0435\u0437 \u0447\u0430\u0441, \u0438\u043B\u0438 \u0441\u044B\u0433\u0440\u0430\u0439 \u043C\u0430\u0442\u0447 \u0441\u0430\u043C, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u043F\u0430\u0441\u0442\u044C \u0432 \u0442\u0430\u0431\u043B\u0438\u0446\u0443 \u043F\u0435\u0440\u0432\u044B\u043C." })] }));
    }
    return (_jsx(Card, { className: "flex-col gap-0 overflow-hidden p-0", interactive: false, children: _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-left text-[13px]", children: [_jsx("thead", { className: "border-b border-border bg-surface-2 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted", children: _jsxs("tr", { children: [_jsx("th", { className: "px-3 py-3", children: "#" }), _jsx("th", { className: "px-3 py-3", children: "\u0418\u0433\u0440\u043E\u043A" }), _jsx("th", { className: "px-3 py-3", children: "LP" }), _jsx("th", { className: "px-3 py-3", children: "\u041B\u0438\u0433\u0430" }), _jsx("th", { className: "hidden px-3 py-3 sm:table-cell", children: "\u0422\u0438\u0442\u0443\u043B" })] }) }), _jsx("tbody", { children: lbQ.isLoading
                            ? Array.from({ length: 10 }).map((_, i) => _jsx(SkeletonRow, { i: i }, i))
                            : entries.map((e) => (_jsxs("tr", { className: "border-b border-border last:border-b-0 hover:bg-surface-2/40", children: [_jsx("td", { className: "px-3 py-3 font-mono text-[12px] font-bold text-text-secondary", children: e.rank }), _jsx("td", { className: "px-3 py-3 font-semibold text-text-primary", children: e.username }), _jsx("td", { className: "px-3 py-3 font-mono text-text-primary", children: e.elo }), _jsx("td", { className: "px-3 py-3", children: _jsx("span", { className: "rounded-full bg-warn/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-warn", children: deriveLeague(e.elo) }) }), _jsx("td", { className: "hidden px-3 py-3 text-[12px] text-text-muted sm:table-cell", children: e.title || '—' })] }, e.user_id))) })] }) }) }));
}
export default function RatingPage() {
    const [params, setParams] = useSearchParams();
    const section = useMemo(() => {
        const s = params.get('section');
        return s && SECTIONS.some((x) => x.key === s) ? s : 'algorithms';
    }, [params]);
    const mode = useMemo(() => {
        const m = params.get('mode');
        return m && MODES.some((x) => x.key === m) ? m : 'all';
    }, [params]);
    const setFilter = (key, value) => {
        const next = new URLSearchParams(params);
        next.set(key, value);
        setParams(next, { replace: false });
    };
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-10 lg:py-8", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Trophy, { className: "h-6 w-6 text-warn" }), _jsx("h1", { className: "font-display text-2xl font-extrabold text-text-primary sm:text-3xl", children: "\u0420\u0435\u0439\u0442\u0438\u043D\u0433" })] }), _jsx(MeHeader, { section: section }), _jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("span", { className: "font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted", children: "\u0421\u0435\u043A\u0446\u0438\u044F" }), _jsx("div", { className: "flex flex-wrap gap-2", children: SECTIONS.map((s) => (_jsx(Chip, { active: section === s.key, onClick: () => setFilter('section', s.key), children: s.label }, s.key))) })] }), _jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("span", { className: "font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted", children: "\u0420\u0435\u0436\u0438\u043C" }), _jsx("div", { className: "flex flex-wrap gap-2", children: MODES.map((m) => (_jsx(Chip, { active: mode === m.key, onClick: () => setFilter('mode', m.key), children: m.label }, m.key))) })] })] }), _jsx(LeaderboardTable, { section: section, mode: mode })] }) }));
}
