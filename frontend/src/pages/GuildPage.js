import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
// /guild — Wave 3 guild page.
//
// Three layout modes driven by the route + query state:
//
//   1. /guild and the user IS in a guild  → detail view of MY guild
//   2. /guild and the user is NOT in any  → public discovery (search + grid)
//   3. /guild/:guildId                    → public detail of THAT guild
//
// Reads:
//   - useMyGuildQuery()    /api/v1/guild/my   (returns null on 404)
//   - useGuildQuery(id)    /api/v1/guild/{id}
//   - useGuildWarQuery(id) /api/v1/guild/{id}/war
//   - useGuildListQuery()  /api/v1/guild/list?search=&tier=&page=
//
// Mutations (Wave 3):
//   - useJoinGuildMutation()    POST /api/v1/guild/{id}/join
//   - useLeaveGuildMutation()   POST /api/v1/guild/{id}/leave
//   - useCreateGuildMutation()  POST /api/v1/guild
//
// Loading/empty/error states mirror the bible defaults — skeleton sections,
// friendly empty copy, and a retry button on hard errors.
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Crown, LogOut, Plus, RefreshCw, Search, Shield, Trophy, Users, X, } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { useCreateGuildMutation, useGuildListQuery, useGuildQuery, useGuildWarQuery, useJoinGuildMutation, useLeaveGuildMutation, useMyGuildQuery, } from '../lib/queries/guild';
// ── helpers ───────────────────────────────────────────────────────────────
// TIERS is kept for the discovery page filter chips. New guilds always start
// at the lowest tier ("bronze") and are promoted automatically by the backend
// based on the guild's aggregate ELO — see HandleCreate in
// services/guild/ports/discovery_handler.go.
const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master'];
function tierFor(elo) {
    if (elo >= 2200)
        return 'master';
    if (elo >= 1900)
        return 'diamond';
    if (elo >= 1600)
        return 'platinum';
    if (elo >= 1300)
        return 'gold';
    if (elo >= 1100)
        return 'silver';
    return 'bronze';
}
function tierLabel(t) {
    switch (t) {
        case 'master':
            return 'Master';
        case 'diamond':
            return 'Diamond';
        case 'platinum':
            return 'Platinum';
        case 'gold':
            return 'Gold';
        case 'silver':
            return 'Silver';
        case 'bronze':
            return 'Bronze';
        default:
            return '—';
    }
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
                    }, children: _jsx(Shield, { className: "h-12 w-12 text-text-primary" }) }), _jsxs("div", { className: "flex flex-col gap-1.5", children: [rank ? (_jsxs("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn", children: [tierLabel(tierFor(guild.guild_elo)).toUpperCase(), " TIER \u00B7 #", rank, " GLOBAL"] })) : null, _jsx("h1", { className: "font-display text-3xl font-extrabold leading-[1.05] text-text-primary sm:text-4xl lg:text-[36px]", children: guild.name }), _jsxs("p", { className: "text-sm text-text-secondary", children: [(guild.members?.length ?? 0), " \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432 \u00B7 guild ELO ", guild.guild_elo] }), _jsxs("div", { className: "mt-2 flex gap-6", children: [_jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-display text-lg font-bold text-text-primary", children: guild.guild_elo }), _jsx("span", { className: "text-[11px] text-text-muted", children: "guild ELO" })] }), _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-display text-lg font-bold text-cyan", children: guild.members?.length ?? 0 }), _jsx("span", { className: "text-[11px] text-text-muted", children: "\u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432" })] }), _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-display text-lg font-bold text-warn", children: guild.current_war_id ? '1' : '0' }), _jsx("span", { className: "text-[11px] text-text-muted", children: "\u0430\u043A\u0442\u0438\u0432\u043D\u044B\u0445 \u0432\u043E\u0439\u043D" })] })] })] })] }) }));
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
function ActionsPanel({ guildId, isMine }) {
    const join = useJoinGuildMutation();
    const leave = useLeaveGuildMutation();
    const [feedback, setFeedback] = useState(null);
    if (isMine) {
        return (_jsxs(Card, { className: "flex-col gap-3 p-5", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F" }), _jsx(Button, { variant: "ghost", icon: _jsx(LogOut, { className: "h-3.5 w-3.5" }), loading: leave.isPending, onClick: () => leave.mutate(guildId, {
                        onSuccess: (res) => {
                            if (res.status === 'disbanded') {
                                setFeedback('Ты был последним участником — гильдия распущена.');
                            }
                            else if (res.status === 'transferred') {
                                setFeedback('Ты вышел; права капитана переданы старейшему участнику.');
                            }
                            else {
                                setFeedback('Ты покинул гильдию.');
                            }
                        },
                        onError: (err) => setFeedback(err instanceof Error ? err.message : 'Не удалось выйти.'),
                    }), children: "\u0412\u044B\u0439\u0442\u0438 \u0438\u0437 \u0433\u0438\u043B\u044C\u0434\u0438\u0438" }), feedback ? (_jsx("p", { className: "text-[12px] text-text-muted", children: feedback })) : (_jsx("p", { className: "text-[11px] text-text-muted", children: "\u0415\u0441\u043B\u0438 \u0442\u044B \u043A\u0430\u043F\u0438\u0442\u0430\u043D \u2014 \u043F\u0440\u0430\u0432\u0430 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043F\u0435\u0440\u0435\u0439\u0434\u0443\u0442 \u043A \u0441\u0442\u0430\u0440\u0435\u0439\u0448\u0435\u043C\u0443 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0443. \u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A \u0440\u0430\u0441\u043F\u0443\u0441\u043A\u0430\u0435\u0442 \u0433\u0438\u043B\u044C\u0434\u0438\u044E \u043F\u0440\u0438 \u0432\u044B\u0445\u043E\u0434\u0435." }))] }));
    }
    return (_jsxs(Card, { className: "flex-col gap-2 p-5", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F" }), _jsx(Button, { loading: join.isPending, onClick: () => join.mutate(guildId, {
                    onSuccess: (res) => setFeedback(res.status === 'pending'
                        ? 'Заявка отправлена капитану.'
                        : 'Готово — добро пожаловать!'),
                    onError: (err) => setFeedback(err instanceof Error ? err.message : 'Не удалось вступить.'),
                }), children: "\u0412\u0441\u0442\u0443\u043F\u0438\u0442\u044C \u0432 \u0433\u0438\u043B\u044C\u0434\u0438\u044E" }), feedback ? _jsx("p", { className: "text-[12px] text-text-muted", children: feedback }) : null] }));
}
// ── per-mode views ────────────────────────────────────────────────────────
function GuildDetail({ guild, isMine }) {
    return (_jsxs(_Fragment, { children: [_jsx(GuildBanner, { guild: guild }), _jsxs("div", { className: "flex flex-col gap-4 px-4 pb-6 pt-6 sm:px-8 lg:flex-row lg:gap-6 lg:px-20 lg:pb-7", children: [_jsxs("div", { className: "flex w-full flex-col gap-5 lg:w-[380px]", children: [_jsx(WarPanel, { guildId: guild.id }), _jsx(ActionsPanel, { guildId: guild.id, isMine: isMine })] }), _jsx(MembersList, { members: guild.members })] })] }));
}
// PublicGuildCard — single tile in the discovery grid.
function PublicGuildCard({ guild, onJoin, joining, onOpen, }) {
    const seats = `${guild.members_count}/${guild.max_members}`;
    const policyChip = guild.join_policy === 'open'
        ? 'bg-success/15 text-success'
        : guild.join_policy === 'invite'
            ? 'bg-warn/15 text-warn'
            : 'bg-danger/15 text-danger';
    const policyLabel = guild.join_policy === 'open' ? 'Открытая' : guild.join_policy === 'invite' ? 'По заявке' : 'Закрытая';
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsxs("div", { className: "flex items-start gap-3", children: [_jsx("div", { className: "grid h-12 w-12 shrink-0 place-items-center", style: {
                            borderRadius: 12,
                            background: 'linear-gradient(135deg, #22D3EE 0%, #582CFF 100%)',
                        }, children: _jsx(Shield, { className: "h-6 w-6 text-text-primary" }) }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col", children: [_jsx("button", { type: "button", className: "text-left font-display text-base font-bold text-text-primary hover:underline", onClick: onOpen, children: guild.name }), _jsxs("div", { className: "mt-1 flex flex-wrap items-center gap-1.5", children: [_jsx("span", { className: "rounded-md bg-warn/15 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-warn", children: tierLabel(guild.tier || tierFor(guild.guild_elo)) }), _jsx("span", { className: `rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ${policyChip}`, children: policyLabel })] })] })] }), guild.description ? (_jsx("p", { className: "line-clamp-2 text-[12px] leading-snug text-text-secondary", children: guild.description })) : null, _jsxs("div", { className: "flex flex-wrap items-center gap-3 pt-1", children: [_jsx(Stat, { label: "ELO", value: String(guild.guild_elo) }), _jsx(Stat, { label: "\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438", value: seats }), _jsx(Stat, { label: "\u0412\u043E\u0439\u043D\u044B", value: String(guild.wars_won) })] }), _jsxs("div", { className: "mt-1 flex items-center justify-between gap-2", children: [_jsx(Button, { variant: "ghost", size: "sm", onClick: onOpen, icon: _jsx(ArrowRight, { className: "h-3.5 w-3.5" }), children: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C" }), _jsx(Button, { variant: "primary", size: "sm", loading: joining, disabled: guild.join_policy === 'closed' || guild.members_count >= guild.max_members, onClick: onJoin, children: guild.join_policy === 'invite' ? 'Запрос' : 'Вступить' })] })] }));
}
function Stat({ label, value }) {
    return (_jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-display text-sm font-bold text-text-primary", children: value }), _jsx("span", { className: "font-mono text-[10px] uppercase tracking-[0.05em] text-text-muted", children: label })] }));
}
function CreateGuildModal({ open, onClose, }) {
    const create = useCreateGuildMutation();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [maxMembers, setMaxMembers] = useState(25);
    const [policy, setPolicy] = useState('open');
    const [error, setError] = useState(null);
    if (!open)
        return null;
    const submit = () => {
        setError(null);
        if (name.trim().length < 3) {
            setError('Имя должно быть хотя бы из 3 символов.');
            return;
        }
        create.mutate(
        // tier is intentionally NOT sent — backend forces bronze for every new
        // guild; promotion happens automatically based on aggregate ELO.
        { name: name.trim(), description: description.trim(), max_members: maxMembers, join_policy: policy }, {
            onSuccess: () => {
                onClose();
                setName('');
                setDescription('');
            },
            onError: (err) => setError(err instanceof Error ? err.message : 'Не удалось создать гильдию.'),
        });
    };
    return (_jsx("div", { role: "dialog", "aria-modal": "true", className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8", onClick: onClose, children: _jsxs("div", { className: "flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-bg p-6", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "flex items-start justify-between", children: [_jsx("h2", { className: "font-display text-lg font-bold text-text-primary", children: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0433\u0438\u043B\u044C\u0434\u0438\u044E" }), _jsx("button", { type: "button", onClick: onClose, className: "text-text-muted hover:text-text-primary", "aria-label": "\u0417\u0430\u043A\u0440\u044B\u0442\u044C", children: _jsx(X, { className: "h-5 w-5" }) })] }), _jsx(Field, { label: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 (3..32 \u0441\u0438\u043C\u0432\u043E\u043B\u0430)", children: _jsx("input", { type: "text", className: "h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-[13px] text-text-primary outline-none focus:border-accent", value: name, onChange: (e) => setName(e.target.value), maxLength: 32, placeholder: "The Crimson Recursion" }) }), _jsx(Field, { label: "\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435", children: _jsx("textarea", { className: "min-h-[64px] w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent", value: description, onChange: (e) => setDescription(e.target.value), maxLength: 140, placeholder: "\u041E\u043F\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u043E \u2014 \u043A\u043E\u0440\u043E\u0442\u043A\u0438\u0439 \u0434\u0435\u0432\u0438\u0437 \u0433\u0438\u043B\u044C\u0434\u0438\u0438." }) }), _jsx(Field, { label: "\u041B\u0438\u043C\u0438\u0442 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432", children: _jsx("input", { type: "number", min: 1, max: 200, className: "h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-[13px] text-text-primary outline-none focus:border-accent", value: maxMembers, onChange: (e) => setMaxMembers(Math.max(1, Math.min(200, Number(e.target.value) || 1))) }) }), _jsx("p", { className: "rounded-md border border-border bg-surface-1 px-3 py-2 text-[11px] text-text-muted", children: "\u0413\u0438\u043B\u044C\u0434\u0438\u044F \u043D\u0430\u0447\u0438\u043D\u0430\u0435\u0442 \u0441 Bronze tier. \u0422\u0438\u0440 \u043F\u043E\u0432\u044B\u0448\u0430\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u2014 \u0440\u0430\u0441\u0442\u0438\u0442\u0435 ELO \u0441\u0432\u043E\u0435\u0439 \u043A\u043E\u043C\u0430\u043D\u0434\u044B." }), _jsx(Field, { label: "\u041F\u043E\u043B\u0438\u0442\u0438\u043A\u0430 \u0432\u0445\u043E\u0434\u0430", children: _jsxs("select", { className: "h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-[13px] text-text-primary outline-none focus:border-accent", value: policy, onChange: (e) => setPolicy(e.target.value), children: [_jsx("option", { value: "open", children: "\u041E\u0442\u043A\u0440\u044B\u0442\u0430\u044F \u2014 \u043B\u044E\u0431\u043E\u0439 \u043C\u043E\u0436\u0435\u0442 \u0432\u0441\u0442\u0443\u043F\u0438\u0442\u044C" }), _jsx("option", { value: "invite", children: "\u041F\u043E \u0437\u0430\u044F\u0432\u043A\u0435 \u2014 \u043C\u043E\u0434\u0435\u0440\u0430\u0446\u0438\u044F \u043A\u0430\u043F\u0438\u0442\u0430\u043D\u043E\u043C" }), _jsx("option", { value: "closed", children: "\u0417\u0430\u043A\u0440\u044B\u0442\u0430\u044F \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E \u043F\u0440\u0438\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u044E" })] }) }), error ? _jsx("p", { className: "text-[12px] text-danger", children: error }) : null, _jsxs("div", { className: "flex items-center justify-end gap-2 pt-2", children: [_jsx(Button, { variant: "ghost", size: "sm", onClick: onClose, children: "\u041E\u0442\u043C\u0435\u043D\u0430" }), _jsx(Button, { variant: "primary", size: "sm", loading: create.isPending, onClick: submit, children: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C" })] })] }) }));
}
function Field({ label, children }) {
    return (_jsxs("label", { className: "flex flex-col gap-1", children: [_jsx("span", { className: "font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted", children: label }), children] }));
}
function DiscoveryView() {
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [tier, setTier] = useState('');
    const [createOpen, setCreateOpen] = useState(false);
    const [pendingId, setPendingId] = useState(null);
    const [feedback, setFeedback] = useState(null);
    const filters = useMemo(() => ({ search: search.trim(), tier, page: 1 }), [search, tier]);
    const { data, isLoading, isError, refetch } = useGuildListQuery(filters);
    const join = useJoinGuildMutation();
    const items = data?.items ?? [];
    const handleJoin = (id) => {
        setPendingId(id);
        setFeedback(null);
        join.mutate(id, {
            onSuccess: (res) => {
                setPendingId(null);
                setFeedback(res.status === 'pending'
                    ? 'Заявка отправлена капитану. Жди подтверждения.'
                    : 'Готово — ты в гильдии!');
            },
            onError: (err) => {
                setPendingId(null);
                setFeedback(err instanceof Error ? err.message : 'Не удалось вступить.');
            },
        });
    };
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex h-auto flex-col items-start justify-between gap-3 px-4 py-6 sm:px-8 lg:h-[180px] lg:flex-row lg:items-center lg:px-20 lg:py-0", style: { background: 'linear-gradient(135deg, #2D1B4D 0%, #582CFF 100%)' }, children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx(Trophy, { className: "h-10 w-10 text-warn" }), _jsxs("div", { className: "flex flex-col", children: [_jsx("h1", { className: "font-display text-3xl font-extrabold text-text-primary sm:text-4xl", children: "\u0413\u0438\u043B\u044C\u0434\u0438\u0438" }), _jsx("p", { className: "text-sm text-text-secondary", children: "\u041D\u0430\u0439\u0434\u0438 \u0441\u0432\u043E\u044E \u043A\u043E\u043C\u0430\u043D\u0434\u0443 \u2014 \u0432\u0441\u0442\u0443\u043F\u0438 \u0438\u043B\u0438 \u0441\u043E\u0437\u0434\u0430\u0439 \u043D\u043E\u0432\u0443\u044E \u0433\u0438\u043B\u044C\u0434\u0438\u044E." })] })] }), _jsx(Button, { variant: "primary", icon: _jsx(Plus, { className: "h-4 w-4" }), onClick: () => setCreateOpen(true), children: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u0433\u0438\u043B\u044C\u0434\u0438\u044E" })] }), _jsxs("div", { className: "flex flex-col gap-4 px-4 pb-6 pt-6 sm:px-8 lg:px-20 lg:pb-7", children: [_jsxs(Card, { className: "flex-col gap-3 p-4 lg:flex-row lg:items-end", interactive: false, children: [_jsx(Field, { label: "\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044E", children: _jsxs("div", { className: "relative w-full", children: [_jsx(Search, { className: "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" }), _jsx("input", { type: "text", className: "h-10 w-full rounded-md border border-border bg-surface-1 pl-9 pr-3 text-[13px] text-text-primary outline-none focus:border-accent", placeholder: "Crimson\u2026", value: search, onChange: (e) => setSearch(e.target.value) })] }) }), _jsx(Field, { label: "Tier", children: _jsxs("select", { className: "h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-[13px] text-text-primary outline-none focus:border-accent lg:w-[160px]", value: tier, onChange: (e) => setTier(e.target.value), children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435" }), TIERS.map((t) => (_jsx("option", { value: t, children: tierLabel(t) }, t)))] }) })] }), feedback ? (_jsx(Card, { className: "flex-col items-start gap-1 border-cyan/30 bg-cyan/5 p-3", interactive: false, children: _jsx("p", { className: "text-[12px] text-cyan", children: feedback }) })) : null, isLoading ? (_jsxs(Card, { className: "flex-col gap-3 p-5", children: [_jsx("div", { className: "h-4 w-2/3 animate-pulse rounded bg-surface-3" }), _jsx("div", { className: "h-4 w-1/2 animate-pulse rounded bg-surface-3" }), _jsx("div", { className: "h-4 w-1/3 animate-pulse rounded bg-surface-3" })] })) : isError ? (_jsxs(Card, { className: "flex-col items-start gap-3 p-5", children: [_jsx("p", { className: "text-sm text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A \u0433\u0438\u043B\u044C\u0434\u0438\u0439." }), _jsxs(Button, { size: "sm", onClick: () => refetch(), children: [_jsx(RefreshCw, { className: "mr-2 h-3.5 w-3.5" }), " \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C"] })] })) : items.length === 0 ? (_jsxs(Card, { className: "flex-col gap-2 p-5", children: [_jsx(Users, { className: "h-5 w-5 text-text-muted" }), _jsx("p", { className: "text-sm text-text-secondary", children: "\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0448\u043B\u043E\u0441\u044C. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439 \u0434\u0440\u0443\u0433\u043E\u0439 \u0444\u0438\u043B\u044C\u0442\u0440 \u0438\u043B\u0438 \u0441\u043E\u0437\u0434\u0430\u0439 \u0441\u0432\u043E\u044E \u0433\u0438\u043B\u044C\u0434\u0438\u044E." })] })) : (_jsx("div", { className: "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3", children: items.map((g) => (_jsx(PublicGuildCard, { guild: g, joining: pendingId === g.id, onJoin: () => handleJoin(g.id), onOpen: () => navigate(`/guild/${g.id}`) }, g.id))) }))] }), _jsx(CreateGuildModal, { open: createOpen, onClose: () => setCreateOpen(false) })] }));
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
    // /guild without an id and the user has no guild → discovery view (search,
    // grid of public guilds, join + create CTAs).
    if (!guildId && !detailGuild) {
        return (_jsx(AppShellV2, { children: _jsx(DiscoveryView, {}) }));
    }
    // detail view (mine or public)
    return (_jsx(AppShellV2, { children: _jsx(GuildDetail, { guild: detailGuild, isMine: isMine }) }));
}
