import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowRight, Check, Loader2, Lock, Plus, Sparkles, Swords, Users, Video, X, Zap, Lock as LockIcon, } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { useRatingMeQuery, useLeaderboardQuery } from '../lib/queries/rating';
import { useCancelSearchMutation, useFindMatchMutation, } from '../lib/queries/arena';
function HeaderRow() {
    const { t } = useTranslation('arena');
    const { data: rating, isError } = useRatingMeQuery();
    const totalMatches = rating?.ratings?.reduce((acc, r) => acc + r.matches_count, 0) ?? 0;
    return (_jsxs("div", { className: "flex flex-col items-start gap-4 lg:flex-row lg:items-end lg:justify-between", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("h1", { className: "font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[32px]", children: t('title') }), _jsx("p", { className: "text-sm text-text-secondary", children: isError
                            ? t('subtitle_error')
                            : t('subtitle_played', { count: totalMatches }) })] }), _jsxs("div", { className: "flex items-center gap-3 rounded-xl border border-border bg-surface-1 px-4 py-2.5", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: t('party') }), _jsx("div", { className: "h-4 w-px bg-border" }), _jsx(Avatar, { size: "sm", gradient: "violet-cyan", initials: "\u0414" }), _jsx(Button, { variant: "ghost", size: "sm", className: "px-3", children: t('solo') })] })] }));
}
const SECTIONS = ['algorithms', 'sql', 'go', 'system_design', 'behavioral'];
function HeroQueue({ inQueue, waitSeconds, isSubmitting, errorMessage, selectedSection, onSelectSection, onFind, onCancel, }) {
    const { t } = useTranslation('arena');
    return (_jsxs("div", { className: "flex w-full flex-col items-start justify-between gap-4 rounded-xl border border-border-strong bg-gradient-to-br from-surface-2 to-surface-3 p-5 shadow-card sm:p-7 lg:flex-row lg:items-center", children: [_jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-accent-hover", children: [_jsx(Swords, { className: "h-3 w-3" }), " ", t('ranked_1v1_tag')] }), _jsx("h2", { className: "font-display text-[28px] font-bold text-text-primary", children: inQueue
                            ? t('searching_for_opponent', {
                                defaultValue: 'Ищем противника… {{sec}}s',
                                sec: waitSeconds,
                            })
                            : t('ready_for_match') }), _jsx("div", { className: "flex flex-wrap gap-1.5", children: SECTIONS.map((s) => (_jsx("button", { type: "button", disabled: inQueue || isSubmitting, onClick: () => onSelectSection(s), className: [
                                'rounded-full px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors',
                                selectedSection === s
                                    ? 'bg-accent text-bg'
                                    : 'border border-border bg-surface-1 text-text-secondary hover:bg-surface-2',
                                inQueue || isSubmitting ? 'cursor-not-allowed opacity-60' : '',
                            ].join(' '), children: s }, s))) }), errorMessage && (_jsx("p", { className: "font-mono text-xs text-danger", children: errorMessage }))] }), inQueue ? (_jsx(Button, { variant: "ghost", icon: _jsx(X, { className: "h-[18px] w-[18px]" }), className: "px-6 py-3.5 text-sm", onClick: onCancel, disabled: isSubmitting, children: t('cancel_search', { defaultValue: 'Отменить' }) })) : (_jsx(Button, { variant: "primary", icon: isSubmitting ? (_jsx(Loader2, { className: "h-[18px] w-[18px] animate-spin" })) : (_jsx(Swords, { className: "h-[18px] w-[18px]" })), iconRight: _jsx(ArrowRight, { className: "h-4 w-4" }), className: "px-6 py-3.5 text-sm shadow-glow", onClick: onFind, disabled: isSubmitting, children: t('find_opponent') }))] }));
}
const MODELS = [
    { name: 'GPT-4o', tier: 'OpenAI', free: true },
    { name: 'Sonnet 4.5', tier: 'Anthropic', free: true },
    { name: 'GPT-5', tier: 'OpenAI', free: false, price: '₽490/мес' },
    { name: 'Opus 4.5', tier: 'Anthropic', free: false, price: '₽790/мес' },
    { name: 'Custom', tier: 'Свой ключ', free: false, price: '₽290/мес' },
];
function ModelTile({ m }) {
    return (_jsxs("div", { className: [
            'flex h-[140px] flex-1 flex-col justify-between rounded-lg border p-3.5',
            m.free
                ? 'border-border bg-surface-1'
                : 'border-border bg-surface-1 opacity-70',
        ].join(' '), children: [_jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex flex-col gap-0.5", children: [_jsx("span", { className: "font-display text-sm font-bold text-text-primary", children: m.name }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: m.tier })] }), m.free ? (_jsx("span", { className: "grid h-6 w-6 place-items-center rounded-full bg-success/20", children: _jsx(Check, { className: "h-3.5 w-3.5 text-success" }) })) : (_jsx("span", { className: "grid h-6 w-6 place-items-center rounded-full bg-surface-3", children: _jsx(Lock, { className: "h-3.5 w-3.5 text-text-muted" }) }))] }), _jsxs("div", { className: "flex items-center justify-between", children: [m.free ? (_jsx("span", { className: "rounded-full bg-success/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-success", children: "FREE" })) : (_jsx("span", { className: "rounded-full bg-warn/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-warn", children: "PRO" })), !m.free && m.price && (_jsx("span", { className: "font-mono text-[10px] text-text-muted", children: m.price }))] })] }));
}
function AiPanel() {
    const { t } = useTranslation('arena');
    return (_jsxs(Card, { className: "flex-col gap-4 p-5 lg:h-[220px]", interactive: false, children: [_jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex flex-col gap-1", children: [_jsxs("h3", { className: "flex items-center gap-2 font-display text-lg font-bold text-text-primary", children: [_jsx(Sparkles, { className: "h-4 w-4 text-pink" }), t('ai_helper_title')] }), _jsx("p", { className: "text-xs text-text-secondary", children: t('ai_helper_desc') })] }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: t('models_count') })] }), _jsx("div", { className: "grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:min-w-0", children: MODELS.map((m) => (_jsx(ModelTile, { m: m }, m.name))) })] }));
}
const MODES = [
    {
        name: 'Ranked 1v1',
        desc: 'Классика. Алгоритмы, рейтинг, LP.',
        count: 412,
        time: '~12с',
        icon: _jsx(Swords, { className: "h-7 w-7 text-text-primary" }),
        gradient: 'from-accent to-pink',
    },
    {
        name: 'Casual 1v1',
        desc: 'Без рейтинга, для практики.',
        count: 286,
        time: '~8с',
        icon: _jsx(Zap, { className: "h-7 w-7 text-text-primary" }),
        gradient: 'from-cyan to-accent',
    },
    {
        name: 'Ranked 2v2',
        desc: 'Командный режим, парный код.',
        count: 168,
        time: '~24с',
        icon: _jsx(Users, { className: "h-7 w-7 text-text-primary" }),
        gradient: 'from-pink to-warn',
    },
    {
        name: 'Mock Interview',
        desc: 'Симуляция собеса с таймером.',
        count: 94,
        time: '~45с',
        icon: _jsx(Video, { className: "h-7 w-7 text-text-primary" }),
        gradient: 'from-success to-cyan',
    },
    {
        name: 'AI-allowed Interview',
        desc: 'Собес с разрешённым AI.',
        count: 132,
        time: '~30с',
        icon: _jsx(Sparkles, { className: "h-7 w-7 text-text-primary" }),
        gradient: 'from-warn to-danger',
    },
    {
        name: 'Custom Lobby',
        desc: 'Свои правила, лобби с кодом.',
        count: 48,
        time: '~60с',
        icon: _jsx(LockIcon, { className: "h-7 w-7 text-text-primary" }),
        gradient: 'from-surface-3 to-accent',
    },
];
function ModeCard({ m }) {
    const { t } = useTranslation('arena');
    return (_jsxs(Card, { className: "flex-1 flex-col gap-4 p-5", interactive: true, children: [_jsx("div", { className: `grid h-16 w-16 place-items-center rounded-xl bg-gradient-to-br ${m.gradient} shadow-card`, children: m.icon }), _jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: m.name }), _jsx("p", { className: "text-xs text-text-secondary", children: m.desc })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("span", { className: "relative flex h-2 w-2", children: [_jsx("span", { className: "absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" }), _jsx("span", { className: "relative inline-flex h-2 w-2 rounded-full bg-success" })] }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: t('in_queue', { count: m.count, time: m.time }) })] }), _jsx(Button, { variant: "ghost", size: "sm", className: "mt-auto w-full", children: t('enter') })] }));
}
function FriendsStrip() {
    const { t } = useTranslation('arena');
    const { data: lb } = useLeaderboardQuery('algorithms');
    const gradients = ['violet-cyan', 'pink-violet', 'cyan-violet', 'success-cyan'];
    const top = lb?.entries?.slice(0, 4) ?? [];
    const friends = top.length > 0
        ? top.map((e, i) => ({
            initials: e.username.charAt(0).toUpperCase(),
            username: `@${e.username}`,
            gradient: gradients[i % gradients.length],
        }))
        : [
            { initials: 'А', username: '@alexey', gradient: gradients[0] },
            { initials: 'К', username: '@kirill_dev', gradient: gradients[1] },
            { initials: 'Н', username: '@nastya', gradient: gradients[2] },
            { initials: 'М', username: '@misha', gradient: gradients[3] },
        ];
    return (_jsxs(Card, { className: "flex-col items-start justify-between gap-4 p-4 lg:flex-row lg:items-center", interactive: false, children: [_jsxs("div", { className: "flex min-w-0 flex-wrap items-center gap-4", children: [_jsx("span", { className: "font-display text-sm font-bold text-text-primary", children: t('friends_online', { count: friends.length }) }), _jsx("div", { className: "flex -space-x-2", children: friends.map((f, i) => (_jsx(Avatar, { size: "md", gradient: f.gradient, initials: f.initials, status: "online" }, i))) }), _jsx("span", { className: "min-w-0 break-words font-mono text-[11px] text-text-muted", children: friends.map((f) => f.username).join(' · ') })] }), _jsxs("button", { className: "inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-2 font-sans text-[13px] font-semibold text-accent-hover hover:bg-accent/20", children: [_jsx(Plus, { className: "h-3.5 w-3.5" }), t('create_party')] })] }));
}
export default function ArenaPage() {
    const { t } = useTranslation('arena');
    const navigate = useNavigate();
    const findMatch = useFindMatchMutation();
    const cancelSearch = useCancelSearchMutation();
    const [section, setSection] = useState('algorithms');
    const [mode] = useState('solo_1v1');
    const [inQueue, setInQueue] = useState(false);
    const [waitSec, setWaitSec] = useState(0);
    const [errorMsg, setErrorMsg] = useState(null);
    // Tick the wait counter while we are queued.
    useEffect(() => {
        if (!inQueue) {
            setWaitSec(0);
            return;
        }
        const id = window.setInterval(() => setWaitSec((s) => s + 1), 1000);
        return () => window.clearInterval(id);
    }, [inQueue]);
    const handleFind = () => {
        setErrorMsg(null);
        findMatch.mutate({ section, mode }, {
            onSuccess: (resp) => {
                if (resp.match_id) {
                    navigate(`/arena/match/${resp.match_id}`);
                    return;
                }
                setInQueue(true);
            },
            onError: (e) => {
                setErrorMsg(e.message ?? 'failed to enqueue');
            },
        });
    };
    const handleCancel = () => {
        cancelSearch.mutate(undefined, {
            onSettled: () => setInQueue(false),
        });
    };
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8", children: [_jsx(HeaderRow, {}), _jsx(HeroQueue, { inQueue: inQueue, waitSeconds: waitSec, isSubmitting: findMatch.isPending || cancelSearch.isPending, errorMessage: errorMsg, selectedSection: section, onSelectSection: setSection, onFind: handleFind, onCancel: handleCancel }), _jsx(AiPanel, {}), _jsxs("div", { className: "flex flex-col gap-4", children: [_jsxs("div", { className: "flex items-end justify-between", children: [_jsx("h2", { className: "font-display text-xl font-bold text-text-primary", children: t('all_modes') }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: t('modes_available') })] }), _jsx("div", { className: "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3", children: MODES.map((m) => (_jsx(ModeCard, { m: m }, m.name))) })] }), _jsx(FriendsStrip, {})] }) }));
}
