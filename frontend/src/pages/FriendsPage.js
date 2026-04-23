import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { Copy, UserPlus, Swords, MessageSquare, Check, X, UserMinus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { Tabs } from '../components/Tabs';
import { useFriendsQuery, useIncomingFriendsQuery, useFriendSuggestionsQuery, useFriendCodeQuery, useBlockedFriendsQuery, useAddFriend, useAcceptFriend, useDeclineFriend, useUnfriend, useUnblockUser, recentSorted, } from '../lib/queries/friends';
function ErrorChip() {
    const { t } = useTranslation('pages');
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: t('common.load_failed') }));
}
const GRADIENTS = ['violet-cyan', 'pink-violet', 'cyan-violet', 'pink-red', 'success-cyan', 'gold'];
// hashGradient — стабильный выбор градиента по строке (username/uid),
// чтобы цвет аватарки не прыгал между ре-рендерами.
function hashGradient(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++)
        h = (h * 31 + seed.charCodeAt(i)) | 0;
    return GRADIENTS[Math.abs(h) % GRADIENTS.length];
}
function FriendCard({ f, onChallenge, onChat, onUnfriend, }) {
    const { t } = useTranslation('pages');
    const initial = (f.display_name || f.username || '?').charAt(0).toUpperCase();
    const tier = f.tier || t('friends.tier_unranked', 'Unranked');
    const status = f.online ? t('friends.online') : f.last_match_at ? new Date(f.last_match_at).toLocaleDateString() : t('friends.never_played', 'Не играли');
    return (_jsxs(Card, { className: `flex-col gap-3 p-5 ${f.online ? '' : 'opacity-70'}`, children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Avatar, { size: "lg", gradient: hashGradient(f.user_id), initials: initial, status: f.online ? 'online' : 'offline' }), _jsxs("div", { className: "flex flex-1 flex-col gap-0.5", children: [_jsxs("span", { className: "font-display text-sm font-bold text-text-primary", children: ["@", f.username] }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: tier })] })] }), _jsx("span", { className: `inline-flex w-fit items-center rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold ${f.online ? 'bg-accent/15 text-accent-hover' : 'bg-surface-2 text-text-muted'}`, children: status }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { size: "sm", variant: "primary", icon: _jsx(Swords, { className: "h-3.5 w-3.5" }), className: "flex-1", onClick: onChallenge, children: t('friends.challenge') }), _jsx(Button, { size: "sm", variant: "ghost", icon: _jsx(MessageSquare, { className: "h-3.5 w-3.5" }), className: "flex-1", onClick: onChat, title: t('friends.chat_wip', 'Скоро'), children: t('friends.chat') }), _jsx("button", { type: "button", onClick: onUnfriend, className: "grid h-8 w-8 place-items-center rounded-md bg-danger/10 text-danger hover:bg-danger/25", title: t('friends.unfriend', 'Удалить из друзей'), children: _jsx(UserMinus, { className: "h-4 w-4" }) })] })] }));
}
function SuggestionRow({ f, onAdd, busy }) {
    const { t } = useTranslation('pages');
    const initial = (f.display_name || f.username || '?').charAt(0).toUpperCase();
    return (_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Avatar, { size: "sm", gradient: hashGradient(f.user_id), initials: initial }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsxs("span", { className: "text-sm font-semibold text-text-primary", children: ["@", f.username] }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: f.tier || '' })] }), _jsx("button", { type: "button", disabled: busy, onClick: onAdd, className: "text-xs font-semibold text-accent-hover hover:text-accent disabled:opacity-50", children: t('friends.add') })] }));
}
function IncomingRow({ r, onAccept, onDecline, busy, }) {
    const initial = (r.display_name || r.username || '?').charAt(0).toUpperCase();
    return (_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Avatar, { size: "md", gradient: hashGradient(r.user_id), initials: initial }), _jsxs("div", { className: "flex flex-1 flex-col gap-0.5", children: [_jsxs("span", { className: "text-sm font-semibold text-text-primary", children: ["@", r.username] }), _jsx("span", { className: "text-[11px] text-text-muted", children: r.tier || '' })] }), _jsx("button", { type: "button", disabled: busy, onClick: onAccept, className: "grid h-8 w-8 place-items-center rounded-md bg-success/15 text-success hover:bg-success/25 disabled:opacity-50", children: _jsx(Check, { className: "h-4 w-4" }) }), _jsx("button", { type: "button", disabled: busy, onClick: onDecline, className: "grid h-8 w-8 place-items-center rounded-md bg-danger/15 text-danger hover:bg-danger/25 disabled:opacity-50", children: _jsx(X, { className: "h-4 w-4" }) })] }));
}
function CardSkeleton() {
    return (_jsx("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4", children: Array.from({ length: 4 }).map((_, i) => (_jsx("div", { className: "h-[180px] animate-pulse rounded-2xl bg-surface-2" }, i))) }));
}
function FindByCodeCard() {
    const { t } = useTranslation('pages');
    const [code, setCode] = useState('');
    const add = useAddFriend();
    const onSubmit = () => {
        if (!code.trim())
            return;
        add.mutate({ code: code.trim() }, { onSettled: () => setCode('') });
    };
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: t('friends.find_by_code') }), _jsxs("div", { className: "flex gap-2", children: [_jsx("input", { value: code, onChange: (e) => setCode(e.target.value), onKeyDown: (e) => {
                            if (e.key === 'Enter')
                                onSubmit();
                        }, className: "h-9 flex-1 rounded-md border border-border bg-surface-2 px-3 font-mono text-[13px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none", placeholder: "DRUZ9-XXXX-XXX" }), _jsx(Button, { size: "sm", variant: "primary", disabled: add.isPending, onClick: onSubmit, children: t('friends.find_btn') })] }), add.isError && (_jsx("span", { className: "text-[11px] text-danger", children: t('friends.code_error', 'Код не найден или истёк.') })), add.isSuccess && add.data?.already && (_jsx("span", { className: "text-[11px] text-text-muted", children: t('friends.already_friends', 'Уже в списке.') }))] }));
}
export default function FriendsPage() {
    const { t } = useTranslation('pages');
    const navigate = useNavigate();
    const [tab, setTab] = useState('all');
    const friends = useFriendsQuery();
    const incoming = useIncomingFriendsQuery();
    const suggestions = useFriendSuggestionsQuery();
    const code = useFriendCodeQuery();
    const blocked = useBlockedFriendsQuery();
    const accept = useAcceptFriend();
    const decline = useDeclineFriend();
    const unfriend = useUnfriend();
    const unblock = useUnblockUser();
    const add = useAddFriend();
    const isError = friends.isError || incoming.isError;
    // Stabilise the accepted reference: `friends.data?.accepted ?? []` would
    // recreate the empty array on every render and break the useMemo deps.
    const accepted = useMemo(() => friends.data?.accepted ?? [], [friends.data?.accepted]);
    const onlineList = useMemo(() => accepted.filter((f) => f.online), [accepted]);
    const offlineList = useMemo(() => accepted.filter((f) => !f.online), [accepted]);
    const recentList = useMemo(() => recentSorted(accepted), [accepted]);
    const incomingList = incoming.data ?? [];
    const suggestionList = suggestions.data ?? [];
    const blockedList = blocked.data ?? [];
    const counts = {
        online: friends.data?.online_count ?? 0,
        total: friends.data?.total ?? accepted.length,
        requests: incomingList.length,
        guild: 0, // TODO: guild-membership ещё не выставлен в friends API
        blocked: blockedList.length,
    };
    const friendCode = code.data?.code ?? '...';
    const handleChallenge = (uid) => navigate(`/arena?opponent=${encodeURIComponent(uid)}`);
    const handleChat = () => {
        /* chat-страница ещё не существует — кнопка disabled через title */
    };
    const visibleAll = tab === 'all';
    const visibleOnline = tab === 'online';
    const visibleRequests = tab === 'requests';
    const visibleBlocked = tab === 'blocked';
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8", children: [_jsxs("div", { className: "flex flex-col items-start gap-3 lg:flex-row lg:items-end lg:justify-between", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("h1", { className: "font-display text-2xl lg:text-[32px] font-bold text-text-primary", children: t('friends.title') }), _jsx("p", { className: "text-sm text-text-secondary", children: t('friends.summary', { online: counts.online, total: counts.total, requests: counts.requests }) }), isError && _jsx(ErrorChip, {})] }), _jsx("div", { className: "flex flex-wrap gap-3", children: _jsx(Button, { variant: "ghost", icon: _jsx(Copy, { className: "h-4 w-4" }), onClick: () => {
                                    if (typeof window !== 'undefined' && navigator.clipboard && code.data?.code) {
                                        void navigator.clipboard.writeText(code.data.code);
                                    }
                                }, title: t('friends.copy_code', 'Скопировать код'), children: _jsx("span", { className: "font-mono text-xs", children: friendCode }) }) })] }), _jsx(Tabs, { variant: "pills", value: tab, onChange: (v) => setTab(v), children: _jsxs(Tabs.List, { children: [_jsxs(Tabs.Tab, { id: "all", children: [t('friends.all'), " ", counts.total] }), _jsxs(Tabs.Tab, { id: "online", children: [t('friends.online'), " ", counts.online] }), _jsx(Tabs.Tab, { id: "requests", children: _jsxs("span", { className: "inline-flex items-center gap-1.5", children: [t('friends.requests'), " ", counts.requests, counts.requests > 0 && _jsx("span", { className: "h-1.5 w-1.5 rounded-full bg-danger" })] }) }), _jsxs(Tabs.Tab, { id: "guild", children: [t('friends.guild'), " ", counts.guild] }), _jsxs(Tabs.Tab, { id: "blocked", children: [t('friends.blocked'), " ", counts.blocked] })] }) }), _jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:gap-6", children: [_jsxs("div", { className: "flex flex-1 flex-col gap-6", children: [(visibleAll || visibleOnline) && (_jsxs("div", { className: "flex flex-col gap-3", children: [_jsx("h2", { className: "font-display text-lg font-bold text-text-primary", children: t('friends.online_now', { n: onlineList.length }) }), friends.isLoading ? (_jsx(CardSkeleton, {})) : onlineList.length === 0 ? (_jsx(Card, { className: "p-6 text-sm text-text-secondary", children: t('friends.empty_online', 'Никого нет онлайн.') })) : (_jsx("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4", children: onlineList.map((f) => (_jsx(FriendCard, { f: f, onChallenge: () => handleChallenge(f.user_id), onChat: handleChat, onUnfriend: () => unfriend.mutate(f.user_id) }, f.user_id))) }))] })), visibleAll && (_jsxs("div", { className: "flex flex-col gap-3", children: [_jsx("h2", { className: "font-display text-lg font-bold text-text-primary", children: t('friends.recent') }), friends.isLoading ? (_jsx(CardSkeleton, {})) : recentList.length === 0 ? (_jsx(Card, { className: "p-6 text-sm text-text-secondary", children: t('friends.empty_friends', 'Список друзей пуст — добавь кого-нибудь!') })) : (_jsx("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4", children: recentList.map((f) => (_jsx(FriendCard, { f: f, onChallenge: () => handleChallenge(f.user_id), onChat: handleChat, onUnfriend: () => unfriend.mutate(f.user_id) }, f.user_id))) }))] })), visibleOnline && offlineList.length > 0 && (_jsxs("div", { className: "flex flex-col gap-3", children: [_jsx("h2", { className: "font-display text-lg font-bold text-text-primary", children: t('friends.offline', 'Оффлайн') }), _jsx("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4", children: offlineList.map((f) => (_jsx(FriendCard, { f: f, onChallenge: () => handleChallenge(f.user_id), onChat: handleChat, onUnfriend: () => unfriend.mutate(f.user_id) }, f.user_id))) })] })), visibleRequests && (_jsxs("div", { className: "flex flex-col gap-3", children: [_jsx("h2", { className: "font-display text-lg font-bold text-text-primary", children: t('friends.incoming') }), incoming.isLoading ? (_jsx(Card, { className: "h-24 animate-pulse" })) : incomingList.length === 0 ? (_jsx(Card, { className: "p-6 text-sm text-text-secondary", children: t('friends.empty_requests', 'Заявок нет.') })) : (_jsx(Card, { className: "flex-col gap-3 border-accent/40 p-5", children: incomingList.map((r) => (_jsx(IncomingRow, { r: r, busy: accept.isPending || decline.isPending, onAccept: () => r.friendship_id && accept.mutate(r.friendship_id), onDecline: () => r.friendship_id && decline.mutate(r.friendship_id) }, r.user_id))) }))] })), visibleBlocked && (_jsxs("div", { className: "flex flex-col gap-3", children: [_jsx("h2", { className: "font-display text-lg font-bold text-text-primary", children: t('friends.blocked') }), blocked.isLoading ? (_jsx(Card, { className: "h-24 animate-pulse" })) : blockedList.length === 0 ? (_jsx(Card, { className: "p-6 text-sm text-text-secondary", children: t('friends.empty_blocked', 'Список заблокированных пуст.') })) : (_jsx(Card, { className: "flex-col gap-2 p-5", children: blockedList.map((b) => (_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Avatar, { size: "sm", gradient: hashGradient(b.user_id), initials: (b.username || '?').charAt(0).toUpperCase() }), _jsxs("span", { className: "flex-1 text-sm text-text-primary", children: ["@", b.username] }), _jsx("button", { type: "button", onClick: () => unblock.mutate(b.user_id), disabled: unblock.isPending, className: "text-xs font-semibold text-accent-hover hover:text-accent disabled:opacity-50", children: t('friends.unblock', 'Разблок') })] }, b.user_id))) }))] }))] }), _jsxs("div", { className: "flex w-full flex-col gap-4 lg:w-[380px]", children: [_jsxs(Card, { className: "flex-col gap-3 border-accent/40 p-5", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: t('friends.incoming') }), incoming.isLoading ? (_jsx("div", { className: "h-16 animate-pulse rounded bg-surface-2" })) : incomingList.length === 0 ? (_jsx("span", { className: "text-[12px] text-text-secondary", children: t('friends.empty_requests', 'Заявок нет.') })) : (incomingList.slice(0, 4).map((r) => (_jsx(IncomingRow, { r: r, busy: accept.isPending || decline.isPending, onAccept: () => r.friendship_id && accept.mutate(r.friendship_id), onDecline: () => r.friendship_id && decline.mutate(r.friendship_id) }, r.user_id))))] }), _jsxs(Card, { className: "flex-col gap-3 p-5", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: t('friends.suggestions') }), suggestions.isLoading ? (_jsx("div", { className: "h-16 animate-pulse rounded bg-surface-2" })) : suggestionList.length === 0 ? (_jsx("span", { className: "text-[12px] text-text-secondary", children: t('friends.empty_suggestions', 'Пока никого не рекомендуем.') })) : (suggestionList.map((s) => (_jsx(SuggestionRow, { f: s, busy: add.isPending, onAdd: () => add.mutate({ user_id: s.user_id }) }, s.user_id))))] }), _jsx(FindByCodeCard, {}), _jsxs(Card, { className: "flex-col gap-2 p-5", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: t('friends.find', 'Найти друзей') }), _jsx("p", { className: "text-[12px] text-text-secondary", children: t('friends.share_code_hint', 'Поделись своим кодом с друзьями — они смогут добавить тебя моментально.') }), _jsx(Button, { variant: "ghost", icon: _jsx(UserPlus, { className: "h-4 w-4" }), onClick: () => {
                                                if (typeof window !== 'undefined' && navigator.clipboard && code.data?.code) {
                                                    void navigator.clipboard.writeText(code.data.code);
                                                }
                                            }, children: _jsx("span", { className: "font-mono text-xs", children: friendCode }) })] })] })] })] }) }));
}
