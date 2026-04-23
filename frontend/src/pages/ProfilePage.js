import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Share2, UserPlus, Trophy, Shield, Crown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { cn } from '../lib/cn';
import { useProfileQuery, usePublicProfileQuery, } from '../lib/queries/profile';
import { useRatingMeQuery, useLeaderboardQuery } from '../lib/queries/rating';
import { useStreakQuery } from '../lib/queries/daily';
import { useAchievementsQuery, isUnlocked } from '../lib/queries/achievements';
import { useArenaHistoryQuery } from '../lib/queries/matches';
import { useMyGuildQuery } from '../lib/queries/guild';
function toViewModel(args) {
    const { isOwn, own, pub, fallbackScore } = args;
    if (isOwn) {
        if (!own)
            return null;
        return {
            isOwn: true,
            username: own.username,
            display: own.display_name || own.username,
            initial: (own.display_name || own.username || 'D').charAt(0).toUpperCase(),
            title: own.title || '—',
            level: own.level ?? 0,
            charClass: own.char_class || '—',
            careerStage: own.career_stage || '',
            globalPowerScore: own.global_power_score ?? fallbackScore ?? 0,
        };
    }
    if (!pub)
        return null;
    return {
        isOwn: false,
        username: pub.username,
        display: pub.display_name || pub.username,
        initial: (pub.display_name || pub.username || 'D').charAt(0).toUpperCase(),
        title: pub.title || '—',
        level: pub.level ?? 0,
        charClass: pub.char_class || '—',
        careerStage: pub.career_stage || '',
        globalPowerScore: pub.global_power_score ?? 0,
    };
}
function Hero({ vm }) {
    const { t } = useTranslation('profile');
    const { data: rating } = useRatingMeQuery();
    const { data: streak } = useStreakQuery();
    const algo = rating?.ratings?.find((r) => r.section === 'algorithms');
    const matches = algo?.matches_count ?? 0;
    const streakCur = streak?.current ?? 0;
    return (_jsxs("div", { className: "relative flex flex-col items-start justify-between gap-5 px-4 py-6 sm:px-8 lg:flex-row lg:items-center lg:gap-0 lg:px-10 lg:py-0", style: {
            minHeight: 220,
            background: 'linear-gradient(135deg, #582CFF 0%, #F472B6 50%, #22D3EE 100%)',
        }, children: [_jsxs("div", { className: "flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-6", children: [_jsx("div", { className: "grid shrink-0 place-items-center rounded-full font-display text-4xl font-extrabold text-white ring-4 ring-white", style: {
                            width: 96,
                            height: 96,
                            background: 'linear-gradient(135deg, #582CFF 0%, #22D3EE 100%)',
                        }, "aria-label": "avatar", children: vm.initial }), _jsxs("div", { className: "flex flex-col gap-2", children: [_jsxs("h1", { className: "font-display text-3xl font-bold leading-none text-white sm:text-4xl lg:text-[38px]", children: ["@", vm.username] }), _jsx("p", { className: "text-sm text-white/85", children: t('since', { display: vm.display }) }), _jsxs("div", { className: "mt-2 flex flex-wrap items-center gap-4 lg:gap-6", children: [_jsx(HeroStat, { label: t('rank'), value: vm.title, sub: `Lv ${vm.level}` }), _jsx(HeroStat, { label: t('gps'), value: `${vm.globalPowerScore}`, sub: t('matches', { count: matches }) }), vm.isOwn && _jsx(HeroStat, { label: t('streak'), value: `${streakCur} 🔥`, sub: t('days') }), _jsx(HeroStat, { label: t('class'), value: vm.charClass, sub: vm.careerStage })] })] })] }), _jsxs("div", { className: "flex w-full flex-row gap-2 lg:w-auto lg:flex-col", children: [_jsx(Button, { variant: "ghost", icon: _jsx(Share2, { className: "h-4 w-4" }), className: "border-white/40 bg-white/15 text-white hover:bg-white/25", children: t('share') }), !vm.isOwn && (_jsx(Button, { variant: "primary", icon: _jsx(UserPlus, { className: "h-4 w-4" }), className: "bg-white text-bg shadow-none hover:bg-white/90 hover:shadow-none", children: t('add_friend') }))] })] }));
}
function HeroStat({ label, value, sub }) {
    return (_jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-mono text-[10px] uppercase tracking-[0.1em] text-white/70", children: label }), _jsx("span", { className: "font-display text-base font-bold text-white", children: value }), _jsx("span", { className: "font-mono text-[11px] text-white/80", children: sub })] }));
}
const PROFILE_TABS = ['Overview', 'Matches', 'Achievements', 'Guilds', 'Stats'];
function ProfileTabBar({ tab, setTab }) {
    const { t: tt } = useTranslation('profile');
    const tabKey = {
        Overview: 'tabs.overview',
        Matches: 'tabs.matches',
        Achievements: 'tabs.achievements',
        Guilds: 'tabs.guilds',
        Stats: 'tabs.stats',
    };
    return (_jsx("div", { className: "flex h-[56px] items-center gap-1 overflow-x-auto border-b border-border bg-bg px-4 sm:px-8 lg:px-10", children: PROFILE_TABS.map((tname) => {
            const active = tab === tname;
            return (_jsx("button", { onClick: () => setTab(tname), className: cn('relative h-full px-4 text-sm font-semibold transition-colors', active
                    ? 'bg-surface-2 text-text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-accent'
                    : 'text-text-secondary hover:text-text-primary'), children: tt(tabKey[tname]) }, tname));
        }) }));
}
const SECTION_LABELS = {
    algorithms: 'Algorithms',
    sql: 'SQL',
    go: 'Go',
    system_design: 'System Design',
    behavioral: 'Behavioral',
};
// SkillsCard renders the live section ratings only — no synthetic fallback.
// When there are no ratings yet (new user) the card explicitly says so;
// previously we filled it with mock skills which gave a misleading impression
// of accomplishment.
function SkillsCard() {
    const { t } = useTranslation('profile');
    const { data: rating, isLoading } = useRatingMeQuery();
    const skills = (rating?.ratings ?? []).map((r) => ({
        name: SECTION_LABELS[r.section] ?? r.section,
        value: Math.min(100, r.percentile),
        delta: r.decaying ? '↓' : `${r.elo}`,
        up: !r.decaying,
    }));
    return (_jsxs(Card, { className: "flex-col gap-4 p-5", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: t('skills') }), isLoading && _jsx("div", { className: "font-mono text-[12px] text-text-muted", children: "\u2026" }), !isLoading && skills.length === 0 && (_jsx("div", { className: "font-mono text-[12px] text-text-muted", children: t('skills_empty', { defaultValue: 'No matches yet' }) })), _jsx("div", { className: "flex flex-col gap-3", children: skills.map((s) => (_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-[13px] font-medium text-text-secondary", children: s.name }), _jsx("span", { className: cn('font-mono text-[12px] font-semibold', s.up ? 'text-success' : 'text-danger'), children: s.delta })] }), _jsx("div", { className: "h-1.5 overflow-hidden rounded-full bg-black/30", children: _jsx("div", { className: "h-full rounded-full bg-gradient-to-r from-cyan to-accent", style: { width: `${s.value}%` } }) })] }, s.name))) })] }));
}
// AchievementsCard renders ONLY achievements the user has actually unlocked.
// Previously this was a hardcoded badge grid that mislead users into thinking
// they had achievements they hadn't earned (production complaint #18).
function AchievementsCard() {
    const { t } = useTranslation('profile');
    const { data, isLoading, isError } = useAchievementsQuery();
    const unlocked = (data ?? []).filter(isUnlocked);
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: t('achievements_title') }), _jsxs("span", { className: "font-mono text-[11px] text-text-muted", children: [unlocked.length, " / ", data?.length ?? 0] })] }), isLoading && _jsx("p", { className: "font-mono text-[12px] text-text-muted", children: "\u2026" }), isError && _jsx("p", { className: "text-[12px] text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0430\u0447\u0438\u0432\u043A\u0438." }), !isLoading && !isError && unlocked.length === 0 && (_jsx("p", { className: "text-[12px] text-text-muted", children: "\u041F\u043E\u043A\u0430 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u0440\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043E. \u0421\u044B\u0433\u0440\u0430\u0439 \u043C\u0430\u0442\u0447, \u0440\u0435\u0448\u0438 \u0437\u0430\u0434\u0430\u0447\u0443 \u2014 \u043F\u0435\u0440\u0432\u0430\u044F \u0430\u0447\u0438\u0432\u043A\u0430 \u0431\u043B\u0438\u0437\u043A\u043E." })), _jsx("div", { className: "grid grid-cols-3 gap-2", children: unlocked.slice(0, 6).map((a) => (_jsxs("div", { title: a.title, className: cn('flex aspect-square flex-col items-center justify-center gap-1 rounded-lg p-2', a.tier === 'legendary'
                        ? 'bg-gradient-to-br from-warn to-pink'
                        : a.tier === 'rare'
                            ? 'bg-gradient-to-br from-cyan to-accent'
                            : 'bg-gradient-to-br from-surface-3 to-surface-2'), children: [_jsx(Trophy, { className: "h-5 w-5 text-white" }), _jsx("span", { className: "line-clamp-1 font-mono text-[10px] font-semibold text-white", children: a.title })] }, a.code))) }), unlocked.length > 6 && (_jsx(Link, { to: "/achievements", className: "font-mono text-[11px] text-cyan hover:underline", children: "\u0412\u0441\u0435 \u0430\u0447\u0438\u0432\u043A\u0438 \u203A" }))] }));
}
// GuildCard now reads useMyGuildQuery — shows real membership or empty state.
function GuildCard() {
    const { t } = useTranslation('profile');
    const { data: guild, isLoading } = useMyGuildQuery();
    if (isLoading) {
        return (_jsxs(Card, { className: "flex-col gap-2 p-5", children: [_jsx("div", { className: "h-4 w-1/3 animate-pulse rounded bg-surface-3" }), _jsx("div", { className: "h-3 w-2/3 animate-pulse rounded bg-surface-3" })] }));
    }
    if (!guild) {
        return (_jsxs(Card, { className: "flex-col gap-0 overflow-hidden p-0", interactive: false, children: [_jsxs("div", { className: "flex flex-col gap-2 bg-gradient-to-br from-accent via-pink to-cyan p-5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Shield, { className: "h-4 w-4 text-white" }), _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-white", children: t('guild_label') })] }), _jsx("h3", { className: "font-display text-xl font-extrabold text-white", children: "\u0411\u0435\u0437 \u0433\u0438\u043B\u044C\u0434\u0438\u0438" }), _jsx("p", { className: "text-xs text-white/85", children: "\u041D\u0430\u0439\u0434\u0438 \u043A\u043E\u043C\u0430\u043D\u0434\u0443 \u2014 \u0440\u0435\u0439\u0442\u0438\u043D\u0433\u0438, \u0432\u043E\u0439\u043D\u044B, \u043E\u0431\u0449\u0438\u0435 \u043D\u0430\u0433\u0440\u0430\u0434\u044B." })] }), _jsx("div", { className: "flex items-center justify-between p-4", children: _jsx(Link, { to: "/guild", className: "font-mono text-[12px] font-semibold text-cyan hover:underline", children: "\u041D\u0430\u0439\u0442\u0438 \u0433\u0438\u043B\u044C\u0434\u0438\u044E \u203A" }) })] }));
    }
    return (_jsxs(Card, { className: "flex-col gap-0 overflow-hidden p-0", interactive: false, children: [_jsxs("div", { className: "flex flex-col gap-2 bg-gradient-to-br from-accent via-pink to-cyan p-5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Shield, { className: "h-4 w-4 text-white" }), _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-white", children: t('guild_label') })] }), _jsx("h3", { className: "font-display text-xl font-extrabold text-white", children: guild.name }), _jsxs("p", { className: "text-xs text-white/85", children: [(guild.members?.length ?? 0), " \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432 \u00B7 ELO ", guild.guild_elo] })] }), _jsx("div", { className: "flex items-center justify-between p-4", children: _jsx(Link, { to: "/guild", className: "font-mono text-[12px] font-semibold text-cyan hover:underline", children: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0433\u0438\u043B\u044C\u0434\u0438\u044E \u203A" }) })] }));
}
const SCOPES = ['global'];
function MedalBadge({ rank }) {
    if (rank === 1)
        return (_jsx("span", { className: "grid h-7 w-7 place-items-center rounded-full bg-warn font-display text-[13px] font-bold text-bg", children: _jsx(Crown, { className: "h-3.5 w-3.5" }) }));
    if (rank === 2)
        return (_jsx("span", { className: "grid h-7 w-7 place-items-center rounded-full bg-[#C0C0C0] font-display text-[13px] font-bold text-bg", children: "2" }));
    if (rank === 3)
        return (_jsx("span", { className: "grid h-7 w-7 place-items-center rounded-full bg-[#CD7F32] font-display text-[13px] font-bold text-white", children: "3" }));
    return (_jsx("span", { className: "grid h-7 w-7 place-items-center rounded-full bg-surface-1 font-mono text-[12px] font-semibold text-text-secondary", children: rank }));
}
// Leaderboard renders only real entries from the rating service. No fallback
// roster is rendered — when the leaderboard is empty (or the network is
// down) the user sees an explicit empty/error state instead of synthetic data.
function Leaderboard() {
    const { t } = useTranslation('profile');
    const [scope] = useState('global');
    const { data: lb, isError, isLoading, refetch } = useLeaderboardQuery('algorithms');
    const rows = (lb?.entries ?? []).map((e) => ({
        rank: e.rank,
        name: `@${e.username}`,
        tier: e.title ?? '—',
        lp: `${e.elo}`,
        wl: '—',
        wr: '—',
        delta: '+0',
    }));
    return (_jsxs("div", { className: "flex flex-1 flex-col overflow-hidden rounded-xl bg-surface-2 min-w-0", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-border px-5 py-4", children: [_jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: t('leaderboard') }), _jsx("div", { className: "flex items-center gap-1 rounded-md bg-surface-1 p-1", children: SCOPES.map((s) => (_jsx("span", { className: cn('h-7 rounded px-3 text-[12px] font-semibold leading-7 transition-colors', scope === s ? 'bg-accent text-text-primary' : 'text-text-secondary'), children: t(`scopes.${s}`) }, s))) })] }), _jsxs("div", { className: "grid grid-cols-[50px_1fr_70px_90px_60px_60px] min-w-[640px] items-center gap-3 border-b border-border px-5 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted", children: [_jsx("span", { children: t('table.rank') }), _jsx("span", { children: t('table.player') }), _jsx("span", { className: "text-right", children: t('table.lp') }), _jsx("span", { className: "text-right", children: t('table.wl') }), _jsx("span", { className: "text-right", children: t('table.wr') }), _jsx("span", { className: "text-right", children: t('table.delta') })] }), _jsxs("div", { className: "flex-1 overflow-x-auto", children: [isLoading && _jsx("div", { className: "px-5 py-3 text-[12px] text-text-muted", children: "\u2026" }), isError && (_jsxs("div", { className: "flex items-center justify-between px-5 py-3 text-[12px] text-danger", children: [_jsx("span", { children: t('load_failed') }), _jsx("button", { onClick: () => refetch(), className: "font-mono text-[12px] text-accent hover:underline", children: t('retry', { defaultValue: 'Retry' }) })] })), !isLoading && !isError && rows.length === 0 && (_jsx("div", { className: "px-5 py-3 text-[12px] text-text-muted", children: t('leaderboard_empty', { defaultValue: 'No entries yet' }) })), rows.map((r) => {
                        const positive = r.delta.startsWith('+');
                        return (_jsxs("div", { className: "grid grid-cols-[50px_1fr_70px_90px_60px_60px] min-w-[640px] items-center gap-3 px-5 py-2.5 text-[13px] transition-colors border-b border-border/50 hover:bg-surface-1/40", children: [_jsx(MedalBadge, { rank: r.rank }), _jsxs("div", { className: "flex items-center gap-2.5", children: [_jsx(Avatar, { size: "sm", gradient: "violet-cyan", initials: r.name[1]?.toUpperCase() }), _jsxs("div", { className: "flex flex-col leading-tight", children: [_jsx("span", { className: "text-sm font-semibold text-text-primary", children: r.name }), _jsx("span", { className: "font-mono text-[10px] text-text-muted", children: r.tier })] })] }), _jsx("span", { className: "text-right font-mono text-[13px] font-semibold text-text-primary", children: r.lp }), _jsx("span", { className: "text-right font-mono text-[12px] text-text-secondary", children: r.wl }), _jsx("span", { className: "text-right font-mono text-[12px] text-cyan", children: r.wr }), _jsx("span", { className: cn('text-right font-mono text-[12px] font-semibold', positive ? 'text-success' : 'text-danger'), children: r.delta })] }, r.rank));
                    })] })] }));
}
// ── states ─────────────────────────────────────────────────────────────────
function ProfileSkeleton() {
    return (_jsxs(AppShellV2, { children: [_jsxs("div", { className: "px-4 py-6 sm:px-8 lg:px-10", style: { minHeight: 220, background: 'linear-gradient(135deg, #582CFF 0%, #F472B6 50%, #22D3EE 100%)' }, "aria-busy": "true", "aria-label": "loading profile", children: [_jsx("div", { className: "h-24 w-24 animate-pulse rounded-full bg-white/20" }), _jsx("div", { className: "mt-4 h-6 w-40 animate-pulse rounded bg-white/20" }), _jsx("div", { className: "mt-2 h-4 w-64 animate-pulse rounded bg-white/15" })] }), _jsxs("div", { className: "flex flex-col gap-6 px-4 py-6 sm:px-8 lg:flex-row lg:px-10 lg:py-8", children: [_jsx("div", { className: "h-72 w-full animate-pulse rounded-xl bg-surface-2 lg:w-[380px]" }), _jsx("div", { className: "h-72 flex-1 animate-pulse rounded-xl bg-surface-2" })] })] }));
}
function ProfileError({ onRetry }) {
    const { t } = useTranslation('profile');
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8", children: [_jsx("h2", { className: "font-display text-xl font-bold text-text-primary", children: t('error_title', { defaultValue: 'Could not load profile' }) }), _jsx("p", { className: "max-w-md text-center text-sm text-text-secondary", children: t('load_failed') }), _jsx(Button, { variant: "primary", onClick: onRetry, children: t('retry', { defaultValue: 'Retry' }) })] }) }));
}
function ProfileNotFound({ username }) {
    const { t } = useTranslation('profile');
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8", children: [_jsx("h2", { className: "font-display text-xl font-bold text-text-primary", children: t('not_found_title', { defaultValue: 'Profile not found' }) }), _jsxs("p", { className: "max-w-md text-center text-sm text-text-secondary", children: ["@", username] }), _jsx(Link, { to: "/sanctum", children: _jsx(Button, { variant: "primary", children: t('back_to_sanctum', { defaultValue: 'Back to Sanctum' }) }) })] }) }));
}
// ── page ───────────────────────────────────────────────────────────────────
export default function ProfilePage() {
    const params = useParams();
    const isOwn = !params.username;
    const [tab, setTab] = useState('Overview');
    const ownQuery = useProfileQuery();
    const publicQuery = usePublicProfileQuery(isOwn ? undefined : params.username);
    const { data: rating } = useRatingMeQuery();
    const active = isOwn ? ownQuery : publicQuery;
    if (active.isLoading)
        return _jsx(ProfileSkeleton, {});
    if (active.isError) {
        const status = active.error?.status;
        if (!isOwn && status === 404) {
            return _jsx(ProfileNotFound, { username: params.username ?? '' });
        }
        return _jsx(ProfileError, { onRetry: () => active.refetch() });
    }
    const vm = toViewModel({
        isOwn,
        own: isOwn ? ownQuery.data : undefined,
        pub: !isOwn ? publicQuery.data : undefined,
        fallbackScore: rating?.global_power_score,
    });
    if (!vm)
        return _jsx(ProfileSkeleton, {});
    return (_jsxs(AppShellV2, { children: [_jsx(Hero, { vm: vm }), _jsx(ProfileTabBar, { tab: tab, setTab: setTab }), _jsxs("div", { className: "px-4 py-6 sm:px-8 lg:px-10 lg:py-8", children: [tab === 'Overview' && (_jsxs("div", { className: "flex flex-col gap-6 lg:flex-row", children: [_jsxs("div", { className: "flex w-full shrink-0 flex-col gap-5 lg:w-[380px]", children: [_jsx(SkillsCard, {}), isOwn && _jsx(AchievementsCard, {}), _jsx(GuildCard, {})] }), _jsx("div", { className: "flex min-w-0 flex-1 flex-col", children: _jsx(Leaderboard, {}) })] })), tab === 'Matches' && _jsx(MatchesPanel, {}), tab === 'Achievements' && _jsx(AchievementsPanel, {}), tab === 'Guilds' && _jsx(GuildsPanel, {}), tab === 'Stats' && _jsx(StatsPanel, { ownProfile: isOwn ? ownQuery.data : undefined })] })] }));
}
// ── tab panels ─────────────────────────────────────────────────────────────
function MatchesPanel() {
    const { data, isLoading, isError, refetch } = useArenaHistoryQuery({ limit: 10 });
    const items = data?.items ?? [];
    if (isLoading) {
        return (_jsxs(Card, { className: "flex-col gap-2 p-5", interactive: false, children: [_jsx("div", { className: "h-4 w-1/3 animate-pulse rounded bg-surface-3" }), _jsx("div", { className: "h-4 w-2/3 animate-pulse rounded bg-surface-3" })] }));
    }
    if (isError) {
        return (_jsxs(Card, { className: "flex-col items-start gap-3 p-5", interactive: false, children: [_jsx("p", { className: "text-sm text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u043C\u0430\u0442\u0447\u0435\u0439." }), _jsx(Button, { size: "sm", onClick: () => refetch(), children: "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C" })] }));
    }
    if (items.length === 0) {
        return (_jsx(Card, { className: "flex-col gap-2 p-5", interactive: false, children: _jsx("p", { className: "text-sm text-text-secondary", children: "\u0415\u0449\u0451 \u043D\u0435\u0442 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0445 \u043C\u0430\u0442\u0447\u0435\u0439. \u0421\u044B\u0433\u0440\u0430\u0439 \u043D\u0430 /arena." }) }));
    }
    return (_jsxs(Card, { className: "flex-col gap-0 overflow-hidden p-0", interactive: false, children: [_jsx("div", { className: "border-b border-border p-5", children: _jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 10 \u043C\u0430\u0442\u0447\u0435\u0439" }) }), _jsx("div", { className: "divide-y divide-border", children: items.map((m) => {
                    const positive = m.lp_change > 0;
                    const resultColor = m.result === 'win' ? 'text-success' : m.result === 'loss' ? 'text-danger' : 'text-text-muted';
                    return (_jsxs("div", { className: "grid grid-cols-[1fr_120px_80px_60px] items-center gap-3 px-5 py-3 text-[13px]", children: [_jsxs("div", { className: "flex min-w-0 items-center gap-3", children: [_jsx(Avatar, { size: "sm", gradient: "violet-cyan", initials: m.opponent_username[0]?.toUpperCase() }), _jsxs("div", { className: "flex min-w-0 flex-col", children: [_jsxs("span", { className: "truncate font-semibold text-text-primary", children: ["@", m.opponent_username] }), _jsxs("span", { className: "font-mono text-[11px] text-text-muted", children: [m.section, " \u00B7 ", m.mode] })] })] }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: new Date(m.finished_at).toLocaleString('ru-RU') }), _jsx("span", { className: cn('font-mono text-[12px] font-bold uppercase', resultColor), children: m.result }), _jsxs("span", { className: cn('text-right font-mono text-[12px] font-semibold', positive ? 'text-success' : 'text-danger'), children: [positive ? '+' : '', m.lp_change] })] }, m.match_id));
                }) })] }));
}
function AchievementsPanel() {
    const { data, isLoading, isError, refetch } = useAchievementsQuery();
    const unlocked = (data ?? []).filter(isUnlocked);
    if (isLoading) {
        return (_jsx(Card, { className: "flex-col gap-2 p-5", interactive: false, children: _jsx("div", { className: "h-4 w-1/3 animate-pulse rounded bg-surface-3" }) }));
    }
    if (isError) {
        return (_jsxs(Card, { className: "flex-col items-start gap-3 p-5", interactive: false, children: [_jsx("p", { className: "text-sm text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0430\u0447\u0438\u0432\u043A\u0438." }), _jsx(Button, { size: "sm", onClick: () => refetch(), children: "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C" })] }));
    }
    if (unlocked.length === 0) {
        return (_jsx(Card, { className: "flex-col gap-2 p-5", interactive: false, children: _jsxs("p", { className: "text-sm text-text-secondary", children: ["\u0415\u0449\u0451 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u0440\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043E. \u041E\u0442\u043A\u0440\u043E\u0439 ", _jsx(Link, { className: "text-cyan hover:underline", to: "/achievements", children: "\u0432\u0441\u0435 \u0430\u0447\u0438\u0432\u043A\u0438" }), ", \u0447\u0442\u043E\u0431\u044B \u0443\u0432\u0438\u0434\u0435\u0442\u044C \u0443\u0441\u043B\u043E\u0432\u0438\u044F \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u044F."] }) }));
    }
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0420\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u0430\u0447\u0438\u0432\u043A\u0438" }), _jsx(Link, { to: "/achievements", className: "font-mono text-[11px] text-cyan hover:underline", children: "\u0412\u0441\u0435 \u203A" })] }), _jsx("div", { className: "grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4", children: unlocked.map((a) => (_jsxs("div", { className: cn('flex flex-col gap-2 rounded-lg p-3', a.tier === 'legendary'
                        ? 'bg-gradient-to-br from-warn to-pink'
                        : a.tier === 'rare'
                            ? 'bg-gradient-to-br from-cyan to-accent'
                            : 'bg-surface-2'), children: [_jsx(Trophy, { className: "h-5 w-5 text-white" }), _jsx("span", { className: "font-display text-[13px] font-bold text-white", children: a.title }), _jsx("span", { className: "line-clamp-2 font-mono text-[10px] text-white/80", children: a.description }), a.unlocked_at && (_jsx("span", { className: "font-mono text-[10px] text-white/60", children: new Date(a.unlocked_at).toLocaleDateString('ru-RU') }))] }, a.code))) })] }));
}
function GuildsPanel() {
    const { data: guild, isLoading, isError, refetch } = useMyGuildQuery();
    if (isLoading) {
        return (_jsx(Card, { className: "flex-col gap-2 p-5", interactive: false, children: _jsx("div", { className: "h-4 w-1/3 animate-pulse rounded bg-surface-3" }) }));
    }
    if (isError) {
        return (_jsxs(Card, { className: "flex-col items-start gap-3 p-5", interactive: false, children: [_jsx("p", { className: "text-sm text-danger", children: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0433\u0438\u043B\u044C\u0434\u0438\u044E." }), _jsx(Button, { size: "sm", onClick: () => refetch(), children: "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C" })] }));
    }
    if (!guild) {
        return (_jsxs(Card, { className: "flex-col items-start gap-3 p-5", interactive: false, children: [_jsx("p", { className: "text-sm text-text-secondary", children: "\u0422\u044B \u043F\u043E\u043A\u0430 \u0431\u0435\u0437 \u0433\u0438\u043B\u044C\u0434\u0438\u0438." }), _jsx(Link, { to: "/guild", children: _jsx(Button, { size: "sm", children: "\u041D\u0430\u0439\u0442\u0438 \u0433\u0438\u043B\u044C\u0434\u0438\u044E" }) })] }));
    }
    return (_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(Shield, { className: "h-6 w-6 text-cyan" }), _jsxs("div", { className: "flex flex-col", children: [_jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: guild.name }), _jsxs("span", { className: "font-mono text-[11px] text-text-muted", children: [(guild.members?.length ?? 0), " \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432 \u00B7 ELO ", guild.guild_elo] })] })] }), _jsx(Link, { to: "/guild", className: "font-mono text-[12px] text-cyan hover:underline", children: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0433\u0438\u043B\u044C\u0434\u0438\u0438 \u203A" })] }));
}
function StatsPanel({ ownProfile }) {
    const { data: rating, isLoading } = useRatingMeQuery();
    if (isLoading) {
        return (_jsx(Card, { className: "flex-col gap-2 p-5", interactive: false, children: _jsx("div", { className: "h-4 w-1/3 animate-pulse rounded bg-surface-3" }) }));
    }
    const ratings = rating?.ratings ?? [];
    return (_jsxs("div", { className: "flex flex-col gap-4", children: [_jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0421\u0432\u043E\u0434\u043A\u0430" }), _jsxs("div", { className: "grid grid-cols-2 gap-3 md:grid-cols-4", children: [_jsx(StatCell, { label: "Global Score", value: String(rating?.global_power_score ?? 0) }), _jsx(StatCell, { label: "\u0423\u0440\u043E\u0432\u0435\u043D\u044C", value: String(ownProfile?.level ?? 0) }), _jsx(StatCell, { label: "XP", value: String(ownProfile?.xp ?? 0) }), _jsx(StatCell, { label: "AI \u043A\u0440\u0435\u0434\u0438\u0442\u044B", value: String(ownProfile?.ai_credits ?? 0) })] })] }), _jsxs(Card, { className: "flex-col gap-3 p-5", interactive: false, children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: "\u0420\u0435\u0439\u0442\u0438\u043D\u0433 \u043F\u043E \u0441\u0435\u043A\u0446\u0438\u044F\u043C" }), ratings.length === 0 ? (_jsx("p", { className: "text-[12px] text-text-muted", children: "\u0415\u0449\u0451 \u043D\u0435 \u0441\u044B\u0433\u0440\u0430\u043B \u043D\u0438 \u043E\u0434\u043D\u043E\u0433\u043E \u043C\u0430\u0442\u0447\u0430." })) : (_jsx("div", { className: "grid grid-cols-2 gap-3 md:grid-cols-3", children: ratings.map((r) => (_jsxs("div", { className: "flex flex-col gap-1 rounded-lg bg-surface-2 p-3", children: [_jsx("span", { className: "font-mono text-[10px] uppercase text-text-muted", children: r.section }), _jsx("span", { className: "font-display text-lg font-bold text-text-primary", children: r.elo }), _jsxs("span", { className: "font-mono text-[11px] text-text-muted", children: [r.matches_count, " \u043C\u0430\u0442\u0447\u0435\u0439"] })] }, r.section))) }))] })] }));
}
function StatCell({ label, value }) {
    return (_jsxs("div", { className: "flex flex-col gap-1 rounded-lg bg-surface-2 p-3", children: [_jsx("span", { className: "font-mono text-[10px] uppercase text-text-muted", children: label }), _jsx("span", { className: "font-display text-xl font-bold text-text-primary", children: value })] }));
}
