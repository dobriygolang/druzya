import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { Check, Settings, Swords, Trophy, Sparkles, Shield, Award, Bell, Users, Server, Mail, Send, MessageCircle, Code as GithubIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
const Github = GithubIcon;
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Tabs } from '../components/Tabs';
import { useNotificationsQuery } from '../lib/queries/notifications';
function ErrorChip() {
    const { t } = useTranslation('pages');
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: t('common.load_failed') }));
}
function Row({ n }) {
    return (_jsxs("div", { className: "flex items-start gap-3 px-[14px] py-3", children: [_jsx("span", { className: `mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${n.unread ? 'bg-accent' : 'bg-transparent'}` }), _jsx("span", { className: `grid h-10 w-10 shrink-0 place-items-center rounded-full ${n.bg}`, children: n.icon }), _jsxs("div", { className: "flex flex-1 flex-col gap-1", children: [_jsx("div", { className: "text-sm text-text-primary", children: n.body }), _jsxs("div", { className: "flex items-center gap-2 text-[11px] text-text-muted", children: [_jsx("span", { children: n.sub }), _jsx("span", { children: "\u00B7" }), _jsx("span", { className: "font-mono", children: n.time })] }), n.actions] })] }));
}
const TODAY = [
    {
        unread: true,
        icon: _jsx(Swords, { className: "h-4 w-4 text-accent-hover" }), bg: 'bg-accent/15',
        body: _jsxs(_Fragment, { children: [_jsx("b", { className: "font-semibold", children: "@kirill_dev" }), " \u0431\u0440\u043E\u0441\u0438\u043B \u0432\u044B\u0437\u043E\u0432 \u00B7 Ranked 1v1"] }),
        sub: 'Diamond I · принять до 18:30', time: '5 мин',
        actions: (_jsxs("div", { className: "flex gap-2 pt-1", children: [_jsx(Button, { size: "sm", variant: "primary", children: "\u041F\u0440\u0438\u043D\u044F\u0442\u044C" }), _jsx(Button, { size: "sm", variant: "ghost", children: "\u041E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C" })] })),
    },
    {
        unread: true,
        icon: _jsx(Trophy, { className: "h-4 w-4 text-success" }), bg: 'bg-success/15',
        body: _jsxs(_Fragment, { children: ["\u041F\u043E\u0431\u0435\u0434\u0430 vs ", _jsx("b", { className: "font-semibold", children: "@vasya_rs" }), " \u00B7 +18 LP"] }),
        sub: 'Median of Two Sorted Arrays · O(log n)', time: '1 ч',
        actions: _jsx("button", { className: "pt-1 text-left text-xs font-semibold text-accent-hover hover:text-accent", children: "\u041F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C replay \u2192" }),
    },
    {
        unread: true,
        icon: _jsx(Sparkles, { className: "h-4 w-4 text-pink" }), bg: 'bg-pink/15',
        body: _jsxs(_Fragment, { children: ["AI \u043D\u0430\u0441\u0442\u0430\u0432\u043D\u0438\u043A: ", _jsx("b", { className: "font-semibold", children: "\u043D\u043E\u0432\u044B\u0439 \u043F\u043B\u0430\u043D \u043D\u0430 \u043D\u0435\u0434\u0435\u043B\u044E" }), " \u0433\u043E\u0442\u043E\u0432"] }),
        sub: 'Фокус: dynamic programming · 5 шагов', time: '3 ч',
        actions: _jsx("button", { className: "pt-1 text-left text-xs font-semibold text-accent-hover hover:text-accent", children: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u043B\u0430\u043D \u2192" }),
    },
    {
        unread: true,
        icon: _jsx(Shield, { className: "h-4 w-4 text-cyan" }), bg: 'bg-cyan/15',
        body: _jsxs(_Fragment, { children: ["\u0412\u043E\u0439\u043D\u0430 \u0433\u0438\u043B\u044C\u0434\u0438\u0439: ", _jsx("b", { className: "font-semibold", children: "Ironclad" }), " \u0432\u0435\u0434\u0451\u0442 2 140 \u2014 1 670"] }),
        sub: 'твой вклад: 240 очков · финал через 2д 4ч', time: '5 ч',
    },
    {
        unread: true,
        icon: _jsx(Award, { className: "h-4 w-4 text-warn" }), bg: 'bg-warn/15',
        body: _jsxs(_Fragment, { children: ["\u041F\u043E\u043B\u0443\u0447\u0435\u043D \u0430\u0447\u0438\u0432\u043C\u0435\u043D\u0442 ", _jsx("b", { className: "font-semibold", children: "Speed Demon" }), " \u00B7 +500 XP"] }),
        sub: '10 задач под 5 минут подряд', time: '8 ч',
    },
];
const YESTERDAY = [
    { icon: _jsx(Users, { className: "h-4 w-4 text-accent-hover" }), bg: 'bg-accent/15', body: _jsxs(_Fragment, { children: [_jsx("b", { children: "@nastya_codes" }), " \u0434\u043E\u0431\u0430\u0432\u0438\u043B\u0430 \u0442\u0435\u0431\u044F \u0432 \u0434\u0440\u0443\u0437\u044C\u044F"] }), sub: '12 общих друзей', time: 'вчера 21:14' },
    { icon: _jsx(Trophy, { className: "h-4 w-4 text-warn" }), bg: 'bg-warn/15', body: _jsxs(_Fragment, { children: ["\u041F\u043E\u0434\u043D\u044F\u043B\u0441\u044F \u0432 \u0440\u0435\u0439\u0442\u0438\u043D\u0433\u0435: ", _jsx("b", { children: "Diamond III" })] }), sub: '+124 LP за день · топ-12 друзей', time: 'вчера 19:02' },
    { icon: _jsx(Bell, { className: "h-4 w-4 text-pink" }), bg: 'bg-pink/15', body: _jsx(_Fragment, { children: "Streak Freeze \u0430\u043A\u0442\u0438\u0432\u0438\u0440\u043E\u0432\u0430\u043D \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438" }), sub: 'у тебя 2 заморозки осталось', time: 'вчера 04:00' },
    { icon: _jsx(Server, { className: "h-4 w-4 text-text-secondary" }), bg: 'bg-surface-3', body: _jsx(_Fragment, { children: "\u0420\u0435\u043B\u0438\u0437 v2.4 \u00B7 \u043D\u043E\u0432\u044B\u0435 AI-\u043C\u043E\u0434\u0435\u043B\u0438" }), sub: 'Sonnet 4.5 теперь по умолчанию', time: 'вчера 12:30' },
];
const KIND_VISUAL = {
    challenge: { icon: _jsx(Swords, { className: "h-4 w-4 text-accent-hover" }), bg: 'bg-accent/15' },
    win: { icon: _jsx(Trophy, { className: "h-4 w-4 text-success" }), bg: 'bg-success/15' },
    ai: { icon: _jsx(Sparkles, { className: "h-4 w-4 text-pink" }), bg: 'bg-pink/15' },
    guild: { icon: _jsx(Shield, { className: "h-4 w-4 text-cyan" }), bg: 'bg-cyan/15' },
    achievement: { icon: _jsx(Award, { className: "h-4 w-4 text-warn" }), bg: 'bg-warn/15' },
    friend: { icon: _jsx(Users, { className: "h-4 w-4 text-accent-hover" }), bg: 'bg-accent/15' },
    rank: { icon: _jsx(Trophy, { className: "h-4 w-4 text-warn" }), bg: 'bg-warn/15' },
    streak: { icon: _jsx(Bell, { className: "h-4 w-4 text-pink" }), bg: 'bg-pink/15' },
    system: { icon: _jsx(Server, { className: "h-4 w-4 text-text-secondary" }), bg: 'bg-surface-3' },
};
function fromApi(n) {
    const v = KIND_VISUAL[n.kind];
    return {
        unread: n.unread,
        icon: v.icon,
        bg: v.bg,
        body: _jsx(_Fragment, { children: n.title }),
        sub: n.subtitle,
        time: n.time,
    };
}
export default function NotificationsPage() {
    const { t } = useTranslation('pages');
    const [tab, setTab] = useState('all');
    const { data, isError } = useNotificationsQuery();
    const unread = data?.unread ?? 12;
    const tabs = data?.tabs ?? { all: 47, unread: 12, social: 8, match: 18, guild: 9, system: 12 };
    const todayList = data?.items ? data.items.filter((n) => n.bucket === 'today').map(fromApi) : TODAY;
    const yestList = data?.items ? data.items.filter((n) => n.bucket === 'yesterday').map(fromApi) : YESTERDAY;
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8", children: [_jsxs("div", { className: "flex flex-col items-start gap-3 lg:flex-row lg:items-end lg:justify-between", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("h1", { className: "font-display text-2xl lg:text-[32px] font-bold text-text-primary", children: t('notifications.title') }), _jsx("p", { className: "text-sm text-text-secondary", children: t('notifications.unread', { n: unread }) }), isError && _jsx(ErrorChip, {})] }), _jsxs("div", { className: "flex flex-wrap gap-3", children: [_jsx(Button, { variant: "ghost", icon: _jsx(Check, { className: "h-4 w-4" }), children: t('notifications.mark_all') }), _jsx(Button, { variant: "ghost", icon: _jsx(Settings, { className: "h-4 w-4" }), children: t('notifications.settings') })] })] }), _jsx(Tabs, { variant: "pills", value: tab, onChange: setTab, children: _jsxs(Tabs.List, { children: [_jsxs(Tabs.Tab, { id: "all", children: [t('notifications.all'), " ", tabs.all] }), _jsxs(Tabs.Tab, { id: "unread", children: [t('notifications.unread_tab'), " ", tabs.unread] }), _jsxs(Tabs.Tab, { id: "social", children: [t('notifications.social'), " ", tabs.social] }), _jsxs(Tabs.Tab, { id: "match", children: [t('notifications.match'), " ", tabs.match] }), _jsxs(Tabs.Tab, { id: "guild", children: [t('notifications.guild'), " ", tabs.guild] }), _jsxs(Tabs.Tab, { id: "sys", children: [t('notifications.system'), " ", tabs.system] })] }) }), _jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:gap-6", children: [_jsxs(Card, { className: "flex-1 flex-col gap-2 p-4", children: [_jsx("div", { className: "px-2 pt-2", children: _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: t('notifications.today') }) }), _jsx("div", { className: "flex flex-col divide-y divide-border", children: todayList.map((n, i) => _jsx(Row, { n: n }, i)) }), _jsx("div", { className: "px-2 pt-4", children: _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: t('notifications.yesterday') }) }), _jsx("div", { className: "flex flex-col divide-y divide-border", children: yestList.map((n, i) => _jsx(Row, { n: n }, i)) }), _jsxs("div", { className: "flex items-center justify-between px-3 pt-5", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: t('notifications.this_week') }), _jsx("button", { className: "text-xs font-semibold text-accent-hover hover:text-accent", children: t('notifications.expand') })] })] }), _jsxs("div", { className: "flex w-full flex-col gap-4 lg:w-[320px]", children: [_jsxs(Card, { className: "flex-col gap-2 p-5", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: t('notifications.filters') }), [
                                            { icon: _jsx(Swords, { className: "h-3.5 w-3.5 text-accent-hover" }), l: 'Вызовы', c: 4 },
                                            { icon: _jsx(Trophy, { className: "h-3.5 w-3.5 text-success" }), l: 'Победы', c: 9 },
                                            { icon: _jsx(Users, { className: "h-3.5 w-3.5 text-pink" }), l: 'Заявки', c: 3 },
                                            { icon: _jsx(Shield, { className: "h-3.5 w-3.5 text-cyan" }), l: 'Гильдия', c: 9 },
                                            { icon: _jsx(Server, { className: "h-3.5 w-3.5 text-text-secondary" }), l: 'Система', c: 12 },
                                        ].map((r) => (_jsxs("div", { className: "flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2", children: [_jsx("span", { className: "grid h-6 w-6 place-items-center rounded-md bg-surface-2", children: r.icon }), _jsx("span", { className: "flex-1 text-[13px] text-text-secondary", children: r.l }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: r.c })] }, r.l)))] }), _jsxs(Card, { className: "flex-col gap-3 p-5", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: t('notifications.silence') }), [{ l: 'DND до 09:00', on: true }, { l: 'Выкл. на матчах', on: false }].map((t) => (_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[13px] text-text-secondary", children: t.l }), _jsx("span", { className: `flex h-5 w-9 items-center rounded-full ${t.on ? 'bg-accent justify-end' : 'bg-surface-3 justify-start'} px-0.5`, children: _jsx("span", { className: "h-4 w-4 rounded-full bg-text-primary" }) })] }, t.l)))] }), _jsxs(Card, { className: "flex-col gap-3 p-5", children: [_jsx("h3", { className: "font-display text-sm font-bold text-text-primary", children: t('notifications.channels') }), [
                                            { icon: _jsx(Mail, { className: "h-3.5 w-3.5" }), l: 'Email', on: true },
                                            { icon: _jsx(Bell, { className: "h-3.5 w-3.5" }), l: 'Push', on: true },
                                            { icon: _jsx(Send, { className: "h-3.5 w-3.5" }), l: 'Telegram', on: true },
                                            { icon: _jsx(MessageCircle, { className: "h-3.5 w-3.5" }), l: 'Discord', on: false },
                                        ].map((c) => (_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("span", { className: "flex items-center gap-2 text-[13px] text-text-secondary", children: [c.icon, " ", c.l] }), _jsx("span", { className: `flex h-5 w-9 items-center rounded-full ${c.on ? 'bg-accent justify-end' : 'bg-surface-3 justify-start'} px-0.5`, children: _jsx("span", { className: "h-4 w-4 rounded-full bg-text-primary" }) })] }, c.l))), _jsx("div", { className: "hidden", children: _jsx(Github, { className: "h-3 w-3" }) })] })] })] })] }) }));
}
