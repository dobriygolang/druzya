import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { Trophy, Flame, Zap, Shield, Sparkles, Award, Swords, Crown, Lock, Users, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShellV2 } from '../components/AppShell';
import { Card } from '../components/Card';
import { useAchievementsQuery, summarise, isUnlocked, progressLabel, } from '../lib/queries/achievements';
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
// Маппинг category → визуал. Легче поддерживать, чем code-by-code.
const CATEGORY_VISUAL = {
    combat: { icon: _jsx(Swords, { className: "h-10 w-10 text-text-primary" }), grad: 'from-pink to-accent' },
    consistency: { icon: _jsx(Flame, { className: "h-10 w-10 text-text-primary" }), grad: 'from-warn to-danger' },
    social: { icon: _jsx(Users, { className: "h-10 w-10 text-text-primary" }), grad: 'from-accent to-cyan' },
    mastery: { icon: _jsx(Sparkles, { className: "h-10 w-10 text-text-primary" }), grad: 'from-cyan to-accent' },
    secret: { icon: _jsx(Server, { className: "h-10 w-10 text-text-primary" }), grad: 'from-surface-3 to-bg' },
};
// LEGENDARY top-tier — пара иконок-фоллбеков.
const TIER_ICON_OVERRIDE = {
    champion: _jsx(Crown, { className: "h-10 w-10 text-text-primary" }),
    'streak-100': _jsx(Zap, { className: "h-10 w-10 text-text-primary" }),
    'arena-master': _jsx(Trophy, { className: "h-10 w-10 text-text-primary" }),
    'guardian': _jsx(Shield, { className: "h-10 w-10 text-text-primary" }),
    'iron-defender': _jsx(Shield, { className: "h-10 w-10 text-text-primary" }),
    'daily-first': _jsx(Award, { className: "h-10 w-10 text-text-primary" }),
};
function visualFor(a) {
    const v = CATEGORY_VISUAL[a.category] ?? CATEGORY_VISUAL.combat;
    const overrideIcon = TIER_ICON_OVERRIDE[a.code];
    return {
        icon: overrideIcon ?? v.icon,
        grad: isUnlocked(a) ? v.grad : 'from-surface-3 to-bg',
    };
}
function FilterChip({ label, active, onClick }) {
    return (_jsx("button", { type: "button", onClick: onClick, className: `rounded-full border px-3 py-1.5 text-[13px] transition-colors ${active
            ? 'border-accent bg-accent/15 font-semibold text-accent-hover'
            : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong hover:text-text-primary'}`, children: label }));
}
function Tile({ a, hideName, onClick, selected }) {
    const v = visualFor(a);
    const locked = !isUnlocked(a);
    const showAsHidden = locked && a.hidden && hideName;
    return (_jsxs("button", { type: "button", onClick: onClick, className: `relative flex h-[200px] flex-col overflow-hidden rounded-[14px] border-2 bg-surface-2 text-left transition-transform hover:-translate-y-0.5 ${RARITY_BORDER[a.tier]} ${locked ? 'opacity-60' : ''} ${selected ? 'ring-2 ring-accent' : ''}`, children: [_jsx("div", { className: `grid h-[100px] place-items-center bg-gradient-to-br ${v.grad}`, children: locked ? _jsx(Lock, { className: "h-10 w-10 text-text-primary" }) : v.icon }), _jsxs("div", { className: "flex flex-1 flex-col gap-1 p-3", children: [_jsx("span", { className: "font-sans text-[13px] font-bold text-text-primary", children: showAsHidden ? '???' : a.title }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: showAsHidden ? '— / —' : progressLabel(a) }), _jsx("span", { className: `mt-auto font-mono text-[10px] font-semibold tracking-[0.08em] ${RARITY_TEXT[a.tier]}`, children: RARITY_LABEL[a.tier] })] })] }));
}
function FeaturedAch({ a }) {
    const { t } = useTranslation('pages');
    if (!a) {
        return (_jsx(Card, { className: "w-full flex-col gap-4 p-6 text-center text-sm text-text-secondary lg:w-[320px]", children: t('achievements.empty_featured', 'Выбери ачивку слева — здесь появятся подробности.') }));
    }
    const v = visualFor(a);
    const locked = !isUnlocked(a);
    return (_jsxs(Card, { className: "w-full flex-col gap-4 p-0 lg:w-[320px]", children: [_jsx("div", { className: `grid h-[180px] place-items-center bg-gradient-to-br ${v.grad}`, children: locked ? _jsx(Lock, { className: "h-16 w-16 text-text-primary" }) : _jsx("span", { className: "scale-[1.6]", children: v.icon }) }), _jsxs("div", { className: "flex flex-col gap-3 p-5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "font-display text-xl font-bold text-text-primary", children: locked && a.hidden ? '???' : a.title }), _jsx("span", { className: `font-mono text-[11px] font-semibold ${RARITY_TEXT[a.tier]}`, children: RARITY_LABEL[a.tier] })] }), _jsx("p", { className: "text-xs text-text-secondary", children: a.description }), _jsxs("div", { className: "flex flex-col gap-2", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted", children: t('achievements.requirements') }), _jsx("p", { className: "text-[12px] text-text-secondary whitespace-pre-line", children: a.requirements })] }), !!a.reward && (_jsxs("div", { className: "rounded-lg border border-warn/30 bg-warn/10 p-3", children: [_jsx("span", { className: "font-mono text-[11px] font-semibold text-warn", children: t('achievements.reward') }), _jsx("p", { className: "mt-1 text-sm font-bold text-text-primary", children: a.reward })] })), !locked && a.unlocked_at && (_jsxs("span", { className: "text-[11px] text-text-muted", children: [t('achievements.unlocked_on', 'Получено'), " \u00B7 ", new Date(a.unlocked_at).toLocaleDateString()] }))] })] }));
}
function applyFilters(items, status, tier) {
    return items.filter((a) => {
        if (status === 'unlocked' && !isUnlocked(a))
            return false;
        if (status === 'hidden' && !a.hidden)
            return false;
        if (tier !== 'all' && a.tier !== tier)
            return false;
        return true;
    });
}
function Skeleton() {
    return (_jsx("div", { className: "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4", children: Array.from({ length: 12 }).map((_, i) => (_jsx("div", { className: "h-[200px] animate-pulse rounded-[14px] bg-surface-2" }, i))) }));
}
export default function AchievementsPage() {
    const { t } = useTranslation('pages');
    const { data, isError, isLoading } = useAchievementsQuery();
    const [status, setStatus] = useState('all');
    const [tier, setTier] = useState('all');
    const [selectedCode, setSelectedCode] = useState(null);
    // Stabilise the items reference: `data ?? []` would create a fresh empty
    // array on every render and invalidate downstream useMemo hooks.
    const items = useMemo(() => data ?? [], [data]);
    const summary = useMemo(() => summarise(items), [items]);
    const filtered = useMemo(() => applyFilters(items, status, tier), [items, status, tier]);
    const featured = useMemo(() => {
        if (selectedCode) {
            const found = items.find((a) => a.code === selectedCode);
            if (found)
                return found;
        }
        // если ничего не выбрано — самая редкая разблокированная.
        const unlockedItems = items.filter(isUnlocked);
        if (unlockedItems.length === 0)
            return null;
        const rank = { legendary: 3, rare: 2, common: 1 };
        return unlockedItems.slice().sort((a, b) => rank[b.tier] - rank[a.tier])[0];
    }, [items, selectedCode]);
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex flex-col gap-5 px-4 pb-6 pt-6 sm:px-8 lg:px-20 lg:pb-7 lg:pt-7", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("h1", { className: "font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary", children: t('achievements.title') }), _jsx("p", { className: "text-sm text-text-secondary", children: t('achievements.summary', { unlocked: summary.unlocked, total: summary.total, rare: summary.rareUnlocked }) }), isError && _jsx(ErrorChip, {})] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx(FilterChip, { label: `${t('achievements.all')} · ${summary.total}`, active: status === 'all', onClick: () => setStatus('all') }), _jsx(FilterChip, { label: `${t('achievements.unlocked')} · ${summary.unlocked}`, active: status === 'unlocked', onClick: () => setStatus('unlocked') }), _jsx(FilterChip, { label: `${t('achievements.hidden')} · ${summary.hiddenLocked}`, active: status === 'hidden', onClick: () => setStatus('hidden') }), _jsx("span", { className: "mx-1 self-center text-text-muted", children: "\u00B7" }), _jsx(FilterChip, { label: `${t('achievements.common')} · ${summary.byTier.common}`, active: tier === 'common', onClick: () => setTier(tier === 'common' ? 'all' : 'common') }), _jsx(FilterChip, { label: `${t('achievements.rare')} · ${summary.byTier.rare}`, active: tier === 'rare', onClick: () => setTier(tier === 'rare' ? 'all' : 'rare') }), _jsx(FilterChip, { label: `${t('achievements.legendary')} · ${summary.byTier.legendary}`, active: tier === 'legendary', onClick: () => setTier(tier === 'legendary' ? 'all' : 'legendary') })] }), _jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:gap-6", children: [_jsx("div", { className: "flex-1", children: isLoading ? (_jsx(Skeleton, {})) : filtered.length === 0 ? (_jsx(Card, { className: "flex-col items-center gap-2 p-8 text-center text-sm text-text-secondary", children: t('achievements.empty_list', 'Пока ничего не разблокировано — сыграй матч!') })) : (_jsx("div", { className: "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4", children: filtered.map((a) => (_jsx(Tile, { a: a, hideName: status !== 'hidden', selected: selectedCode === a.code, onClick: () => setSelectedCode(a.code) }, a.code))) })) }), _jsx(FeaturedAch, { a: featured ?? null })] })] }) }));
}
