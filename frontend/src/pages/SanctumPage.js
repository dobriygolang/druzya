import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowRight, Flame, Play, Sparkles, Shield, Swords, Trophy } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { AppShellV2 } from '../components/AppShell';
import { staggerContainer, staggerItem } from '../lib/motion';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { useDailyKataQuery, useStreakQuery } from '../lib/queries/daily';
import { useSeasonQuery } from '../lib/queries/season';
import { useRatingMeQuery, useLeaderboardQuery } from '../lib/queries/rating';
import { useProfileQuery } from '../lib/queries/profile';
import { cn } from '../lib/cn';
function ErrorChip() {
    const { t } = useTranslation('errors');
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: t('load_failed') }));
}
function HeaderRow() {
    const { t } = useTranslation(['sanctum', 'common']);
    const { data: streak } = useStreakQuery();
    const { data: profile } = useProfileQuery();
    const name = profile?.display_name ?? '—';
    const current = streak?.current ?? 0;
    return (_jsxs("div", { className: "flex flex-col items-start gap-4 lg:flex-row lg:items-end lg:justify-between", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("h1", { className: "font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[32px]", children: t('sanctum:welcome', { name }) }), _jsx("p", { className: "text-sm text-text-secondary", children: t('sanctum:subtitle', { streak: current }) })] }), _jsx(Button, { variant: "primary", icon: _jsx(Swords, { className: "h-[18px] w-[18px]" }), iconRight: _jsx(ArrowRight, { className: "h-4 w-4" }), className: "w-full justify-center px-5 py-3 text-sm sm:w-auto", children: t('common:buttons.find_opponent') })] }));
}
function DailyHero() {
    const { t } = useTranslation('sanctum');
    const { data: kata, isError } = useDailyKataQuery();
    const { data: streak } = useStreakQuery();
    const day = streak?.current ?? 0;
    const title = kata?.task?.title ?? '—';
    const difficulty = kata?.task?.difficulty ?? '—';
    const section = kata?.task?.section ?? '—';
    return (_jsxs(Card, { className: "flex-1 flex-col gap-5 p-7", interactive: false, children: [_jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex flex-col gap-2", children: [_jsxs("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn", children: [_jsx(Flame, { className: "h-3 w-3" }), " ", t('daily_kata_day', { day })] }), isError && _jsx(ErrorChip, {}), _jsx("h2", { className: "w-full max-w-[540px] font-display text-2xl font-bold text-text-primary", children: title }), _jsxs("p", { className: "font-mono text-xs text-text-muted", children: [difficulty, " \u00B7 O(log n) \u00B7 ", section] })] }), _jsxs("div", { className: "flex flex-col items-end gap-1", children: [_jsx("span", { className: "font-display text-[32px] font-bold text-cyan", children: "15:00" }), _jsx("span", { className: "text-xs text-text-muted", children: t('remaining') })] })] }), _jsxs("div", { className: "flex flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:justify-between", children: [_jsxs("div", { className: "flex flex-wrap gap-6", children: [_jsx(Stat, { value: "850 XP", label: t('reward') }), _jsx(Stat, { value: "62%", label: t('passed_today'), highlight: "cyan" }), _jsx(Stat, { value: `${day} 🔥`, label: t('streak_days'), highlight: "warn" })] }), _jsx(Button, { variant: "primary", iconRight: _jsx(ArrowRight, { className: "h-4 w-4" }), className: "bg-text-primary text-bg shadow-none hover:bg-white/90 hover:shadow-none", children: t('begin') })] })] }));
}
function Stat({ value, label, highlight }) {
    return (_jsxs("div", { className: "flex flex-col gap-0.5", children: [_jsx("span", { className: highlight === 'cyan'
                    ? 'font-display text-lg font-semibold text-cyan'
                    : highlight === 'warn'
                        ? 'font-display text-lg font-semibold text-warn'
                        : 'font-display text-lg font-semibold text-text-primary', children: value }), _jsx("span", { className: "text-[11px] text-text-muted", children: label })] }));
}
function SeasonRank() {
    const { t } = useTranslation('sanctum');
    const { data: season, isError } = useSeasonQuery();
    const { data: rating } = useRatingMeQuery();
    const tier = season?.tier ?? 0;
    const sp = season?.my_points ?? 0;
    // Free track is the canonical ladder for the "next tier" target. Falls back
    // to a flat ladder when the API hasn't shipped (or 404).
    const freeTrack = season?.tracks?.find((tr) => tr.kind === 'free')?.tiers ?? [];
    const nextTier = freeTrack.find((row) => row.tier === tier + 1);
    const nextTarget = nextTier?.required_points ?? Math.max(1, (tier + 1) * 200);
    const pct = Math.min(100, Math.round((sp / Math.max(1, nextTarget)) * 100));
    const gps = rating?.global_power_score ?? 0;
    const endsAt = season?.season?.ends_at;
    const daysLeft = endsAt
        ? Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000))
        : 0;
    return (_jsxs(Card, { className: "w-full flex-col gap-4 border-accent/25 bg-surface-3 p-6 lg:w-[380px]", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-secondary", children: season?.season?.name ?? t('season_label') }), _jsx("span", { className: "rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-text-secondary", children: t('days_to_end', { count: daysLeft }) })] }), isError && _jsx(ErrorChip, {}), _jsxs("div", { className: "flex flex-col items-center gap-1", children: [_jsx("span", { className: "font-display text-[30px] font-extrabold text-text-primary", children: t('tier', { n: tier }) }), _jsxs("span", { className: "font-mono text-[13px] text-cyan", children: [gps, " GPS"] })] }), _jsx("div", { className: "h-2.5 overflow-hidden rounded-full bg-black/30", children: _jsx("div", { className: "h-full rounded-full bg-gradient-to-r from-cyan to-accent", style: { width: `${pct}%` } }) }), _jsxs("div", { className: "flex justify-between text-[11px] text-text-muted", children: [_jsx("span", { children: t('tier', { n: tier }) }), _jsx("span", { children: t('tier', { n: tier + 1 }) })] })] }));
}
function ArenaCard() {
    const { t } = useTranslation('sanctum');
    const { data: rating } = useRatingMeQuery();
    const algo = rating?.ratings?.find((r) => r.section === 'algorithms');
    const matches = algo?.matches_count ?? 0;
    const elo = algo?.elo ?? 0;
    return (_jsxs(Card, { className: "flex-1 flex-col gap-3.5 p-5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Swords, { className: "h-4 w-4 text-pink" }), _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-pink", children: t('arena_label') })] }), _jsx("h3", { className: "font-display text-xl font-bold text-text-primary", children: t('ranked_1v1') }), _jsxs("div", { className: "flex gap-4", children: [_jsx(Stat, { value: `${matches}`, label: t('matches') }), _jsx(Stat, { value: `${elo}`, label: t('elo'), highlight: "cyan" }), _jsx(Stat, { value: `${algo?.percentile ?? 0}%`, label: t('percentile'), highlight: "cyan" })] }), _jsx(Button, { variant: "ghost", icon: _jsx(Play, { className: "h-3.5 w-3.5" }), className: "border-accent text-accent-hover hover:bg-accent/10", children: t('queue') })] }));
}
function GuildCard() {
    const { t } = useTranslation('sanctum');
    return (_jsxs(Card, { className: "flex-1 flex-col gap-3.5 p-5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Shield, { className: "h-4 w-4 text-cyan" }), _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan", children: t('guild_war') })] }), _jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: t('guild_match') }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "font-display text-[22px] font-bold text-success", children: "2 140" }), _jsxs("div", { className: "flex h-2 flex-1 overflow-hidden rounded-full bg-black/30", children: [_jsx("div", { className: "h-full w-[56%] bg-success" }), _jsx("div", { className: "h-full w-[14%] bg-danger" })] }), _jsx("span", { className: "font-display text-[22px] font-bold text-danger", children: "1 670" })] }), _jsx("p", { className: "text-xs text-text-secondary", children: t('your_contribution', { points: 240 }) })] }));
}
function CoachCard() {
    const { t } = useTranslation('sanctum');
    return (_jsxs("div", { className: "flex flex-1 flex-col gap-3 rounded-xl bg-gradient-to-br from-accent to-pink p-5 shadow-glow", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Sparkles, { className: "h-4 w-4 text-text-primary" }), _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-primary", children: t('ai_mentor') })] }), _jsx("h3", { className: "w-full max-w-[300px] font-display text-base font-bold text-text-primary", children: t('weak_spot') }), _jsx("p", { className: "w-full max-w-[300px] text-xs text-white/80", children: t('weak_spot_desc') }), _jsxs("button", { className: "inline-flex w-fit items-center gap-1.5 rounded-md bg-white/20 px-3.5 py-2 text-xs font-semibold text-text-primary hover:bg-white/30", children: [t('open_plan'), " ", _jsx(ArrowRight, { className: "h-3.5 w-3.5" })] })] }));
}
function Leaderboard() {
    const { t } = useTranslation('sanctum');
    const { data: lb, isError } = useLeaderboardQuery('algorithms');
    const fallback = [
        { rank: 1, name: '@alexey', tier: 'Grandmaster · 3 420 LP', delta: '+240', medal: 'gold' },
        { rank: 2, name: '@kirill_dev', tier: 'Diamond I · 2 980 LP', delta: '+180', medal: 'silver' },
        { rank: 3, name: '@you', tier: 'Diamond III · 2 840 LP', delta: '+124', medal: 'accent', you: true },
        { rank: 4, name: '@nastya', tier: 'Diamond IV · 2 610 LP', delta: '+90', medal: 'plain' },
    ];
    const rows = lb?.entries
        ? lb.entries.slice(0, 4).map((e, idx) => ({
            rank: e.rank,
            name: `@${e.username}`,
            tier: e.title ? `${e.title} · ${e.elo} ELO` : `${e.elo} ELO`,
            delta: '',
            medal: (idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'accent' : 'plain'),
            you: false,
        }))
        : fallback;
    const medalBg = (m) => m === 'gold' ? 'bg-warn text-bg' : m === 'silver' ? 'bg-border-strong text-text-secondary' : m === 'accent' ? 'bg-accent text-text-primary' : 'bg-border-strong text-text-secondary';
    return (_jsxs(Card, { className: "w-full flex-col gap-3 p-5 lg:w-[420px]", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: t('top_friends') }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: isError ? '—' : t('week') })] }), rows.map((r) => (_jsxs("div", { className: [
                    'flex items-center gap-3 rounded-lg px-2 py-2',
                    r.you ? 'bg-accent/10' : '',
                ].join(' '), children: [_jsx("span", { className: `grid h-7 w-7 shrink-0 place-items-center rounded-full font-display text-[13px] font-bold ${medalBg(r.medal)}`, children: r.rank }), _jsx(Avatar, { size: "sm", gradient: "violet-cyan", initials: r.name[1]?.toUpperCase() }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col gap-0.5", children: [_jsx("span", { className: cn('truncate', r.you ? 'text-sm font-bold text-text-primary' : 'text-sm font-semibold text-text-primary'), children: r.name }), _jsx("span", { className: cn('truncate', r.you ? 'font-mono text-[11px] text-accent-hover' : 'font-mono text-[11px] text-text-muted'), children: r.tier })] }), _jsx("span", { className: "shrink-0 font-mono text-sm font-semibold text-success", children: r.delta || '' })] }, r.rank)))] }));
}
function Activity() {
    const { t } = useTranslation(['sanctum', 'common']);
    const items = [
        { icon: _jsx(Trophy, { className: "h-4 w-4 text-warn" }), bg: 'bg-warn/15', title: 'Ачивмент · Speed Demon', sub: '10 задач под 5 минут подряд', time: 'вчера' },
        { icon: _jsx(Swords, { className: "h-4 w-4 text-accent-hover" }), bg: 'bg-accent/15', title: 'Победа в арене · vs @kirill_dev', sub: 'Median of Two Sorted Arrays · +18 LP', time: '1 ч назад' },
        { icon: _jsx(Sparkles, { className: "h-4 w-4 text-success" }), bg: 'bg-success/15', title: 'Two Sum · Easy', sub: 'Решено за 4:21 · +120 XP', time: '2 мин назад' },
    ];
    return (_jsxs(Card, { className: "flex-1 flex-col gap-3.5 p-5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: t('sanctum:recent_activity') }), _jsx("button", { className: "text-xs text-text-muted hover:text-text-secondary", children: t('common:buttons.view_all') })] }), items.reverse().map((i, idx) => (_jsxs("div", { className: "flex items-center gap-3 py-2", children: [_jsx("span", { className: `grid h-9 w-9 shrink-0 place-items-center rounded-full ${i.bg}`, children: i.icon }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col gap-0.5", children: [_jsx("span", { className: "truncate text-sm font-semibold text-text-primary", children: i.title }), _jsx("span", { className: "truncate text-[11px] text-text-muted", children: i.sub })] }), _jsx("span", { className: "shrink-0 font-mono text-[11px] text-text-muted", children: i.time })] }, idx)))] }));
}
export default function SanctumPageV2() {
    const reduced = useReducedMotion();
    const containerProps = reduced
        ? {}
        : { variants: staggerContainer, initial: 'hidden', animate: 'show' };
    const itemProps = reduced ? {} : { variants: staggerItem };
    return (_jsx(AppShellV2, { children: _jsxs(motion.div, { className: "flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8", ...containerProps, children: [_jsx(motion.div, { ...itemProps, children: _jsx(HeaderRow, {}) }), _jsxs(motion.div, { className: "flex flex-col gap-5 lg:h-[280px] lg:flex-row", ...itemProps, children: [_jsx(DailyHero, {}), _jsx(SeasonRank, {})] }), _jsxs(motion.div, { className: "flex flex-col gap-5 lg:h-[220px] lg:flex-row", ...itemProps, children: [_jsx(ArenaCard, {}), _jsx(GuildCard, {}), _jsx(CoachCard, {})] }), _jsxs(motion.div, { className: "flex flex-col gap-5 lg:h-[260px] lg:flex-row", ...itemProps, children: [_jsx(Activity, {}), _jsx(Leaderboard, {})] })] }) }));
}
