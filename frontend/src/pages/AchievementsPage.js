import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Trophy, Flame, Zap, Shield, Sparkles, Award, Swords, Crown, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShellV2 } from '../components/AppShell';
import { Card } from '../components/Card';
import { useAchievementsQuery } from '../lib/queries/achievements';
function ErrorChip() {
    const { t } = useTranslation('pages');
    return (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: t('common.load_failed') }));
}
const RARITY_BORDER = {
    common: 'border-border-strong',
    rare: 'border-cyan/50',
    legendary: 'border-warn/60',
};
const RARITY_LABEL = {
    common: 'COMMON',
    rare: 'RARE',
    legendary: 'LEGENDARY',
};
const RARITY_TEXT = {
    common: 'text-text-muted',
    rare: 'text-cyan',
    legendary: 'text-warn',
};
const ICON_MAP = {
    'speed-demon': { icon: _jsx(Flame, { className: "h-10 w-10 text-text-primary" }), grad: 'from-warn to-danger' },
    'first-blood': { icon: _jsx(Swords, { className: "h-10 w-10 text-text-primary" }), grad: 'from-pink to-accent' },
    'streak-master': { icon: _jsx(Zap, { className: "h-10 w-10 text-text-primary" }), grad: 'from-cyan to-accent' },
    'iron-defender': { icon: _jsx(Shield, { className: "h-10 w-10 text-text-primary" }), grad: 'from-success to-cyan' },
    'algo-sage': { icon: _jsx(Sparkles, { className: "h-10 w-10 text-text-primary" }), grad: 'from-accent to-pink' },
    'trophy-hunter': { icon: _jsx(Trophy, { className: "h-10 w-10 text-text-primary" }), grad: 'from-warn to-pink' },
    'champion': { icon: _jsx(Crown, { className: "h-10 w-10 text-text-primary" }), grad: 'from-warn to-accent' },
    'daily-hero': { icon: _jsx(Award, { className: "h-10 w-10 text-text-primary" }), grad: 'from-cyan to-success' },
    'code-warrior': { icon: _jsx(Swords, { className: "h-10 w-10 text-text-primary" }), grad: 'from-accent to-cyan' },
    'spark-caster': { icon: _jsx(Sparkles, { className: "h-10 w-10 text-text-primary" }), grad: 'from-pink to-warn' },
    'guardian': { icon: _jsx(Shield, { className: "h-10 w-10 text-text-primary" }), grad: 'from-cyan to-accent' },
    'inferno': { icon: _jsx(Flame, { className: "h-10 w-10 text-text-primary" }), grad: 'from-danger to-warn' },
};
function toUiAch(a) {
    const map = ICON_MAP[a.id] ?? { icon: _jsx(Trophy, { className: "h-10 w-10 text-text-primary" }), grad: 'from-surface-3 to-bg' };
    return {
        name: a.name,
        progress: a.progress,
        rarity: a.rarity,
        icon: map.icon,
        grad: a.locked ? 'from-surface-3 to-bg' : map.grad,
        locked: a.locked,
    };
}
const ACHS = [
    { name: 'Speed Demon', progress: '10 / 10', rarity: 'legendary', icon: _jsx(Flame, { className: "h-10 w-10 text-text-primary" }), grad: 'from-warn to-danger' },
    { name: 'First Blood', progress: '1 / 1', rarity: 'common', icon: _jsx(Swords, { className: "h-10 w-10 text-text-primary" }), grad: 'from-pink to-accent' },
    { name: 'Streak Master', progress: '12 / 30', rarity: 'rare', icon: _jsx(Zap, { className: "h-10 w-10 text-text-primary" }), grad: 'from-cyan to-accent' },
    { name: 'Iron Defender', progress: '5 / 10', rarity: 'rare', icon: _jsx(Shield, { className: "h-10 w-10 text-text-primary" }), grad: 'from-success to-cyan' },
    { name: 'Algorithm Sage', progress: '50 / 50', rarity: 'legendary', icon: _jsx(Sparkles, { className: "h-10 w-10 text-text-primary" }), grad: 'from-accent to-pink' },
    { name: 'Trophy Hunter', progress: '23 / 47', rarity: 'rare', icon: _jsx(Trophy, { className: "h-10 w-10 text-text-primary" }), grad: 'from-warn to-pink' },
    { name: 'Champion', progress: '1 / 1', rarity: 'legendary', icon: _jsx(Crown, { className: "h-10 w-10 text-text-primary" }), grad: 'from-warn to-accent' },
    { name: 'Daily Hero', progress: '30 / 30', rarity: 'common', icon: _jsx(Award, { className: "h-10 w-10 text-text-primary" }), grad: 'from-cyan to-success' },
    { name: 'Code Warrior', progress: '100 / 100', rarity: 'rare', icon: _jsx(Swords, { className: "h-10 w-10 text-text-primary" }), grad: 'from-accent to-cyan' },
    { name: 'Spark Caster', progress: '7 / 20', rarity: 'common', icon: _jsx(Sparkles, { className: "h-10 w-10 text-text-primary" }), grad: 'from-pink to-warn' },
    { name: 'Guardian', progress: '15 / 25', rarity: 'rare', icon: _jsx(Shield, { className: "h-10 w-10 text-text-primary" }), grad: 'from-cyan to-accent' },
    { name: 'Inferno', progress: '40 / 50', rarity: 'legendary', icon: _jsx(Flame, { className: "h-10 w-10 text-text-primary" }), grad: 'from-danger to-warn' },
    { name: '???', progress: '— / —', rarity: 'common', icon: _jsx(Trophy, { className: "h-10 w-10 text-text-primary" }), grad: 'from-surface-3 to-bg', locked: true },
    { name: '???', progress: '— / —', rarity: 'rare', icon: _jsx(Zap, { className: "h-10 w-10 text-text-primary" }), grad: 'from-surface-3 to-bg', locked: true },
    { name: '???', progress: '— / —', rarity: 'legendary', icon: _jsx(Crown, { className: "h-10 w-10 text-text-primary" }), grad: 'from-surface-3 to-bg', locked: true },
    { name: '???', progress: '— / —', rarity: 'common', icon: _jsx(Award, { className: "h-10 w-10 text-text-primary" }), grad: 'from-surface-3 to-bg', locked: true },
];
function FilterChip({ label, active }) {
    return (_jsx("button", { className: `rounded-full border px-3 py-1.5 text-[13px] transition-colors ${active
            ? 'border-accent bg-accent/15 font-semibold text-accent-hover'
            : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong hover:text-text-primary'}`, children: label }));
}
function Tile({ a }) {
    return (_jsxs("div", { className: `relative flex h-[200px] flex-col overflow-hidden rounded-[14px] border-2 bg-surface-2 ${RARITY_BORDER[a.rarity]} ${a.locked ? 'opacity-40' : ''}`, children: [_jsx("div", { className: `grid h-[100px] place-items-center bg-gradient-to-br ${a.grad}`, children: a.locked ? _jsx(Lock, { className: "h-10 w-10 text-text-primary" }) : a.icon }), _jsxs("div", { className: "flex flex-1 flex-col gap-1 p-3", children: [_jsx("span", { className: "font-sans text-[13px] font-bold text-text-primary", children: a.name }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: a.progress }), _jsx("span", { className: `mt-auto font-mono text-[10px] font-semibold tracking-[0.08em] ${RARITY_TEXT[a.rarity]}`, children: RARITY_LABEL[a.rarity] })] })] }));
}
function FeaturedAch({ name, rarity, description, reward }) {
    const { t } = useTranslation('pages');
    return (_jsxs(Card, { className: "w-full flex-col gap-4 p-0 lg:w-[320px]", children: [_jsx("div", { className: "grid h-[180px] place-items-center bg-gradient-to-br from-warn to-danger", children: _jsx(Flame, { className: "h-16 w-16 text-text-primary" }) }), _jsxs("div", { className: "flex flex-col gap-3 p-5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "font-display text-xl font-bold text-text-primary", children: name }), _jsx("span", { className: `font-mono text-[11px] font-semibold ${RARITY_TEXT[rarity]}`, children: RARITY_LABEL[rarity] })] }), _jsx("p", { className: "text-xs text-text-secondary", children: description }), _jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: t('achievements.requirements') }), _jsxs("ul", { className: "flex flex-col gap-1.5 text-[12px] text-text-secondary", children: [_jsx("li", { children: "\u00B7 10 \u0440\u0435\u0448\u0435\u043D\u0438\u0439 Medium" }), _jsx("li", { children: "\u00B7 \u043A\u0430\u0436\u0434\u043E\u0435 \u043C\u0435\u043D\u0435\u0435 5:00" }), _jsx("li", { children: "\u00B7 \u0431\u0435\u0437 \u043F\u043E\u0434\u0441\u043A\u0430\u0437\u043E\u043A \u0438 AI" })] })] }), _jsxs("div", { className: "rounded-lg border border-warn/30 bg-warn/10 p-3", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold text-warn", children: t('achievements.reward') }), _jsx("p", { className: "mt-1 text-sm font-bold text-text-primary", children: reward })] })] })] }));
}
export default function AchievementsPage() {
    const { t } = useTranslation('pages');
    const { data, isError } = useAchievementsQuery();
    const total = data?.total ?? 47;
    const unlocked = data?.unlocked ?? 23;
    const rare = data?.rare_count ?? 6;
    const counts = data?.counts ?? { common: 30, rare: 12, legendary: 5, hidden: 12 };
    const items = data?.items ? data.items.map(toUiAch) : ACHS;
    const featured = data?.items?.find((a) => a.id === data.featured_id);
    const featuredName = featured?.name ?? 'Speed Demon';
    const featuredRarity = (featured?.rarity ?? 'legendary');
    const featuredDesc = featured?.description ?? 'Решить 10 Medium-задач подряд за время менее 5 минут каждая. Только для самых быстрых.';
    const featuredReward = featured?.reward ?? '+500 XP · +Title "Speed Demon"';
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex flex-col gap-5 px-4 pb-6 pt-6 sm:px-8 lg:px-20 lg:pb-7 lg:pt-7", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("h1", { className: "font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary", children: t('achievements.title') }), _jsx("p", { className: "text-sm text-text-secondary", children: t('achievements.summary', { unlocked, total, rare }) }), isError && _jsx(ErrorChip, {})] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx(FilterChip, { label: `${t('achievements.all')} · ${total}`, active: true }), _jsx(FilterChip, { label: `${t('achievements.unlocked')} · ${unlocked}` }), _jsx(FilterChip, { label: `${t('achievements.hidden')} · ${counts.hidden}` }), _jsx(FilterChip, { label: `${t('achievements.common')} · ${counts.common}` }), _jsx(FilterChip, { label: `${t('achievements.rare')} · ${counts.rare}` }), _jsx(FilterChip, { label: `${t('achievements.legendary')} · ${counts.legendary}` })] }), _jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:gap-6", children: [_jsx("div", { className: "grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4", children: items.map((a, i) => (_jsx(Tile, { a: a }, i))) }), _jsx(FeaturedAch, { name: featuredName, rarity: featuredRarity, description: featuredDesc, reward: featuredReward })] })] }) }));
}
