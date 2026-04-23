import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// SeasonPage renders the Season Pass surface — the Free + Premium reward
// ladders, the user's tier/progress, and weekly challenges.
//
// All data is loaded from /api/v1/season/current (Connect-RPC SeasonService /
// proto/druz9/v1/season.proto). When the backend returns 404 (no active
// season) we render a polite empty state — never the demo numbers.
import { useMemo } from 'react';
import { Check, Lock, Crown, Snowflake, Sparkles } from 'lucide-react';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { ComingSoon } from '../components/ComingSoon';
import { useClaimReward, useSeasonQuery, } from '../lib/queries/season';
function ErrorChip({ label }) {
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: label }));
}
function Hero({ data, isError, isLoading }) {
    const tier = data?.tier ?? 0;
    const sp = data?.my_points ?? 0;
    const codename = data?.season?.slug?.toUpperCase() ?? '—';
    const title = data?.season?.name ?? 'Season Pass';
    // Free track is the canonical ladder for the next-tier target.
    const sortedFree = useMemo(() => {
        const freeTrack = data?.tracks?.find((t) => t.kind === 'free')?.tiers ?? [];
        return [...freeTrack].sort((a, b) => a.required_points - b.required_points);
    }, [data]);
    const nextTier = sortedFree.find((row) => row.required_points > sp);
    const target = nextTier?.required_points ?? sp;
    const pct = target > sp ? Math.min(100, Math.round((sp / target) * 100)) : 100;
    const rewardCount = (data?.tracks?.[0]?.tiers?.length ?? 0) + (data?.tracks?.[1]?.tiers?.length ?? 0);
    const endsAt = data?.season?.ends_at;
    const daysLeft = endsAt
        ? Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000))
        : null;
    return (_jsxs("div", { className: "flex h-auto flex-col items-start justify-between gap-4 px-4 py-6 sm:px-8 lg:h-[240px] lg:flex-row lg:items-center lg:gap-0 lg:px-20 lg:py-0", style: { background: 'linear-gradient(135deg, #2D1B4D 0%, #582CFF 100%)' }, children: [_jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn", children: ["\u0421\u0415\u0417\u041E\u041D \u00B7 ", codename] }), _jsx("h1", { className: "font-display text-3xl sm:text-4xl lg:text-[38px] font-extrabold leading-[1.05] text-text-primary", children: title }), _jsx("p", { className: "text-sm text-text-secondary", children: isError
                            ? 'Не удалось загрузить'
                            : isLoading
                                ? 'Загружаем сезон…'
                                : daysLeft !== null
                                    ? `До конца сезона: ${daysLeft} дней · ${rewardCount} наград`
                                    : `${rewardCount} наград` }), _jsxs("div", { className: "mt-2 flex items-center gap-4", children: [_jsxs("span", { className: "font-display text-base font-bold text-text-primary", children: ["Tier ", tier] }), _jsx("div", { className: "h-2.5 w-[160px] sm:w-[220px] overflow-hidden rounded-full bg-black/30", children: _jsx("div", { className: "h-full rounded-full bg-gradient-to-r from-cyan to-warn", style: { width: `${pct}%` } }) }), _jsxs("span", { className: "font-mono text-[12px] text-text-secondary", children: [sp, nextTier ? ` / ${target}` : '', " SP"] })] })] }), _jsxs("div", { className: "flex flex-col items-end gap-2", children: [_jsx(Button, { disabled: data?.is_premium ?? false, className: "bg-warn text-bg shadow-glow-warn hover:bg-warn hover:brightness-110 disabled:opacity-50", children: data?.is_premium ? 'Premium активен' : 'Купить Premium' }), _jsx("span", { className: "max-w-[260px] text-right text-xs text-text-secondary", children: "\u0410\u043D\u043B\u043E\u043A \u0432\u0441\u0435\u0445 Premium-\u043D\u0430\u0433\u0440\u0430\u0434" })] })] }));
}
function tierState(tier, currentTier) {
    if (tier.claimed)
        return 'collected';
    if (tier.tier === currentTier + 1)
        return 'current';
    return 'locked';
}
function FreeCell({ tier, state, onClaim, claiming, }) {
    const isCurrent = state === 'current';
    const isCollected = state === 'collected';
    const canClaim = !isCollected && !isCurrent && false; // claim eligibility is owned by the API; UI shows current cell only.
    return (_jsxs("div", { className: `relative flex h-[120px] flex-col items-center justify-center gap-2 rounded-lg border bg-surface-2 p-3 ${isCurrent ? 'border-accent shadow-glow' : 'border-border'} ${state === 'locked' ? 'opacity-60' : ''}`, children: [_jsxs("span", { className: "absolute left-2 top-2 font-mono text-[10px] text-text-muted", children: ["T", tier.tier] }), isCurrent && (_jsx("span", { className: "absolute right-2 top-2 rounded-full bg-accent px-1.5 py-0.5 font-mono text-[9px] font-bold text-text-primary", children: "\u0421\u0415\u0419\u0427\u0410\u0421" })), _jsx("div", { className: "grid h-12 w-12 place-items-center rounded-md bg-gradient-to-br from-surface-3 to-accent/40", children: state === 'locked' ? (_jsx(Lock, { className: "h-5 w-5 text-text-muted" })) : isCollected ? (_jsx(Check, { className: "h-5 w-5 text-success" })) : (_jsx(Sparkles, { className: "h-5 w-5 text-cyan" })) }), _jsx("span", { className: "text-center text-[11px] font-semibold text-text-primary", children: tier.reward_key }), canClaim && (_jsx("button", { type: "button", onClick: onClaim, disabled: claiming, className: "rounded bg-success/20 px-1.5 py-0.5 text-[9px] font-bold text-success disabled:opacity-50", children: "\u0417\u0430\u0431\u0440\u0430\u0442\u044C" }))] }));
}
function PremiumCell({ tier, isPremium, state, onClaim, claiming, }) {
    const claimable = isPremium && state === 'collected' === false && state !== 'locked';
    return (_jsxs("div", { className: "relative flex h-[120px] flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-warn/40 bg-gradient-to-br from-warn/20 to-pink/20 p-3", children: [_jsxs("span", { className: "absolute left-2 top-2 font-mono text-[10px] text-warn", children: ["T", tier.tier] }), _jsx("div", { className: "grid h-12 w-12 place-items-center rounded-md bg-gradient-to-br from-warn to-pink", children: _jsx(Crown, { className: "h-5 w-5 text-bg" }) }), _jsx("span", { className: "text-center text-[11px] font-semibold text-text-primary", children: tier.reward_key }), !isPremium && (_jsx("div", { className: "absolute inset-0 flex items-center justify-center bg-bg/70 opacity-0 transition-opacity hover:opacity-100", children: _jsx("span", { className: "font-mono text-[11px] font-semibold text-warn", children: "\u041A\u0443\u043F\u0438 Premium" }) })), claimable && (_jsx("button", { type: "button", onClick: onClaim, disabled: claiming, className: "rounded bg-warn/30 px-1.5 py-0.5 text-[9px] font-bold text-warn disabled:opacity-50", children: "\u0417\u0430\u0431\u0440\u0430\u0442\u044C" })), _jsx(Lock, { className: "absolute bottom-2 right-2 h-3 w-3 text-warn" })] }));
}
function BattlePass({ data }) {
    const claim = useClaimReward();
    const free = useMemo(() => [...(data.tracks.find((t) => t.kind === 'free')?.tiers ?? [])].sort((a, b) => a.tier - b.tier), [data.tracks]);
    const premium = useMemo(() => [...(data.tracks.find((t) => t.kind === 'premium')?.tiers ?? [])].sort((a, b) => a.tier - b.tier), [data.tracks]);
    if (free.length === 0 && premium.length === 0) {
        return (_jsx("div", { className: "rounded-2xl border border-border bg-surface-1 p-8 text-center", children: _jsx("p", { className: "text-sm text-text-secondary", children: "\u041D\u0430\u0433\u0440\u0430\u0434\u044B \u044D\u0442\u043E\u0433\u043E \u0441\u0435\u0437\u043E\u043D\u0430 \u0435\u0449\u0451 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u044B \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430\u043C\u0438." }) }));
    }
    return (_jsxs("div", { className: "flex flex-col gap-4", children: [_jsxs("div", { className: "flex flex-col items-start gap-3 lg:flex-row lg:items-center lg:justify-between", children: [_jsx("h2", { className: "font-display text-2xl font-bold text-text-primary", children: "\u0411\u043E\u0435\u0432\u043E\u0439 \u043F\u0440\u043E\u043F\u0443\u0441\u043A" }), _jsxs("span", { className: "font-mono text-[11px] text-text-muted", children: ["Tier ", data.tier, " \u00B7 ", data.my_points, " SP"] })] }), _jsxs("div", { className: "flex flex-col gap-3 rounded-2xl bg-surface-1 p-5", children: [_jsxs("div", { className: "flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4", children: [_jsx("div", { className: "font-mono text-[12px] font-semibold tracking-[0.08em] text-text-secondary lg:w-32", children: "FREE" }), _jsx("div", { className: "grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6", children: free.slice(0, 6).map((t) => (_jsx(FreeCell, { tier: t, state: tierState(t, data.tier), onClaim: () => claim.mutate({ tier: t.tier, kind: 'free' }), claiming: claim.isPending }, t.tier))) })] }), _jsxs("div", { className: "flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4", children: [_jsx("div", { className: "font-mono text-[12px] font-semibold tracking-[0.08em] text-warn lg:w-32", children: "\uD83D\uDC51 PREMIUM" }), _jsx("div", { className: "grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6", children: premium.slice(0, 6).map((t) => (_jsx(PremiumCell, { tier: t, isPremium: data.is_premium, state: tierState(t, data.tier), onClaim: () => claim.mutate({ tier: t.tier, kind: 'premium' }), claiming: claim.isPending }, t.tier))) })] })] })] }));
}
function WeeklyChallenges({ data }) {
    if (!data.weekly_challenges || data.weekly_challenges.length === 0)
        return null;
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", children: [_jsx("div", { className: "flex items-center justify-between", children: _jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0427\u0435\u043B\u043B\u0435\u043D\u0434\u0436\u0438 \u043D\u0435\u0434\u0435\u043B\u0438" }) }), _jsx("div", { className: "flex flex-col gap-2", children: data.weekly_challenges.map((c) => {
                    const pct = c.target > 0 ? Math.min(100, Math.round((c.progress / c.target) * 100)) : 0;
                    return (_jsxs("div", { className: "flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-3", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-sm font-semibold text-text-primary", children: c.title }), _jsxs("span", { className: "font-mono text-[11px] text-warn", children: ["+", c.points_reward, " SP"] })] }), _jsx("div", { className: "h-1.5 overflow-hidden rounded-full bg-black/30", children: _jsx("div", { className: "h-full rounded-full bg-cyan", style: { width: `${pct}%` } }) }), _jsxs("span", { className: "font-mono text-[10px] text-text-muted", children: [c.progress, " / ", c.target] })] }, c.key));
                }) })] }));
}
function StreakFreeze() {
    return (_jsxs(Card, { className: "flex-1 flex-col items-center gap-3 border-warn/40 p-5", children: [_jsx(Snowflake, { className: "h-10 w-10 text-cyan" }), _jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "Streak Freeze" }), _jsx("p", { className: "text-center text-xs text-text-secondary", children: "\u0417\u0430\u0449\u0438\u0442\u0438 \u0441\u0435\u0440\u0438\u044E \u043D\u0430 1 \u0434\u0435\u043D\u044C" }), _jsx(Button, { className: "mt-auto bg-warn text-bg shadow-glow-warn hover:bg-warn hover:brightness-110", children: "\u0421\u043A\u043E\u0440\u043E" })] }));
}
export default function SeasonPage() {
    const { data, isError, isLoading, error } = useSeasonQuery();
    // 404 (No current season) → render an honest empty state.
    const errStatus = error?.status;
    if (errStatus === 404) {
        return (_jsx(AppShellV2, { children: _jsx(ComingSoon, { title: "\u0410\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u0441\u0435\u0437\u043E\u043D\u0430 \u043D\u0435\u0442", description: "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0441\u0435\u0437\u043E\u043D \u0441\u0442\u0430\u0440\u0442\u0443\u0435\u0442, \u043A\u043E\u0433\u0434\u0430 \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u044B \u043E\u0442\u043A\u0440\u043E\u044E\u0442 \u0435\u0433\u043E. \u0417\u0430\u0433\u043B\u044F\u043D\u0438 \u043F\u043E\u0437\u0436\u0435 \u2014 \u043C\u044B \u043F\u0440\u0438\u0448\u043B\u0451\u043C \u043F\u0443\u0448 \u043D\u0430 \u0441\u0442\u0430\u0440\u0442\u0435." }) }));
    }
    return (_jsxs(AppShellV2, { children: [_jsx(Hero, { data: data, isError: isError && errStatus !== 404, isLoading: isLoading }), _jsxs("div", { className: "flex flex-col gap-8 px-4 py-6 sm:px-8 lg:px-20 lg:py-8", children: [isError && errStatus !== 404 && _jsx(ErrorChip, { label: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C" }), data && _jsx(BattlePass, { data: data }), data && (_jsxs("div", { className: "flex flex-col gap-5", children: [_jsx("h2", { className: "font-display text-2xl font-bold text-text-primary", children: "\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441" }), _jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:gap-5", children: [_jsx(WeeklyChallenges, { data: data }), _jsx(StreakFreeze, {})] })] }))] })] }));
}
