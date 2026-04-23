import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowRight, Check, Loader2, Sparkles, Swords, Users, Video, X, Zap, Bot, } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { useRatingMeQuery, useLeaderboardQuery } from '../lib/queries/rating';
import { useCancelSearchMutation, useCurrentMatchQuery, useFindMatchMutation, } from '../lib/queries/arena';
import { useAIModelsQuery } from '../lib/queries/ai';
import { useProfileQuery } from '../lib/queries/profile';
// Queue-wait timeout (seconds) — after this many seconds without a match we
// show the user a clear "никого нет в очереди" message and auto-cancel, so the
// UI никогда не висит молча. Bible §11 — no silent fallback.
const QUEUE_TIMEOUT_SEC = 60;
const SECTIONS = ['algorithms', 'sql', 'go', 'system_design', 'behavioral'];
function HeaderRow({ partyMode, onTogglePartyMode, }) {
    const { t } = useTranslation('arena');
    const { data: rating, isError } = useRatingMeQuery();
    const totalMatches = rating?.ratings?.reduce((acc, r) => acc + r.matches_count, 0) ?? 0;
    return (_jsxs("div", { className: "flex flex-col items-start gap-4 lg:flex-row lg:items-end lg:justify-between", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("h1", { className: "font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[32px]", children: t('title') }), _jsx("p", { className: "text-sm text-text-secondary", children: isError
                            ? t('subtitle_error')
                            : t('subtitle_played', { count: totalMatches }) })] }), _jsxs("div", { role: "tablist", "aria-label": "Party / Solo", className: "flex items-center gap-1 rounded-xl border border-border bg-surface-1 p-1", children: [_jsxs("button", { type: "button", role: "tab", "aria-selected": partyMode === 'solo', onClick: () => onTogglePartyMode('solo'), className: [
                            'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.08em] transition-colors',
                            partyMode === 'solo'
                                ? 'bg-accent text-text-primary shadow-glow'
                                : 'text-text-muted hover:text-text-primary',
                        ].join(' '), children: [_jsx(Avatar, { size: "sm", gradient: "violet-cyan", initials: "\u042F" }), t('solo')] }), _jsxs("button", { type: "button", role: "tab", "aria-selected": partyMode === 'party', onClick: () => onTogglePartyMode('party'), className: [
                            'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.08em] transition-colors',
                            partyMode === 'party'
                                ? 'bg-accent text-text-primary shadow-glow'
                                : 'text-text-muted hover:text-text-primary',
                        ].join(' '), children: [_jsx(Users, { className: "h-3.5 w-3.5" }), t('party')] })] })] }));
}
function HeroQueue({ inQueue, waitSeconds, isSubmitting, errorMessage, selectedSection, onSelectSection, onFind, onCancel, }) {
    const { t } = useTranslation('arena');
    return (_jsxs("div", { className: "flex w-full flex-col items-start justify-between gap-4 rounded-xl border border-border-strong bg-gradient-to-br from-surface-2 to-surface-3 p-5 shadow-card sm:p-7 lg:flex-row lg:items-center", children: [_jsxs("div", { className: "flex min-w-0 flex-col gap-3", children: [_jsxs("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-accent-hover", children: [_jsx(Swords, { className: "h-3 w-3" }), " ", t('ranked_1v1_tag')] }), _jsx("h2", { className: "font-display text-[28px] font-bold text-text-primary", children: inQueue
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
// DynamicModelTile renders an AI model from the live backend catalogue.
// Premium models are rendered with a 💎 badge. If the current user isn't
// premium, the tile is locked (visually + click ignored) with a tooltip.
function DynamicModelTile({ m, selected, locked, onSelect, }) {
    return (_jsxs("button", { type: "button", onClick: onSelect, disabled: locked, "aria-pressed": selected, title: locked ? 'Доступно с подпиской premium/pro' : undefined, className: [
            'flex h-full min-w-0 flex-col justify-between gap-2 rounded-lg border p-3.5 text-left transition-colors',
            selected
                ? 'border-accent bg-accent/10 shadow-glow'
                : locked
                    ? 'cursor-not-allowed border-border bg-surface-1 opacity-60'
                    : 'border-border bg-surface-1 hover:border-border-strong',
        ].join(' '), children: [_jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "flex min-w-0 flex-col gap-0.5", children: [_jsx("span", { className: "truncate font-display text-sm font-bold text-text-primary", children: m.label }), _jsx("span", { className: "truncate font-mono text-[10px] text-text-muted", children: m.provider })] }), selected ? (_jsx("span", { className: "grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/30", children: _jsx(Check, { className: "h-3.5 w-3.5 text-accent-hover" }) })) : (_jsx("span", { className: "grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-3", children: _jsx(Bot, { className: "h-3.5 w-3.5 text-text-muted" }) }))] }), _jsx("div", { className: "flex items-center justify-between gap-2", children: m.tier === 'free' ? (_jsx("span", { className: "rounded-full bg-success/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-success", children: "FREE" })) : (_jsx("span", { className: "rounded-full bg-warn/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-warn", children: "\uD83D\uDC8E PREMIUM" })) })] }));
}
function AiPanel({ selectedModel, onSelectModel, }) {
    const { t } = useTranslation('arena');
    // Real backend catalogue. When OPENROUTER_API_KEY is missing → items=[],
    // available=false → entire panel hidden (no fake models, anti-fallback).
    const ai = useAIModelsQuery();
    const profile = useProfileQuery();
    const userTier = profile.data?.tier ?? 'free';
    const isPremiumUser = userTier === 'premium' || userTier === 'pro';
    if (ai.isLoading) {
        return (_jsx(Card, { className: "flex-col gap-4 p-5", interactive: false, children: _jsx("div", { className: "h-24 animate-pulse rounded-lg bg-surface-2" }) }));
    }
    // No models available (key missing or backend unhealthy) — hide silently.
    if (ai.isError || !ai.data?.available || ai.data.items.length === 0) {
        return null;
    }
    const items = ai.data.items;
    const selectedItem = items.find((m) => m.id === selectedModel) ?? items[0];
    return (_jsxs(Card, { className: "flex-col gap-4 p-5", interactive: false, children: [_jsxs("div", { className: "flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center", children: [_jsxs("div", { className: "flex min-w-0 flex-col gap-1", children: [_jsxs("h3", { className: "flex items-center gap-2 font-display text-lg font-bold text-text-primary", children: [_jsx(Sparkles, { className: "h-4 w-4 text-pink" }), t('ai_opponent_title', { defaultValue: 'AI-соперник' })] }), _jsx("p", { className: "text-xs text-text-secondary", children: t('ai_opponent_desc', {
                                    defaultValue: 'Выбери модель — она будет играть за противника в Mock и AI-allowed режимах. Сохраняется автоматически.',
                                }) })] }), _jsx("span", { className: "shrink-0 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text-muted", children: t('current_model', {
                            defaultValue: 'текущая: {{name}}',
                            name: selectedItem?.label ?? '—',
                        }) })] }), _jsx("div", { className: "grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4", children: items.map((m) => {
                    const locked = m.tier === 'premium' && !isPremiumUser;
                    return (_jsx(DynamicModelTile, { m: m, selected: selectedModel === m.id, locked: locked, onSelect: () => {
                            if (locked)
                                return;
                            onSelectModel(m.id);
                        } }, m.id));
                }) })] }));
}
const MODES = [
    {
        key: 'ranked_1v1',
        name: 'Ranked 1v1',
        desc: 'Классика. Алгоритмы, рейтинг, LP.',
        count: 412,
        time: '~12с',
        icon: _jsx(Swords, { className: "h-7 w-7 text-text-primary" }),
        gradient: 'from-accent to-pink',
        arenaMode: 'ranked',
        requiresParty: false,
        aiPowered: false,
    },
    {
        key: 'casual_1v1',
        name: 'Casual 1v1',
        desc: 'Без рейтинга, для практики.',
        count: 286,
        time: '~8с',
        icon: _jsx(Zap, { className: "h-7 w-7 text-text-primary" }),
        gradient: 'from-cyan to-accent',
        arenaMode: 'solo_1v1',
        requiresParty: false,
        aiPowered: false,
    },
    {
        key: 'ranked_2v2',
        name: 'Ranked 2v2',
        desc: 'Командный режим, парный код.',
        count: 168,
        time: '~24с',
        icon: _jsx(Users, { className: "h-7 w-7 text-text-primary" }),
        gradient: 'from-pink to-warn',
        arenaMode: 'duo_2v2',
        requiresParty: true,
        aiPowered: false,
    },
    {
        key: 'mock',
        name: 'Mock Interview',
        desc: 'Симуляция собеса с таймером и AI-интервьюером.',
        count: 94,
        time: '~45с',
        icon: _jsx(Video, { className: "h-7 w-7 text-text-primary" }),
        gradient: 'from-success to-cyan',
        arenaMode: 'hardcore',
        requiresParty: false,
        aiPowered: true,
    },
    {
        key: 'ai_allowed',
        name: 'AI-allowed Interview',
        desc: 'Собес с разрешённым AI-помощником.',
        count: 132,
        time: '~30с',
        icon: _jsx(Sparkles, { className: "h-7 w-7 text-text-primary" }),
        gradient: 'from-warn to-danger',
        arenaMode: 'cursed',
        requiresParty: false,
        aiPowered: true,
    },
];
// Practice vs AI + Custom Lobby удалены (Wave-4 bugfix):
// - Practice: бот априори решал быстрее человека, + матч оказывался
//   в состоянии не ожидаемом WS-хабом ("match not in required state",
//   бесконечный Reconnecting). Mock-interview покрывает AI-практику.
// - Custom Lobby: бэкенда под кастом-комнаты нет, список хардкоженный,
//   "войти" кидало в несуществующий /hub. Это v2-фича, возврат по спросу.
function ModeCard({ m, onClick, isPending, selectedModel, }) {
    const { t } = useTranslation('arena');
    const ai = useAIModelsQuery();
    const modelName = useMemo(() => ai.data?.items.find((mm) => mm.id === selectedModel)?.label ?? '—', [selectedModel, ai.data]);
    return (_jsxs(Card, { className: "flex-col gap-4 p-5", interactive: true, children: [_jsx("button", { type: "button", onClick: onClick, disabled: isPending, "aria-label": `${t('enter')} — ${m.name}`, className: "absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-wait" }), _jsx("div", { className: `grid h-16 w-16 place-items-center rounded-xl bg-gradient-to-br ${m.gradient} shadow-card`, children: m.icon }), _jsxs("div", { className: "flex min-w-0 flex-col gap-1", children: [_jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: m.name }), _jsx("p", { className: "text-xs text-text-secondary", children: m.desc })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsxs("span", { className: "relative flex h-2 w-2", children: [_jsx("span", { className: "absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" }), _jsx("span", { className: "relative inline-flex h-2 w-2 rounded-full bg-success" })] }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: t('in_queue', { count: m.count, time: m.time }) }), m.aiPowered && (_jsxs("span", { className: "inline-flex items-center gap-1 rounded-full bg-pink/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-pink", children: [_jsx(Bot, { className: "h-3 w-3" }), modelName] }))] }), _jsxs("span", { className: "mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-1 py-2 font-sans text-[13px] font-semibold text-text-primary", children: [isPending ? (_jsx(Loader2, { className: "h-4 w-4 animate-spin" })) : (_jsx(ArrowRight, { className: "h-4 w-4" })), t('enter')] })] }));
}
function FriendsStrip({ onCreateParty }) {
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
    return (_jsxs(Card, { className: "flex-col items-start justify-between gap-4 p-4 lg:flex-row lg:items-center", interactive: false, children: [_jsxs("div", { className: "flex min-w-0 flex-wrap items-center gap-4", children: [_jsx("span", { className: "font-display text-sm font-bold text-text-primary", children: t('friends_online', { count: friends.length }) }), _jsx("div", { className: "flex -space-x-2", children: friends.map((f, i) => (_jsx(Avatar, { size: "md", gradient: f.gradient, initials: f.initials, status: "online" }, i))) }), _jsx("span", { className: "min-w-0 break-words font-mono text-[11px] text-text-muted", children: friends.map((f) => f.username).join(' · ') })] }), _jsxs("button", { type: "button", onClick: onCreateParty, className: "inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-2 font-sans text-[13px] font-semibold text-accent-hover hover:bg-accent/20", children: [_jsx(Users, { className: "h-3.5 w-3.5" }), t('create_party')] })] }));
}
export default function ArenaPage() {
    const { t } = useTranslation('arena');
    const navigate = useNavigate();
    const findMatch = useFindMatchMutation();
    const cancelSearch = useCancelSearchMutation();
    const [section, setSection] = useState('algorithms');
    const [partyMode, setPartyMode] = useState('solo');
    // Neural model id is now a free-form string (the backend's model id, e.g.
    // "openai/gpt-4o-mini"). Persisted to localStorage so the choice survives
    // reloads — no enum guard needed because the backend rejects unknown ids.
    const [neuralModel, setNeuralModelState] = useState(() => {
        try {
            return window.localStorage.getItem('druz9.arena.neural_model') ?? '';
        }
        catch {
            return '';
        }
    });
    const setNeuralModel = (id) => {
        setNeuralModelState(id);
        try {
            window.localStorage.setItem('druz9.arena.neural_model', id);
        }
        catch {
            /* localStorage may be disabled — ignore, choice falls back to default next visit */
        }
    };
    const [inQueue, setInQueue] = useState(false);
    const [waitSec, setWaitSec] = useState(0);
    const [errorMsg, setErrorMsg] = useState(null);
    const [pendingMode, setPendingMode] = useState(null);
    // Poll backend every 2s while in queue — when matchmaker pairs us up,
    // /arena/match/current returns 200 with the match id and we navigate
    // straight to the match page. Without this the UI sat silently with
    // "queued: 1" forever (production bug #5-8).
    const currentMatch = useCurrentMatchQuery(inQueue);
    useEffect(() => {
        if (!inQueue)
            return;
        const m = currentMatch.data;
        if (!m?.match_id)
            return;
        const path = m.mode === 'duo_2v2' ? `/arena/2v2/${m.match_id}` : `/arena/match/${m.match_id}`;
        setInQueue(false);
        setPendingMode(null);
        navigate(path);
    }, [inQueue, currentMatch.data, navigate]);
    // Tick the wait counter while we are queued. When QUEUE_TIMEOUT_SEC elapses
    // without the backend matchmaker pairing us up, auto-cancel the search and
    // surface a clear "никого нет в очереди" message (bible §11 — no silent
    // waits). The user can click "Найти матч" again to re-enqueue.
    useEffect(() => {
        if (!inQueue) {
            setWaitSec(0);
            return;
        }
        const id = window.setInterval(() => {
            setWaitSec((s) => {
                const next = s + 1;
                if (next >= QUEUE_TIMEOUT_SEC) {
                    // Auto-cancel on the backend so we don't leave a stale ticket.
                    cancelSearch.mutate(undefined, {
                        onSettled: () => {
                            setInQueue(false);
                            setPendingMode(null);
                            setErrorMsg('В очереди сейчас никого нет. Попробуй другой раздел или повтори позже.');
                        },
                    });
                }
                return next;
            });
        }, 1000);
        return () => window.clearInterval(id);
        // cancelSearch is a stable mutation object; intentional single-deps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inQueue]);
    const enqueue = (mode, modeKey) => {
        setErrorMsg(null);
        setPendingMode(modeKey);
        findMatch.mutate({ section, mode, neuralModel: neuralModel || 'random' }, {
            onSuccess: (resp) => {
                setPendingMode(null);
                if (resp.match_id) {
                    const path = mode === 'duo_2v2'
                        ? `/arena/2v2/${resp.match_id}`
                        : `/arena/match/${resp.match_id}`;
                    navigate(path);
                    return;
                }
                setInQueue(true);
            },
            onError: (e) => {
                setPendingMode(null);
                setErrorMsg(e.message ?? 'failed to enqueue');
            },
        });
    };
    const handleFind = () => {
        enqueue('ranked', 'hero');
    };
    const handleCancel = () => {
        cancelSearch.mutate(undefined, {
            onSettled: () => {
                setInQueue(false);
                setPendingMode(null);
            },
        });
    };
    const handleModeClick = (m) => {
        if (m.requiresParty && partyMode !== 'party') {
            setPartyMode('party');
        }
        if (!m.requiresParty && partyMode === 'party') {
            setPartyMode('solo');
        }
        enqueue(m.arenaMode, m.key);
    };
    const handleCreateParty = () => {
        setPartyMode('party');
    };
    const visibleModes = useMemo(() => {
        if (partyMode === 'party') {
            // Party mode emphasises 2v2 modes; solo modes hidden so the user is not
            // tempted to enqueue a single-player ladder while a partner is waiting.
            return MODES.filter((m) => m.requiresParty);
        }
        return MODES.filter((m) => !m.requiresParty);
    }, [partyMode]);
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8", children: [_jsx(HeaderRow, { partyMode: partyMode, onTogglePartyMode: setPartyMode }), _jsx(HeroQueue, { inQueue: inQueue, waitSeconds: waitSec, isSubmitting: findMatch.isPending || cancelSearch.isPending, errorMessage: errorMsg, selectedSection: section, onSelectSection: setSection, onFind: handleFind, onCancel: handleCancel }), _jsx(AiPanel, { selectedModel: neuralModel, onSelectModel: setNeuralModel }), _jsxs("div", { className: "flex flex-col gap-4", children: [_jsxs("div", { className: "flex items-end justify-between", children: [_jsx("h2", { className: "font-display text-xl font-bold text-text-primary", children: partyMode === 'party'
                                        ? t('party_modes', { defaultValue: 'Командные режимы' })
                                        : t('all_modes') }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: t('modes_available_count', {
                                        defaultValue: '{{count}} доступно',
                                        count: visibleModes.length,
                                    }) })] }), _jsx("div", { className: "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3", children: visibleModes.map((m) => (_jsx(ModeCard, { m: m, isPending: pendingMode === m.key, selectedModel: neuralModel, onClick: () => handleModeClick(m) }, m.key))) })] }), _jsx(FriendsStrip, { onCreateParty: handleCreateParty })] }) }));
}
