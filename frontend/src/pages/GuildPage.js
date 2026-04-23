import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// /guild — Phase 4-B guild page.
//
// Three layout modes driven by the route + query state:
//
//   1. /guild and the user IS in a guild  → detail view of MY guild
//   2. /guild and the user is NOT in any  → top-guilds leaderboard
//   3. /guild/:guildId                    → public detail of THAT guild
//
// Reads:
//   - useMyGuildQuery()    /api/v1/guild/my   (returns null on 404)
//   - useGuildQuery(id)    /api/v1/guild/{id}
//   - useGuildWarQuery(id) /api/v1/guild/{id}/war
//   - useTopGuildsQuery(n) /api/v1/guilds/top?limit=n
//
// Loading/empty/error states mirror the bible defaults — skeleton sections,
// friendly empty copy, and a retry button on hard errors.
// TODO i18n
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Shield, Trophy, Users, Crown, RefreshCw, ArrowRight } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { useMyGuildQuery, useGuildQuery, useGuildWarQuery, useTopGuildsQuery, } from '../lib/queries/guild';
// ── helpers ───────────────────────────────────────────────────────────────
function tierFor(elo) {
    if (elo >= 2200)
        return 'Master';
    if (elo >= 1900)
        return 'Diamond';
    if (elo >= 1600)
        return 'Platinum';
    if (elo >= 1300)
        return 'Gold';
    return 'Silver';
}
function roleLabel(role) {
    if (role === 'captain')
        return 'Лидер';
    if (role === 'officer')
        return 'Офицер';
    return 'Игрок';
}
function roleChip(role) {
    if (role === 'captain')
        return 'bg-warn/15 text-warn';
    if (role === 'officer')
        return 'bg-cyan/15 text-cyan';
    return 'bg-border-strong text-text-muted';
}
// ── shared sub-views ──────────────────────────────────────────────────────
function GuildBanner({ guild, rank }) {
    return (_jsx("div", { className: "flex h-auto flex-col items-start justify-between gap-4 px-4 py-6 sm:px-8 lg:h-[200px] lg:flex-row lg:items-center lg:gap-0 lg:px-20 lg:py-0", style: { background: 'linear-gradient(135deg, #2D1B4D 0%, #582CFF 100%)' }, children: _jsxs("div", { className: "flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6", children: [_jsx("div", { className: "grid h-24 w-24 place-items-center", style: {
                        borderRadius: 18,
                        background: 'linear-gradient(135deg, #22D3EE 0%, #582CFF 100%)',
                    }, children: _jsx(Shield, { className: "h-12 w-12 text-text-primary" }) }), _jsxs("div", { className: "flex flex-col gap-1.5", children: [rank ? (_jsxs("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn", children: [tierFor(guild.guild_elo).toUpperCase(), " TIER \u00B7 #", rank, " GLOBAL"] })) : null, _jsx("h1", { className: "font-display text-3xl font-extrabold leading-[1.05] text-text-primary sm:text-4xl lg:text-[36px]", children: guild.name }), _jsxs("p", { className: "text-sm text-text-secondary", children: [(guild.members?.length ?? 0), " \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432 \u00B7 guild ELO ", guild.guild_elo] }), _jsxs("div", { className: "mt-2 flex gap-6", children: [_jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-display text-lg font-bold text-text-primary", children: guild.guild_elo }), _jsx("span", { className: "text-[11px] text-text-muted", children: "guild ELO" })] }), _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-display text-lg font-bold text-cyan", children: guild.members?.length ?? 0 }), _jsx("span", { className: "text-[11px] text-text-muted", children: "\u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432" })] }), _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-display text-lg font-bold text-warn", children: guild.current_war_id ? '1' : '0' }), _jsx("span", { className: "text-[11px] text-text-muted", children: "\u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0432\u043E\u0439\u043D" })] })] })] })] }) }));
}
function MembersList({ members }) {
    if (!members || members.length === 0) {
        return (_jsxs(Card, { className: "flex-col gap-2 p-5", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438" }), _jsx("p", { className: "text-sm text-text-secondary", children: "\u041F\u043E\u043A\u0430 \u043D\u0438\u043A\u043E\u0433\u043E \u043D\u0435\u0442." })] }));
    }
    return (_jsxs(Card, { className: "flex-1 flex-col p-0", children: [_jsx("div", { className: "flex items-center justify-between border-b border-border p-5", children: _jsxs("h3", { className: "font-display text-base font-bold text-text-primary", children: ["\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438 (", members.length, ")"] }) }), _jsxs("div", { className: "hidden grid-cols-[2fr_1fr_1fr_40px] gap-4 border-b border-border px-5 py-3 font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted lg:grid", children: [_jsx("span", { children: "\u0418\u0413\u0420\u041E\u041A" }), _jsx("span", { children: "\u0420\u041E\u041B\u042C" }), _jsx("span", { children: "\u0421\u0415\u041A\u0426\u0418\u042F" }), _jsx("span", {})] }), members.map((m) => (_jsxs("div", { className: "flex flex-col gap-3 border-b border-border px-5 py-3 lg:grid lg:grid-cols-[2fr_1fr_1fr_40px] lg:items-center lg:gap-4", children: [_jsxs("div", { className: "flex min-w-0 items-center gap-3", children: [_jsx(Avatar, { size: "md", gradient: "violet-cyan", initials: m.username[0]?.toUpperCase() }), _jsxs("div", { className: "flex min-w-0 flex-col", children: [_jsxs("span", { className: "truncate text-sm font-semibold text-text-primary", children: ["@", m.username] }), _jsxs("span", { className: "truncate font-mono text-[11px] text-text-muted", children: [m.role === 'captain' ? _jsx(Crown, { className: "inline h-3 w-3 text-warn" }) : null, ' ', "\u0441", ' ', m.joined_at
                                                ? new Date(m.joined_at).toLocaleDateString('ru-RU', {
                                                    day: '2-digit',
                                                    month: 'short',
                                                    year: 'numeric',
                                                })
                                                : '—'] })] })] }), _jsx("div", { children: _jsx("span", { className: `inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${roleChip(m.role)}`, children: roleLabel(m.role) }) }), _jsx("span", { className: "text-sm text-text-secondary", children: m.assigned_section ? m.assigned_section : '—' }), _jsx("span", {})] }, m.user_id)))] }));
}
function WarPanel({ guildId }) {
    const { data: war, isLoading } = useGuildWarQuery(guildId);
    if (isLoading) {
        return (_jsxs(Card, { className: "flex-col gap-3 p-5", children: [_jsx("div", { className: "h-4 w-1/3 animate-pulse rounded bg-surface-3" }), _jsx("div", { className: "h-2 w-full animate-pulse rounded-full bg-surface-3" })] }));
    }
    if (!war) {
        return (_jsxs(Card, { className: "flex-col gap-2 p-5", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0412\u043E\u0439\u043D\u0430 \u043D\u0435\u0434\u0435\u043B\u0438" }), _jsx("p", { className: "text-sm text-text-secondary", children: "\u0410\u043A\u0442\u0438\u0432\u043D\u043E\u0439 \u0432\u043E\u0439\u043D\u044B \u043D\u0435\u0442." })] }));
    }
    const scoreA = war.lines?.reduce((acc, l) => acc + l.score_a, 0) ?? 0;
    const scoreB = war.lines?.reduce((acc, l) => acc + l.score_b, 0) ?? 0;
    const total = scoreA + scoreB;
    const pctA = total > 0 ? Math.round((scoreA / total) * 100) : 50;
    return (_jsxs(Card, { className: "flex-col gap-3 border-accent/40 bg-gradient-to-br from-surface-3 to-accent p-5 shadow-glow", interactive: false, children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-danger", children: "\u0410\u041A\u0422\u0418\u0412\u041D\u0410\u042F \u0412\u041E\u0419\u041D\u0410" }), _jsxs("span", { className: "font-mono text-[11px] text-text-secondary", children: [war.week_start, " \u2192 ", war.week_end] })] }), _jsxs("h3", { className: "font-display text-lg font-bold text-text-primary", children: [war.guild_a?.name ?? '—', " vs ", war.guild_b?.name ?? '—'] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "font-display text-[22px] font-bold text-success", children: scoreA }), _jsxs("div", { className: "flex h-2 flex-1 overflow-hidden rounded-full bg-black/30", children: [_jsx("div", { className: "h-full bg-success", style: { width: `${pctA}%` } }), _jsx("div", { className: "h-full bg-danger", style: { width: `${100 - pctA}%` } })] }), _jsx("span", { className: "font-display text-[22px] font-bold text-danger", children: scoreB })] })] }));
}
// ── per-mode views ────────────────────────────────────────────────────────
function GuildDetail({ guild, isMine }) {
    return (_jsxs(_Fragment, { children: [_jsx(GuildBanner, { guild: guild }), _jsxs("div", { className: "flex flex-col gap-4 px-4 pb-6 pt-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:pb-7", children: [_jsxs("div", { className: "flex w-full flex-col gap-5 lg:w-[380px]", children: [_jsx(WarPanel, { guildId: guild.id }), !isMine ? (_jsxs(Card, { className: "flex-col gap-2 p-5", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F" }), _jsx(Button, { disabled: true, children: "\u0417\u0430\u043F\u0440\u043E\u0441\u0438\u0442\u044C \u0432\u0445\u043E\u0434" }), _jsx("p", { className: "text-[11px] text-text-muted", children: "\u041F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u0432 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0439 \u0444\u0430\u0437\u0435." })] })) : null] }), _jsx(MembersList, { members: guild.members })] })] }));
}
function TopGuildsView() {
    const navigate = useNavigate();
    const { data, isLoading, isError, refetch } = useTopGuildsQuery(20);
    const items = data?.items ?? [];
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "flex h-auto flex-col items-start justify-between gap-3 px-4 py-6 sm:px-8 lg:h-[160px] lg:flex-row lg:items-center lg:px-20 lg:py-0", style: { background: 'linear-gradient(135deg, #2D1B4D 0%, #582CFF 100%)' }, children: _jsxs("div", { className: "flex items-center gap-4", children: [_jsx(Trophy, { className: "h-10 w-10 text-warn" }), _jsxs("div", { className: "flex flex-col", children: [_jsx("h1", { className: "font-display text-3xl font-extrabold text-text-primary sm:text-4xl", children: "\u0422\u043E\u043F \u0433\u0438\u043B\u044C\u0434\u0438\u0439" }), _jsx("p", { className: "text-sm text-text-secondary", children: "\u0413\u043B\u043E\u0431\u0430\u043B\u044C\u043D\u044B\u0439 \u0440\u0435\u0439\u0442\u0438\u043D\u0433 \u043F\u043E \u043E\u0447\u043A\u0430\u043C guild ELO." })] })] }) }), _jsx("div", { className: "flex flex-col gap-4 px-4 pb-6 pt-6 sm:px-8 lg:px-20 lg:pb-7", children: isLoading ? (_jsxs(Card, { className: "flex-col gap-3 p-5", children: [_jsx("div", { className: "h-4 w-2/3 animate-pulse rounded bg-surface-3" }), _jsx("div", { className: "h-4 w-1/2 animate-pulse rounded bg-surface-3" }), _jsx("div", { className: "h-4 w-1/3 animate-pulse rounded bg-surface-3" })] })) : isError ? (_jsxs(Card, { className: "flex-col items-start gap-3 p-5", children: [_jsx("p", { className: "text-sm text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0440\u0435\u0439\u0442\u0438\u043D\u0433." }), _jsxs(Button, { size: "sm", onClick: () => refetch(), children: [_jsx(RefreshCw, { className: "mr-2 h-3.5 w-3.5" }), " \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C"] })] })) : items.length === 0 ? (_jsxs(Card, { className: "flex-col gap-2 p-5", children: [_jsx(Users, { className: "h-5 w-5 text-text-muted" }), _jsx("p", { className: "text-sm text-text-secondary", children: "\u041F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0433\u0438\u043B\u044C\u0434\u0438\u0439." })] })) : (_jsxs(Card, { className: "flex-col p-0", children: [_jsxs("div", { className: "hidden grid-cols-[60px_1fr_120px_120px_60px] gap-4 border-b border-border px-5 py-3 font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted lg:grid", children: [_jsx("span", { children: "RANK" }), _jsx("span", { children: "\u0413\u0418\u041B\u042C\u0414\u0418\u042F" }), _jsx("span", { children: "\u0423\u0427\u0410\u0421\u0422\u041D\u0418\u041A\u0418" }), _jsx("span", { children: "ELO" }), _jsx("span", { children: "WIN" })] }), items.map((g) => (_jsxs("button", { type: "button", onClick: () => navigate(`/guild/${g.guild_id}`), className: "flex w-full flex-col gap-2 border-b border-border px-5 py-3 text-left transition-colors hover:bg-surface-2 lg:grid lg:grid-cols-[60px_1fr_120px_120px_60px] lg:items-center lg:gap-4", children: [_jsxs("span", { className: "font-display text-base font-bold text-warn", children: ["#", g.rank] }), _jsxs("div", { className: "flex min-w-0 items-center gap-3", children: [_jsx(Shield, { className: "h-5 w-5 shrink-0 text-cyan" }), _jsxs("div", { className: "flex min-w-0 flex-col", children: [_jsx("span", { className: "truncate text-sm font-semibold text-text-primary", children: g.name }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: tierFor(g.elo_total) })] })] }), _jsx("span", { className: "text-sm text-text-secondary", children: g.members_count }), _jsx("span", { className: "font-mono text-sm font-semibold text-text-primary", children: g.elo_total }), _jsx("span", { className: "text-sm text-success", children: g.wars_won }), _jsx("span", { className: "hidden lg:block", children: _jsx(ArrowRight, { className: "h-4 w-4 text-text-muted" }) })] }, g.guild_id)))] })) })] }));
}
// ── page ──────────────────────────────────────────────────────────────────
export default function GuildPage() {
    const { guildId } = useParams();
    const myGuildQuery = useMyGuildQuery();
    const explicitQuery = useGuildQuery(guildId);
    // The "active" guild — what we render in the detail layout — depends on
    // whether the URL pinned a specific guildId or not.
    const detailGuild = useMemo(() => {
        if (guildId)
            return explicitQuery.data;
        return myGuildQuery.data;
    }, [guildId, explicitQuery.data, myGuildQuery.data]);
    const isMine = !!myGuildQuery.data && detailGuild?.id === myGuildQuery.data.id;
    const loading = guildId ? explicitQuery.isLoading : myGuildQuery.isLoading;
    const errored = guildId ? explicitQuery.isError : myGuildQuery.isError;
    if (loading) {
        return (_jsx(AppShellV2, { children: _jsx("div", { className: "px-4 pt-6 sm:px-8 lg:px-20", children: _jsxs(Card, { className: "flex-col gap-3 p-5", children: [_jsx("div", { className: "h-6 w-1/3 animate-pulse rounded bg-surface-3" }), _jsx("div", { className: "h-4 w-1/2 animate-pulse rounded bg-surface-3" }), _jsx("div", { className: "h-4 w-1/4 animate-pulse rounded bg-surface-3" })] }) }) }));
    }
    if (errored) {
        return (_jsx(AppShellV2, { children: _jsx("div", { className: "px-4 pt-6 sm:px-8 lg:px-20", children: _jsxs(Card, { className: "flex-col items-start gap-3 p-5", children: [_jsx("p", { className: "text-sm text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0433\u0438\u043B\u044C\u0434\u0438\u044E." }), _jsxs(Button, { size: "sm", onClick: () => (guildId ? explicitQuery.refetch() : myGuildQuery.refetch()), children: [_jsx(RefreshCw, { className: "mr-2 h-3.5 w-3.5" }), " \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C"] })] }) }) }));
    }
    // /guild/:guildId — explicit lookup that returned no row → friendly empty.
    if (guildId && !detailGuild) {
        return (_jsx(AppShellV2, { children: _jsx("div", { className: "px-4 pt-6 sm:px-8 lg:px-20", children: _jsxs(Card, { className: "flex-col gap-2 p-5", children: [_jsx(Shield, { className: "h-5 w-5 text-text-muted" }), _jsx("p", { className: "text-sm text-text-secondary", children: "\u0413\u0438\u043B\u044C\u0434\u0438\u044F \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430." })] }) }) }));
    }
    // /guild without an id and the user has no guild → top-list.
    if (!guildId && !detailGuild) {
        return (_jsx(AppShellV2, { children: _jsx(TopGuildsView, {}) }));
    }
    // detail view (mine or public)
    return (_jsx(AppShellV2, { children: _jsx(GuildDetail, { guild: detailGuild, isMine: isMine }) }));
}
