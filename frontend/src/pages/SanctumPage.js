import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { ArrowRight, Flame, Play, Sparkles, Shield, Swords } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AppShellV2 } from '../components/AppShell';
import { staggerContainer, staggerItem } from '../lib/motion';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Avatar } from '../components/Avatar';
import { useDailyKataQuery, useStreakQuery } from '../lib/queries/daily';
import { useSeasonQuery } from '../lib/queries/season';
import { useRatingMeQuery, useLeaderboardQuery } from '../lib/queries/rating';
import { useProfileQuery } from '../lib/queries/profile';
import { useArenaHistoryQuery } from '../lib/queries/matches';
import { useMyGuildQuery, useGuildWarQuery } from '../lib/queries/guild';
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
    return (_jsxs("div", { className: "flex flex-col items-start gap-4 lg:flex-row lg:items-end lg:justify-between", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("h1", { className: "font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[32px]", children: t('sanctum:welcome', { name }) }), _jsx("p", { className: "text-sm text-text-secondary", children: t('sanctum:subtitle', { streak: current }) })] }), _jsx(Link, { to: "/arena", className: "w-full sm:w-auto", children: _jsx(Button, { variant: "primary", icon: _jsx(Swords, { className: "h-[18px] w-[18px]" }), iconRight: _jsx(ArrowRight, { className: "h-4 w-4" }), className: "w-full justify-center px-5 py-3 text-sm sm:w-auto", children: t('common:buttons.find_opponent') }) })] }));
}
// Время до сброса kata: считаем UTC-полночь как rolling deadline
// (бэк выдаёт новую kata в 00:00 UTC). Возвращаем "HH:MM"; если до сброса
// меньше часа — "MM:SS".
function fmtTimeUntilUTCMidnight(now = new Date()) {
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
    const diff = next.getTime() - now.getTime();
    if (diff <= 0)
        return '00:00';
    const totalSec = Math.floor(diff / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec - h * 3600) / 60);
    const s = totalSec - h * 3600 - m * 60;
    if (h > 0)
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function DailyHero() {
    const { t } = useTranslation('sanctum');
    const { data: kata, isError, isLoading } = useDailyKataQuery();
    const { data: streak } = useStreakQuery();
    const day = streak?.current ?? 0;
    const title = kata?.task?.title ?? (isLoading ? '...' : 'Сегодняшняя задача недоступна');
    const difficulty = kata?.task?.difficulty;
    const section = kata?.task?.section;
    const meta = [difficulty, section].filter(Boolean).join(' · ') || '—';
    const remaining = fmtTimeUntilUTCMidnight();
    return (_jsxs(Card, { className: "flex-1 flex-col gap-5 p-7", interactive: false, children: [_jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex flex-col gap-2", children: [_jsxs("span", { className: "inline-flex w-fit items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn", children: [_jsx(Flame, { className: "h-3 w-3" }), " ", t('daily_kata_day', { day })] }), isError && _jsx(ErrorChip, {}), _jsx("h2", { className: "w-full max-w-[540px] font-display text-2xl font-bold text-text-primary", children: title }), _jsx("p", { className: "font-mono text-xs text-text-muted", children: meta })] }), _jsxs("div", { className: "flex flex-col items-end gap-1", children: [_jsx("span", { className: "font-display text-[28px] font-bold text-cyan", children: remaining }), _jsx("span", { className: "text-xs text-text-muted", children: t('remaining') })] })] }), _jsxs("div", { className: "flex flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:justify-between", children: [_jsxs("div", { className: "flex flex-wrap gap-6", children: [_jsx(Stat, { value: `${day} ${day > 0 ? '🔥' : ''}`, label: t('streak_days'), highlight: "warn" }), kata?.already_submitted && _jsx(Stat, { value: "\u2713", label: t('passed_today'), highlight: "cyan" })] }), _jsx(Link, { to: "/daily", children: _jsx(Button, { variant: "primary", iconRight: _jsx(ArrowRight, { className: "h-4 w-4" }), className: "bg-text-primary text-bg shadow-none hover:bg-white/90 hover:shadow-none", children: kata?.already_submitted ? 'Открыть' : t('begin') }) })] })] }));
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
    return (_jsxs(Card, { className: "flex-1 flex-col gap-3.5 p-5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Swords, { className: "h-4 w-4 text-pink" }), _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-pink", children: t('arena_label') })] }), _jsx("h3", { className: "font-display text-xl font-bold text-text-primary", children: t('ranked_1v1') }), _jsxs("div", { className: "flex gap-4", children: [_jsx(Stat, { value: `${matches}`, label: t('matches') }), _jsx(Stat, { value: `${elo}`, label: t('elo'), highlight: "cyan" }), _jsx(Stat, { value: `${algo?.percentile ?? 0}%`, label: t('percentile'), highlight: "cyan" })] }), _jsx(Link, { to: "/arena", children: _jsx(Button, { variant: "ghost", icon: _jsx(Play, { className: "h-3.5 w-3.5" }), className: "border-accent text-accent-hover hover:bg-accent/10", children: t('queue') }) })] }));
}
function GuildCard() {
    const { t } = useTranslation('sanctum');
    const { data: guild } = useMyGuildQuery();
    const warID = guild?.current_war_id ?? undefined;
    const { data: war } = useGuildWarQuery(warID);
    if (!guild) {
        // Empty-state: пользователь без гильдии — короткий CTA, без фейковых
        // 2140 vs 1670. Линкуем на /guild, где можно создать или вступить.
        return (_jsxs(Card, { className: "flex-1 flex-col gap-3.5 p-5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Shield, { className: "h-4 w-4 text-cyan" }), _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan", children: t('guild_war') })] }), _jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: "\u0422\u044B \u043F\u043E\u043A\u0430 \u0431\u0435\u0437 \u0433\u0438\u043B\u044C\u0434\u0438\u0438" }), _jsx("p", { className: "text-xs text-text-secondary", children: "\u0413\u0438\u043B\u044C\u0434\u0438\u0438 \u0438\u0433\u0440\u0430\u044E\u0442 \u0435\u0436\u0435\u043D\u0435\u0434\u0435\u043B\u044C\u043D\u044B\u0435 guild-war-\u0431\u0430\u0442\u0430\u043B\u0438\u0438. \u041D\u0430\u0439\u0434\u0438 \u0441\u0432\u043E\u044E \u0438\u043B\u0438 \u0441\u043E\u0437\u0434\u0430\u0439." }), _jsx(Link, { to: "/guild", className: "text-xs font-semibold text-accent-hover hover:underline", children: "\u041A \u0441\u043F\u0438\u0441\u043A\u0443 \u0433\u0438\u043B\u044C\u0434\u0438\u0439 \u2192" })] }));
    }
    // Если гильдия есть, но текущей войны нет — показываем имя гильдии и
    // GP без поддельного скоринга.
    if (!war) {
        return (_jsxs(Card, { className: "flex-1 flex-col gap-3.5 p-5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Shield, { className: "h-4 w-4 text-cyan" }), _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan", children: t('guild_war') })] }), _jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: guild.name }), _jsx("p", { className: "text-xs text-text-secondary", children: "\u0410\u043A\u0442\u0438\u0432\u043D\u043E\u0439 \u0432\u043E\u0439\u043D\u044B \u043D\u0435\u0442 \u2014 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0430\u044F \u0441\u0442\u0430\u0440\u0442\u0443\u0435\u0442 \u0441 \u043F\u043E\u043D\u0435\u0434\u0435\u043B\u044C\u043D\u0438\u043A\u0430." }), _jsxs("span", { className: "font-mono text-xs text-text-muted", children: ["Guild ELO: ", guild.guild_elo] })] }));
    }
    // Реальная война: суммируем линии. score_a/b — суммы по секциям.
    const scoreA = war.lines.reduce((s, l) => s + (l.score_a ?? 0), 0);
    const scoreB = war.lines.reduce((s, l) => s + (l.score_b ?? 0), 0);
    const total = Math.max(1, scoreA + scoreB);
    const aPct = Math.round((scoreA / total) * 100);
    const bPct = 100 - aPct;
    return (_jsxs(Card, { className: "flex-1 flex-col gap-3.5 p-5", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Shield, { className: "h-4 w-4 text-cyan" }), _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan", children: t('guild_war') })] }), _jsxs("h3", { className: "font-display text-lg font-bold text-text-primary", children: [war.guild_a.name, " vs ", war.guild_b.name] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "font-display text-[22px] font-bold text-success", children: scoreA }), _jsxs("div", { className: "flex h-2 flex-1 overflow-hidden rounded-full bg-black/30", children: [_jsx("div", { className: "h-full bg-success", style: { width: `${aPct}%` } }), _jsx("div", { className: "h-full bg-danger", style: { width: `${bPct}%` } })] }), _jsx("span", { className: "font-display text-[22px] font-bold text-danger", children: scoreB })] })] }));
}
// Карточка-CTA на еженедельный AI-отчёт. Заменила собой фиктивный
// "Слабое место: dynamic programming · 3/10" — раньше это была статика
// в локали, не данные. Реальный отчёт живёт на /weekly через
// useWeeklyReportQuery (Group A).
function CoachCard() {
    const { t } = useTranslation('sanctum');
    return (_jsxs("div", { className: "flex flex-1 flex-col gap-3 rounded-xl bg-gradient-to-br from-accent to-pink p-5 shadow-glow", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Sparkles, { className: "h-4 w-4 text-text-primary" }), _jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-primary", children: t('ai_mentor') })] }), _jsx("h3", { className: "w-full max-w-[300px] font-display text-base font-bold text-text-primary", children: "\u0415\u0436\u0435\u043D\u0435\u0434\u0435\u043B\u044C\u043D\u044B\u0439 AI-\u0440\u0430\u0437\u0431\u043E\u0440" }), _jsx("p", { className: "w-full max-w-[300px] text-xs text-white/80", children: "\u0421\u043B\u0430\u0431\u044B\u0435 \u0437\u043E\u043D\u044B, \u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0430\u0446\u0438\u0438 \u0438 \u043F\u043B\u0430\u043D \u2014 \u0441\u043E\u0431\u0438\u0440\u0430\u0435\u0442\u0441\u044F \u043F\u043E \u0442\u0432\u043E\u0435\u0439 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u0438 \u0437\u0430 \u043F\u0440\u043E\u0448\u043B\u0443\u044E \u043D\u0435\u0434\u0435\u043B\u044E." }), _jsxs(Link, { to: "/weekly", className: "inline-flex w-fit items-center gap-1.5 rounded-md bg-white/20 px-3.5 py-2 text-xs font-semibold text-text-primary hover:bg-white/30", children: [t('open_plan'), " ", _jsx(ArrowRight, { className: "h-3.5 w-3.5" })] })] }));
}
// Mini-leaderboard — топ-5 algorithms-секции. Раньше показывали
// захардкоженные имена (@alexey / @kirill_dev / @you), что вводило
// пользователя в заблуждение, когда бэк падал. Теперь — реальные
// записи; при isError или пустом ответе даём empty-state.
function Leaderboard() {
    const { t } = useTranslation('sanctum');
    const { data: lb, isError, isLoading } = useLeaderboardQuery({ section: 'algorithms', limit: 5 });
    const entries = lb?.entries ?? [];
    const myRank = lb?.my_rank ?? 0;
    const medalBg = (idx) => idx === 0 ? 'bg-warn text-bg'
        : idx === 1 ? 'bg-border-strong text-text-secondary'
            : idx === 2 ? 'bg-accent text-text-primary'
                : 'bg-border-strong text-text-secondary';
    return (_jsxs(Card, { className: "w-full flex-col gap-3 p-5 lg:w-[420px]", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: t('top_friends') }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: isError ? '—' : t('week') })] }), isError && _jsx(ErrorChip, {}), isLoading && (_jsxs(_Fragment, { children: [_jsx("div", { className: "h-9 animate-pulse rounded bg-surface-2" }), _jsx("div", { className: "h-9 animate-pulse rounded bg-surface-2" }), _jsx("div", { className: "h-9 animate-pulse rounded bg-surface-2" })] })), !isLoading && entries.length === 0 && !isError && (_jsx("p", { className: "text-xs text-text-muted", children: "\u041B\u0438\u0434\u0435\u0440\u0431\u043E\u0440\u0434 \u0441\u0435\u043A\u0446\u0438\u0438 \u043F\u0443\u0441\u0442 \u2014 \u0441\u044B\u0433\u0440\u0430\u0439 ranked-\u043C\u0430\u0442\u0447." })), entries.map((e, idx) => {
                const you = myRank === e.rank;
                return (_jsxs("div", { className: ['flex items-center gap-3 rounded-lg px-2 py-2', you ? 'bg-accent/10' : ''].join(' '), children: [_jsx("span", { className: `grid h-7 w-7 shrink-0 place-items-center rounded-full font-display text-[13px] font-bold ${medalBg(idx)}`, children: e.rank }), _jsx(Avatar, { size: "sm", gradient: "violet-cyan", initials: (e.username[0] ?? '?').toUpperCase() }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col gap-0.5", children: [_jsxs("span", { className: cn('truncate', you ? 'text-sm font-bold text-text-primary' : 'text-sm font-semibold text-text-primary'), children: ["@", e.username] }), _jsx("span", { className: cn('truncate font-mono text-[11px]', you ? 'text-accent-hover' : 'text-text-muted'), children: e.title ? `${e.title} · ${e.elo} ELO` : `${e.elo} ELO` })] })] }, `${e.user_id}:${e.rank}`));
            })] }));
}
// fmtAgo — компактный «5 мин» / «2 ч» / «3 д» для ленты активности.
// Берём timestamp ISO с бэка и считаем относительно сейчас.
function fmtAgo(iso, now = new Date()) {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t))
        return '';
    const diffSec = Math.max(0, Math.floor((now.getTime() - t) / 1000));
    if (diffSec < 60)
        return 'только что';
    const m = Math.floor(diffSec / 60);
    if (m < 60)
        return `${m} мин`;
    const h = Math.floor(m / 60);
    if (h < 24)
        return `${h} ч`;
    const d = Math.floor(h / 24);
    return `${d} д`;
}
function fmtDuration(sec) {
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}
function Activity() {
    const { t } = useTranslation(['sanctum', 'common']);
    const { data, isError, isLoading } = useArenaHistoryQuery({ limit: 3 });
    const items = data?.items ?? [];
    return (_jsxs(Card, { className: "flex-1 flex-col gap-3.5 p-5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "font-display text-base font-bold text-text-primary", children: t('sanctum:recent_activity') }), _jsx(Link, { to: "/match-history", className: "text-xs text-text-muted hover:text-text-secondary", children: t('common:buttons.view_all') })] }), isError && _jsx(ErrorChip, {}), isLoading && (_jsxs(_Fragment, { children: [_jsx("div", { className: "h-12 animate-pulse rounded bg-surface-2" }), _jsx("div", { className: "h-12 animate-pulse rounded bg-surface-2" })] })), !isLoading && items.length === 0 && !isError && (_jsx("p", { className: "text-xs text-text-muted", children: "\u0421\u044B\u0433\u0440\u0430\u0439 \u043F\u0435\u0440\u0432\u044B\u0439 \u043C\u0430\u0442\u0447 \u2014 \u043E\u043D \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u0437\u0434\u0435\u0441\u044C." })), items.map((m) => {
                const won = m.result === 'win';
                const lpSign = m.lp_change >= 0 ? '+' : '';
                return (_jsxs("div", { className: "flex items-center gap-3 py-2", children: [_jsx("span", { className: `grid h-9 w-9 shrink-0 place-items-center rounded-full ${won ? 'bg-success/15' : 'bg-danger/15'}`, children: _jsx(Swords, { className: `h-4 w-4 ${won ? 'text-success' : 'text-danger'}` }) }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col gap-0.5", children: [_jsxs("span", { className: "truncate text-sm font-semibold text-text-primary", children: [won ? 'Победа' : m.result === 'loss' ? 'Поражение' : 'Матч', " \u00B7 vs @", m.opponent_username || m.opponent_user_id.slice(0, 6)] }), _jsxs("span", { className: "truncate text-[11px] text-text-muted", children: [m.section, " \u00B7 ", fmtDuration(m.duration_seconds), " \u00B7 ", lpSign, m.lp_change, " LP"] })] }), _jsx("span", { className: "shrink-0 font-mono text-[11px] text-text-muted", children: fmtAgo(m.finished_at) })] }, m.match_id));
            })] }));
}
export default function SanctumPageV2() {
    const reduced = useReducedMotion();
    const containerProps = reduced
        ? {}
        : { variants: staggerContainer, initial: 'hidden', animate: 'show' };
    const itemProps = reduced ? {} : { variants: staggerItem };
    return (_jsx(AppShellV2, { children: _jsxs(motion.div, { className: "flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8", ...containerProps, children: [_jsx(motion.div, { ...itemProps, children: _jsx(HeaderRow, {}) }), _jsxs(motion.div, { className: "flex flex-col gap-5 lg:h-[280px] lg:flex-row", ...itemProps, children: [_jsx(DailyHero, {}), _jsx(SeasonRank, {})] }), _jsxs(motion.div, { className: "flex flex-col gap-5 lg:h-[220px] lg:flex-row", ...itemProps, children: [_jsx(ArenaCard, {}), _jsx(GuildCard, {}), _jsx(CoachCard, {})] }), _jsxs(motion.div, { className: "flex flex-col gap-5 lg:h-[260px] lg:flex-row", ...itemProps, children: [_jsx(Activity, {}), _jsx(Leaderboard, {})] })] }) }));
}
