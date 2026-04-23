import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { Check, Settings, Swords, Trophy, Sparkles, Shield, Award, Bell, Users, Server, } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Tabs } from '../components/Tabs';
import { useNotificationsQuery, useMarkRead, useMarkAllRead, useNotificationPrefsQuery, useUpdatePrefs, groupByBucket, } from '../lib/queries/notifications';
import { useAcceptFriend, useDeclineFriend } from '../lib/queries/friends';
function ErrorChip() {
    const { t } = useTranslation('pages');
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: t('common.load_failed') }));
}
// Маппинг channel/type → визуал. Channel — broad bucket, type — конкретное событие.
function visualFor(n) {
    switch (n.type) {
        case 'win':
            return { icon: _jsx(Trophy, { className: "h-4 w-4 text-success" }), bg: 'bg-success/15' };
        case 'loss':
            return { icon: _jsx(Swords, { className: "h-4 w-4 text-danger" }), bg: 'bg-danger/15' };
        case 'challenge':
            return { icon: _jsx(Swords, { className: "h-4 w-4 text-accent-hover" }), bg: 'bg-accent/15' };
        case 'friend_request':
            return { icon: _jsx(Users, { className: "h-4 w-4 text-accent-hover" }), bg: 'bg-accent/15' };
        case 'friend_added':
            return { icon: _jsx(Users, { className: "h-4 w-4 text-success" }), bg: 'bg-success/15' };
        case 'achievement_unlocked':
            return { icon: _jsx(Award, { className: "h-4 w-4 text-warn" }), bg: 'bg-warn/15' };
        case 'streak_at_risk':
            return { icon: _jsx(Bell, { className: "h-4 w-4 text-pink" }), bg: 'bg-pink/15' };
        case 'guild_war_started':
        case 'guild_war_ended':
            return { icon: _jsx(Shield, { className: "h-4 w-4 text-cyan" }), bg: 'bg-cyan/15' };
        case 'plan_ready':
            return { icon: _jsx(Sparkles, { className: "h-4 w-4 text-pink" }), bg: 'bg-pink/15' };
        default:
            // Channel-fallback.
            switch (n.channel) {
                case 'wins':
                    return { icon: _jsx(Trophy, { className: "h-4 w-4 text-warn" }), bg: 'bg-warn/15' };
                case 'social':
                    return { icon: _jsx(Users, { className: "h-4 w-4 text-accent-hover" }), bg: 'bg-accent/15' };
                case 'guild':
                    return { icon: _jsx(Shield, { className: "h-4 w-4 text-cyan" }), bg: 'bg-cyan/15' };
                case 'system':
                    return { icon: _jsx(Server, { className: "h-4 w-4 text-text-secondary" }), bg: 'bg-surface-3' };
                default:
                    return { icon: _jsx(Bell, { className: "h-4 w-4 text-text-secondary" }), bg: 'bg-surface-3' };
            }
    }
}
function relativeTime(iso, now = new Date()) {
    const d = new Date(iso);
    const diffMs = now.getTime() - d.getTime();
    const min = Math.floor(diffMs / 60_000);
    if (min < 1)
        return 'только что';
    if (min < 60)
        return `${min} мин`;
    const hr = Math.floor(min / 60);
    if (hr < 24)
        return `${hr} ч`;
    const days = Math.floor(hr / 24);
    if (days === 1)
        return 'вчера';
    if (days < 7)
        return `${days} дн`;
    return d.toLocaleDateString();
}
const TAB_TO_FILTER = {
    all: {},
    unread_tab: { unread: true },
    social: { channel: 'social' },
    match: { channel: 'match' },
    guild: { channel: 'guild' },
    system: { channel: 'system' },
};
function Row({ n, onMarkRead, onAcceptFriend, onDeclineFriend, onOpenReplay, onOpenPlan, }) {
    const v = visualFor(n);
    const unread = n.read_at == null;
    const friendshipID = n.payload?.friendship_id ?? undefined;
    const matchID = n.payload?.match_id ?? undefined;
    const planID = n.payload?.plan_id ?? undefined;
    return (_jsxs("div", { className: "group flex items-start gap-3 px-[14px] py-3", onMouseEnter: () => unread && onMarkRead(), children: [_jsx("span", { className: `mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${unread ? 'bg-accent' : 'bg-transparent'}` }), _jsx("span", { className: `grid h-10 w-10 shrink-0 place-items-center rounded-full ${v.bg}`, children: v.icon }), _jsxs("div", { className: "flex flex-1 flex-col gap-1", children: [_jsxs("div", { className: "text-sm text-text-primary", children: [_jsx("b", { className: "font-semibold", children: n.title }), n.body ? _jsxs(_Fragment, { children: [" \u00B7 ", _jsx("span", { className: "text-text-secondary", children: n.body })] }) : null] }), _jsx("div", { className: "flex items-center gap-2 text-[11px] text-text-muted", children: _jsx("span", { className: "font-mono", children: relativeTime(n.created_at) }) }), n.type === 'friend_request' && friendshipID != null && (_jsxs("div", { className: "flex gap-2 pt-1", children: [_jsx(Button, { size: "sm", variant: "primary", onClick: () => onAcceptFriend?.(friendshipID), children: "\u041F\u0440\u0438\u043D\u044F\u0442\u044C" }), _jsx(Button, { size: "sm", variant: "ghost", onClick: () => onDeclineFriend?.(friendshipID), children: "\u041E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C" })] })), (n.type === 'win' || n.type === 'loss') && matchID && (_jsx("button", { type: "button", className: "pt-1 text-left text-xs font-semibold text-accent-hover hover:text-accent", onClick: () => onOpenReplay?.(matchID), children: "\u041F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C replay \u2192" })), n.type === 'plan_ready' && planID && (_jsx("button", { type: "button", className: "pt-1 text-left text-xs font-semibold text-accent-hover hover:text-accent", onClick: () => onOpenPlan?.(planID), children: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u043B\u0430\u043D \u2192" })), n.type === 'challenge' && (_jsxs("div", { className: "flex gap-2 pt-1", children: [_jsx(Button, { size: "sm", variant: "primary", disabled: true, title: "WIP", children: "\u041F\u0440\u0438\u043D\u044F\u0442\u044C" }), _jsx(Button, { size: "sm", variant: "ghost", disabled: true, title: "WIP", children: "\u041E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C" })] }))] })] }));
}
function Group({ label, items, render }) {
    if (items.length === 0)
        return null;
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "px-2 pt-2", children: _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: label }) }), _jsx("div", { className: "flex flex-col divide-y divide-border", children: items.map(render) })] }));
}
function SettingsPanel() {
    const { t } = useTranslation('pages');
    const prefs = useNotificationPrefsQuery();
    const update = useUpdatePrefs();
    const enabled = prefs.data?.channel_enabled ?? {};
    const silenceUntil = prefs.data?.silence_until ?? null;
    const channels = [
        { id: 'wins', label: 'Победы', icon: _jsx(Trophy, { className: "h-3.5 w-3.5" }) },
        { id: 'match', label: 'Матчи', icon: _jsx(Swords, { className: "h-3.5 w-3.5" }) },
        { id: 'social', label: 'Соц', icon: _jsx(Users, { className: "h-3.5 w-3.5" }) },
        { id: 'guild', label: 'Гильдия', icon: _jsx(Shield, { className: "h-3.5 w-3.5" }) },
        { id: 'system', label: 'Система', icon: _jsx(Server, { className: "h-3.5 w-3.5" }) },
    ];
    const toggle = (id) => {
        const next = { ...enabled, [id]: !(enabled[id] ?? true) };
        update.mutate({ channel_enabled: next, silence_until: silenceUntil });
    };
    const setSilence = (hours) => {
        let s = null;
        if (hours != null) {
            const t = new Date(Date.now() + hours * 60 * 60_000);
            s = t.toISOString();
        }
        update.mutate({ channel_enabled: enabled, silence_until: s });
    };
    return (_jsxs(_Fragment, { children: [_jsxs(Card, { className: "flex-col gap-2 p-5", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: t('notifications.silence') }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [[
                                { l: '1ч', h: 1 },
                                { l: '8ч', h: 8 },
                                { l: '24ч', h: 24 },
                            ].map((opt) => (_jsx("button", { onClick: () => setSilence(opt.h), className: "rounded-md border border-border bg-surface-2 px-3 py-1 text-[12px] text-text-secondary hover:border-accent hover:text-text-primary", children: opt.l }, opt.l))), _jsx("button", { onClick: () => setSilence(null), className: "rounded-md border border-border bg-surface-2 px-3 py-1 text-[12px] text-text-muted hover:text-text-primary", children: t('notifications.silence_off', 'Выкл') })] }), silenceUntil && (_jsxs("span", { className: "text-[11px] text-text-muted", children: ["\u0414\u043E ", new Date(silenceUntil).toLocaleString()] }))] }), _jsxs(Card, { className: "flex-col gap-2 p-5", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: t('notifications.channels') }), channels.map((c) => {
                        const on = enabled[c.id] ?? true;
                        return (_jsxs("button", { type: "button", onClick: () => toggle(c.id), className: "flex items-center justify-between rounded-md px-1 py-1.5 hover:bg-surface-2", children: [_jsxs("span", { className: "flex items-center gap-2 text-[13px] text-text-secondary", children: [c.icon, " ", c.label] }), _jsx("span", { className: `flex h-5 w-9 items-center rounded-full px-0.5 ${on ? 'bg-accent justify-end' : 'bg-surface-3 justify-start'}`, children: _jsx("span", { className: "h-4 w-4 rounded-full bg-text-primary" }) })] }, c.id));
                    })] })] }));
}
export default function NotificationsPage() {
    const { t } = useTranslation('pages');
    const navigate = useNavigate();
    const [tab, setTab] = useState('all');
    const filter = TAB_TO_FILTER[tab];
    const list = useNotificationsQuery(filter);
    const markRead = useMarkRead();
    const markAll = useMarkAllRead();
    const acceptFriend = useAcceptFriend();
    const declineFriend = useDeclineFriend();
    // Stabilise the items array reference: `list.data?.items ?? []` would
    // create a fresh `[]` on every render when data is undefined and break
    // memoisation of the dependent useMemo hooks below.
    const items = useMemo(() => list.data?.items ?? [], [list.data?.items]);
    const grouped = useMemo(() => groupByBucket(items), [items]);
    // counters per tab. Используем общий `all` фетч для аккуратных counts,
    // но чтобы не жечь сеть — поднимем это из самих items только когда tab=='all'.
    const counts = useMemo(() => {
        const all = items.length;
        let unread = 0;
        let social = 0;
        let match = 0;
        let guild = 0;
        let system = 0;
        for (const n of items) {
            if (n.read_at == null)
                unread++;
            if (n.channel === 'social')
                social++;
            if (n.channel === 'match')
                match++;
            if (n.channel === 'guild')
                guild++;
            if (n.channel === 'system')
                system++;
        }
        return { all, unread, social, match, guild, system };
    }, [items]);
    const renderRow = (n) => (_jsx(Row, { n: n, onMarkRead: () => markRead.mutate(n.id), onAcceptFriend: (id) => acceptFriend.mutate(id), onDeclineFriend: (id) => declineFriend.mutate(id), onOpenReplay: (matchID) => navigate(`/arena/match/${matchID}/replay`), onOpenPlan: () => navigate('/weekly') }, n.id));
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8", children: [_jsxs("div", { className: "flex flex-col items-start gap-3 lg:flex-row lg:items-end lg:justify-between", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("h1", { className: "font-display text-2xl lg:text-[32px] font-bold text-text-primary", children: t('notifications.title') }), _jsx("p", { className: "text-sm text-text-secondary", children: t('notifications.unread', { n: counts.unread }) }), list.isError && _jsx(ErrorChip, {})] }), _jsxs("div", { className: "flex flex-wrap gap-3", children: [_jsx(Button, { variant: "ghost", icon: _jsx(Check, { className: "h-4 w-4" }), disabled: markAll.isPending || counts.unread === 0, onClick: () => markAll.mutate(), children: t('notifications.mark_all') }), _jsx(Button, { variant: "ghost", icon: _jsx(Settings, { className: "h-4 w-4" }), children: t('notifications.settings') })] })] }), _jsx(Tabs, { variant: "pills", value: tab, onChange: (v) => setTab(v), children: _jsxs(Tabs.List, { children: [_jsxs(Tabs.Tab, { id: "all", children: [t('notifications.all'), " ", counts.all] }), _jsxs(Tabs.Tab, { id: "unread_tab", children: [t('notifications.unread_tab'), " ", counts.unread] }), _jsxs(Tabs.Tab, { id: "social", children: [t('notifications.social'), " ", counts.social] }), _jsxs(Tabs.Tab, { id: "match", children: [t('notifications.match'), " ", counts.match] }), _jsxs(Tabs.Tab, { id: "guild", children: [t('notifications.guild'), " ", counts.guild] }), _jsxs(Tabs.Tab, { id: "system", children: [t('notifications.system'), " ", counts.system] })] }) }), _jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:gap-6", children: [_jsx(Card, { className: "flex-1 flex-col gap-2 p-4", children: list.isLoading ? (_jsx("div", { className: "flex flex-col gap-3 p-4", children: Array.from({ length: 5 }).map((_, i) => (_jsx("div", { className: "h-16 animate-pulse rounded bg-surface-2" }, i))) })) : items.length === 0 ? (_jsx("div", { className: "p-8 text-center text-sm text-text-secondary", children: t('notifications.empty', 'Пока тихо — никаких уведомлений.') })) : (_jsxs(_Fragment, { children: [_jsx(Group, { label: t('notifications.today'), items: grouped.today, render: renderRow }), _jsx(Group, { label: t('notifications.yesterday'), items: grouped.yesterday, render: renderRow }), _jsx(Group, { label: t('notifications.this_week'), items: grouped.this_week, render: renderRow }), _jsx(Group, { label: t('notifications.older', 'РАНЬШЕ'), items: grouped.older, render: renderRow })] })) }), _jsx("div", { className: "flex w-full flex-col gap-4 lg:w-[320px]", children: _jsx(SettingsPanel, {}) })] })] }) }));
}
