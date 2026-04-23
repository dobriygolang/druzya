import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Copy, UserPlus, Swords, MessageSquare, Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { Tabs } from '../components/Tabs';
import { useFriendsQuery } from '../lib/queries/friends';
function ErrorChip() {
    const { t } = useTranslation('pages');
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: t('common.load_failed') }));
}
const ONLINE = [
    { name: 'kirill_dev', tier: 'Diamond I · 2 980 LP', status: 'В матче', g: 'violet-cyan' },
    { name: 'nastya_codes', tier: 'Diamond III · 2 720 LP', status: 'В лобби', g: 'pink-violet' },
    { name: 'alexey_go', tier: 'Grandmaster · 3 420 LP', status: 'Решает Daily', g: 'cyan-violet' },
    { name: 'maks_py', tier: 'Platinum II · 2 140 LP', status: 'Свободен', g: 'success-cyan' },
];
const OFFLINE = [
    { name: 'vasya_rs', tier: 'Diamond IV · 2 510 LP', last: '2 ч назад', g: 'pink-red' },
    { name: 'lena_ts', tier: 'Platinum I · 2 220 LP', last: '5 ч назад', g: 'gold' },
    { name: 'ivan_arch', tier: 'Master · 3 100 LP', last: 'вчера', g: 'violet-cyan' },
    { name: 'olya_ml', tier: 'Diamond II · 2 880 LP', last: '2 дня назад', g: 'cyan-violet' },
];
const REQUESTS = [
    { name: 'sergey_kt', sub: '12 общих друзей', g: 'violet-cyan' },
    { name: 'tanya_dev', sub: 'играли вместе в гильдии', g: 'pink-violet' },
    { name: 'anton_be', sub: '6 общих друзей', g: 'success-cyan' },
];
const SUGGESTIONS = [
    { name: 'mikhail_qa', sub: 'Diamond III', g: 'cyan-violet' },
    { name: 'katya_fe', sub: 'Platinum II', g: 'pink-red' },
    { name: 'pavel_sec', sub: 'Master', g: 'gold' },
    { name: 'dasha_ds', sub: 'Diamond I', g: 'violet-cyan' },
];
function FriendCard({ name, tier, status, g, online, wins, losses, winRate }) {
    const { t } = useTranslation('pages');
    return (_jsxs(Card, { className: `flex-col gap-3 p-5 ${online ? '' : 'opacity-60'}`, children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Avatar, { size: "lg", gradient: g, initials: name[0].toUpperCase(), status: online ? 'online' : 'offline' }), _jsxs("div", { className: "flex flex-1 flex-col gap-0.5", children: [_jsxs("span", { className: "font-display text-sm font-bold text-text-primary", children: ["@", name] }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: tier })] })] }), _jsx("span", { className: `inline-flex w-fit items-center rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold ${online ? 'bg-accent/15 text-accent-hover' : 'bg-surface-2 text-text-muted'}`, children: status }), _jsxs("div", { className: "flex gap-1.5 text-[11px] text-text-muted", children: [_jsxs("span", { children: ["W/L ", wins, "-", losses] }), _jsx("span", { children: "\u00B7" }), _jsxs("span", { children: ["WR ", winRate, "%"] })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { size: "sm", variant: "primary", icon: _jsx(Swords, { className: "h-3.5 w-3.5" }), className: "flex-1", children: t('friends.challenge') }), _jsx(Button, { size: "sm", variant: "ghost", icon: _jsx(MessageSquare, { className: "h-3.5 w-3.5" }), className: "flex-1", children: t('friends.chat') })] })] }));
}
export default function FriendsPage() {
    const { t } = useTranslation('pages');
    const [tab, setTab] = useState('all');
    const { data, isError } = useFriendsQuery();
    const counts = data?.counts ?? { online: 47, total: 124, requests: 3, guild: 32 };
    const friendCode = data?.friend_code ?? 'DRUZ9-K7M2-X9P';
    const onlineList = data?.online ?? ONLINE.map((f, i) => ({ id: `o${i}`, name: f.name, tier: f.tier, status: f.status, online: true, gradient: f.g, wins: 41, losses: 23, win_rate: 64 }));
    const offlineList = data?.offline ?? OFFLINE.map((f, i) => ({ id: `f${i}`, name: f.name, tier: f.tier, status: f.last, online: false, gradient: f.g, wins: 41, losses: 23, win_rate: 64 }));
    const requestList = data?.requests ?? REQUESTS.map((r, i) => ({ id: `r${i}`, name: r.name, subtitle: r.sub, gradient: r.g }));
    const suggestionList = data?.suggestions ?? SUGGESTIONS.map((s, i) => ({ id: `s${i}`, name: s.name, subtitle: s.sub, gradient: s.g }));
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8", children: [_jsxs("div", { className: "flex flex-col items-start gap-3 lg:flex-row lg:items-end lg:justify-between", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("h1", { className: "font-display text-2xl lg:text-[32px] font-bold text-text-primary", children: t('friends.title') }), _jsx("p", { className: "text-sm text-text-secondary", children: t('friends.summary', { online: counts.online, total: counts.total, requests: counts.requests }) }), isError && _jsx(ErrorChip, {})] }), _jsxs("div", { className: "flex flex-wrap gap-3", children: [_jsx(Button, { variant: "ghost", icon: _jsx(Copy, { className: "h-4 w-4" }), children: _jsx("span", { className: "font-mono text-xs", children: friendCode }) }), _jsx(Button, { variant: "primary", icon: _jsx(UserPlus, { className: "h-4 w-4" }), children: t('friends.find') })] })] }), _jsx(Tabs, { variant: "pills", value: tab, onChange: setTab, children: _jsxs(Tabs.List, { children: [_jsxs(Tabs.Tab, { id: "all", children: [t('friends.all'), " ", counts.total] }), _jsxs(Tabs.Tab, { id: "online", children: [t('friends.online'), " ", counts.online] }), _jsx(Tabs.Tab, { id: "requests", children: _jsxs("span", { className: "inline-flex items-center gap-1.5", children: [t('friends.requests'), " ", counts.requests, " ", _jsx("span", { className: "h-1.5 w-1.5 rounded-full bg-danger" })] }) }), _jsxs(Tabs.Tab, { id: "guild", children: [t('friends.guild'), " ", counts.guild] }), _jsx(Tabs.Tab, { id: "blocked", children: t('friends.blocked') })] }) }), _jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:gap-6", children: [_jsxs("div", { className: "flex flex-1 flex-col gap-6", children: [_jsxs("div", { className: "flex flex-col gap-3", children: [_jsx("h2", { className: "font-display text-lg font-bold text-text-primary", children: t('friends.online_now', { n: onlineList.length }) }), _jsx("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4", children: onlineList.map((f) => _jsx(FriendCard, { name: f.name, tier: f.tier, status: f.status, g: f.gradient, online: true, wins: f.wins, losses: f.losses, winRate: f.win_rate }, f.id)) })] }), _jsxs("div", { className: "flex flex-col gap-3", children: [_jsx("h2", { className: "font-display text-lg font-bold text-text-primary", children: t('friends.recent') }), _jsx("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4", children: offlineList.map((f) => _jsx(FriendCard, { name: f.name, tier: f.tier, status: f.status, g: f.gradient, online: false, wins: f.wins, losses: f.losses, winRate: f.win_rate }, f.id)) })] })] }), _jsxs("div", { className: "flex w-full flex-col gap-4 lg:w-[380px]", children: [_jsxs(Card, { className: "flex-col gap-3 border-accent/40 p-5", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: t('friends.incoming') }), requestList.map((r) => (_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Avatar, { size: "md", gradient: r.gradient, initials: r.name[0].toUpperCase() }), _jsxs("div", { className: "flex flex-1 flex-col gap-0.5", children: [_jsxs("span", { className: "text-sm font-semibold text-text-primary", children: ["@", r.name] }), _jsx("span", { className: "text-[11px] text-text-muted", children: r.subtitle })] }), _jsx("button", { className: "grid h-8 w-8 place-items-center rounded-md bg-success/15 text-success hover:bg-success/25", children: _jsx(Check, { className: "h-4 w-4" }) }), _jsx("button", { className: "grid h-8 w-8 place-items-center rounded-md bg-danger/15 text-danger hover:bg-danger/25", children: _jsx(X, { className: "h-4 w-4" }) })] }, r.id)))] }), _jsxs(Card, { className: "flex-col gap-3 p-5", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: t('friends.suggestions') }), suggestionList.map((s) => (_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Avatar, { size: "sm", gradient: s.gradient, initials: s.name[0].toUpperCase() }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsxs("span", { className: "text-sm font-semibold text-text-primary", children: ["@", s.name] }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: s.subtitle })] }), _jsx("button", { className: "text-xs font-semibold text-accent-hover hover:text-accent", children: t('friends.add') })] }, s.id)))] }), _jsxs(Card, { className: "flex-col gap-3 p-5", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: t('friends.find_by_code') }), _jsxs("div", { className: "flex gap-2", children: [_jsx("input", { className: "h-9 flex-1 rounded-md border border-border bg-surface-2 px-3 font-mono text-[13px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none", placeholder: "DRUZ9-XXXX-XXX" }), _jsx(Button, { size: "sm", variant: "primary", children: t('friends.find_btn') })] })] })] })] })] }) }));
}
