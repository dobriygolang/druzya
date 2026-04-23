import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { User, CreditCard, Plug, Bell, Sparkles, Shield, Palette, AlertTriangle, Code2, Copy, MessageCircle, Send, Globe, Monitor, Sun, Moon, Languages, Check, } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShellV2 } from '../components/AppShell';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { cn } from '../lib/cn';
import { useProfileQuery } from '../lib/queries/profile';
import { useTheme } from '../lib/theme';
import { changeLanguage, currentLanguage } from '../lib/i18n';
function useNav() {
    const { t } = useTranslation('settings');
    return [
        { id: 'account', label: t('nav.account'), icon: User },
        { id: 'billing', label: t('nav.billing'), icon: CreditCard, badge: 'Premium' },
        { id: 'integrations', label: t('nav.integrations'), icon: Plug },
        { id: 'notifications', label: t('nav.notifications'), icon: Bell },
        { id: 'ai', label: t('nav.ai'), icon: Sparkles },
        { id: 'privacy', label: t('nav.privacy'), icon: Shield },
        { id: 'appearance', label: t('nav.appearance'), icon: Palette },
        { id: 'danger', label: t('nav.danger'), icon: AlertTriangle, danger: true },
    ];
}
function Sidebar({ active, setActive }) {
    const NAV = useNav();
    return (_jsx("nav", { className: "flex h-fit w-full flex-row gap-1 overflow-x-auto rounded-2xl bg-surface-2 p-3 lg:w-[240px] lg:flex-col lg:overflow-x-visible", children: NAV.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            const isDanger = 'danger' in item && item.danger;
            return (_jsxs("button", { onClick: () => setActive(item.id), className: cn('flex h-10 shrink-0 items-center gap-2.5 rounded-md px-3 text-[13px] font-semibold transition-colors', isActive
                    ? 'bg-accent text-text-primary shadow-glow'
                    : isDanger
                        ? 'text-danger hover:bg-danger/10'
                        : 'text-text-secondary hover:bg-surface-3 hover:text-text-primary'), children: [_jsx(Icon, { className: "h-4 w-4" }), _jsx("span", { className: "flex-1 text-left", children: item.label }), 'badge' in item && item.badge && (_jsx("span", { className: "rounded-full bg-warn/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-warn", children: item.badge }))] }, item.id));
        }) }));
}
function Field({ label, value, multiline, prefix, }) {
    return (_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("label", { className: "font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted", children: label }), multiline ? (_jsx("textarea", { defaultValue: value, rows: 3, className: "resize-none rounded-md border border-border bg-surface-1 px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent" })) : (_jsxs("div", { className: "flex items-center rounded-md border border-border bg-surface-1 focus-within:border-accent", children: [prefix && (_jsx("span", { className: "border-r border-border px-2.5 py-2 font-mono text-[13px] text-text-muted", children: prefix })), _jsx("input", { defaultValue: value, className: "flex-1 bg-transparent px-3 py-2 text-[13px] text-text-primary outline-none" })] }))] }));
}
function ProfileCard() {
    const { t } = useTranslation('settings');
    const { data: profile, isError } = useProfileQuery();
    const username = profile?.username ?? '—';
    const display = profile?.display_name ?? '—';
    const initial = (profile?.display_name ?? 'Д').charAt(0).toUpperCase();
    return (_jsxs(Card, { className: "flex-col gap-5 p-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: t('profile') }), isError && (_jsx("span", { className: "rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger", children: t('load_failed') }))] }), _jsxs("div", { className: "flex flex-col gap-6 sm:flex-row", children: [_jsxs("div", { className: "flex flex-col items-center gap-2", children: [_jsx("div", { className: "grid place-items-center rounded-full font-display text-3xl font-extrabold text-white", style: { width: 96, height: 96, background: 'linear-gradient(135deg, #582CFF 0%, #22D3EE 100%)' }, children: initial }), _jsx("button", { className: "font-mono text-[11px] font-semibold text-accent-hover hover:underline", children: t('change') })] }), _jsxs("div", { className: "grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2", children: [_jsx(Field, { label: t('fields.username'), value: username, prefix: "@" }, `u-${username}`), _jsx(Field, { label: t('fields.display'), value: display }, `d-${display}`), _jsx(Field, { label: t('fields.email'), value: "wylmayfeolekerd@hotmail.com" }), _jsx(Field, { label: t('fields.city'), value: t('city') }), _jsx("div", { className: "col-span-2", children: _jsx(Field, { label: t('fields.bio'), value: profile?.title ?? t('bio_default'), multiline: true }) })] })] })] }));
}
function AccountInfoCard() {
    const { t } = useTranslation('settings');
    const { data: profile } = useProfileQuery();
    const id = profile?.id ?? 'drz9-7K2M-A9P';
    const created = profile?.created_at
        ? new Date(profile.created_at).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })
        : '12 марта 2025';
    const plan = profile?.subscription?.plan ?? 'FREE';
    return (_jsxs(Card, { className: "flex-col gap-0 p-0", children: [_jsx("div", { className: "flex items-center justify-between border-b border-border px-6 py-4", children: _jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: t('account_card') }) }), _jsxs("div", { className: "flex flex-col", children: [_jsx(InfoRow, { label: t('rows.id'), children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "font-mono text-[13px] text-text-primary", children: id }), _jsx("button", { className: "grid h-7 w-7 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text-primary", children: _jsx(Copy, { className: "h-3.5 w-3.5" }) })] }) }), _jsx(InfoRow, { label: t('rows.registered'), children: _jsx("span", { className: "text-[13px] text-text-secondary", children: created }) }), _jsx(InfoRow, { label: t('rows.plan'), children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-text-secondary", children: plan }), _jsx(Button, { variant: "primary", size: "sm", className: "bg-warn text-bg shadow-none hover:bg-warn/90 hover:shadow-none", children: t('buy_premium') })] }) }), _jsx(InfoRow, { label: t('rows.devices'), last: true, children: _jsx("span", { className: "text-[13px] text-text-secondary", children: t('devices_value') }) })] })] }));
}
function InfoRow({ label, children, last }) {
    return (_jsxs("div", { className: cn('flex items-center justify-between px-6 py-3.5', !last && 'border-b border-border'), children: [_jsx("span", { className: "text-[13px] font-semibold text-text-secondary", children: label }), children] }));
}
const INTEGRATIONS = [
    { name: 'GitHub', icon: Code2, connected: true },
    { name: 'Discord', icon: MessageCircle, connected: true },
    { name: 'Telegram', icon: Send, connected: false },
    { name: 'Yandex', icon: Globe, connected: false },
];
function IntegrationsCard() {
    const { t } = useTranslation('settings');
    return (_jsxs(Card, { className: "flex-col gap-4 p-6", children: [_jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: t('integrations_title') }), _jsx("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: INTEGRATIONS.map((i) => {
                    const Icon = i.icon;
                    return (_jsxs("div", { className: "flex items-center gap-3 rounded-lg border border-border bg-surface-1 p-4", children: [_jsx("span", { className: "grid h-10 w-10 place-items-center rounded-lg bg-surface-2 text-text-primary", children: _jsx(Icon, { className: "h-5 w-5" }) }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx("span", { className: "text-sm font-semibold text-text-primary", children: i.name }), _jsx("span", { className: cn('font-mono text-[11px]', i.connected ? 'text-success' : 'text-text-muted'), children: i.connected ? t('connected') : t('not_connected') })] }), _jsx(Button, { variant: "ghost", size: "sm", children: i.connected ? t('manage') : t('connect') })] }, i.name));
                }) })] }));
}
function AppearanceCard() {
    const { t } = useTranslation('settings');
    const { theme, set } = useTheme();
    const options = [
        { id: 'auto', icon: Monitor, label: t('theme_auto'), desc: t('theme_auto_desc') },
        { id: 'dark', icon: Moon, label: t('theme_dark'), desc: t('theme_dark_desc') },
        { id: 'light', icon: Sun, label: t('theme_light'), desc: t('theme_light_desc') },
    ];
    const [, force] = useState(0);
    const [lang, setLang] = useState(currentLanguage());
    const onLang = (l) => {
        setLang(l);
        void changeLanguage(l).then(() => force((x) => x + 1));
    };
    return (_jsxs(Card, { className: "flex-col gap-6 p-6", children: [_jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: t('appearance_title') }), _jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("span", { className: "text-[14px] font-semibold text-text-primary", children: t('theme_label') }), _jsx("span", { className: "text-[12px] text-text-muted", children: t('theme_desc') })] }), _jsx("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-3", children: options.map((o) => {
                            const Icon = o.icon;
                            const active = theme === o.id;
                            return (_jsxs("button", { type: "button", onClick: () => set(o.id), className: cn('relative flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-all', active
                                    ? 'border-accent bg-accent/10 shadow-glow'
                                    : 'border-border bg-surface-1 hover:border-border-strong'), children: [active && (_jsx("span", { className: "absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-accent text-text-primary", children: _jsx(Check, { className: "h-3 w-3", strokeWidth: 3 }) })), _jsx(Icon, { className: "h-5 w-5 text-accent-hover" }), _jsx("span", { className: "text-[14px] font-bold text-text-primary", children: o.label }), _jsx("span", { className: "font-mono text-[11px] text-text-muted", children: o.desc })] }, o.id));
                        }) })] }), _jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("div", { className: "flex flex-col gap-1", children: [_jsx("span", { className: "text-[14px] font-semibold text-text-primary", children: t('language_label') }), _jsx("span", { className: "text-[12px] text-text-muted", children: t('language_desc') })] }), _jsx("div", { className: "grid grid-cols-2 gap-3", children: ['ru', 'en'].map((l) => {
                            const active = lang === l;
                            return (_jsxs("button", { type: "button", onClick: () => onLang(l), className: cn('flex items-center gap-3 rounded-lg border p-4 text-left transition-all', active
                                    ? 'border-accent bg-accent/10'
                                    : 'border-border bg-surface-1 hover:border-border-strong'), children: [_jsx(Languages, { className: "h-5 w-5 text-accent-hover" }), _jsx("span", { className: "flex-1 text-[14px] font-bold text-text-primary", children: l === 'ru' ? 'Русский' : 'English' }), active && (_jsx("span", { className: "grid h-5 w-5 place-items-center rounded-full bg-accent text-text-primary", children: _jsx(Check, { className: "h-3 w-3", strokeWidth: 3 }) }))] }, l));
                        }) })] })] }));
}
// Dev-only: lets QA flip the simulated subscription tier so the voice gate
// (premium-only TTS) can be exercised end-to-end against MSW. The handler
// reads `localStorage['druz9_user_tier']` at request time.
function DevTierCard() {
    const initial = (() => {
        try {
            return localStorage.getItem('druz9_user_tier') ?? 'free';
        }
        catch {
            return 'free';
        }
    })();
    const [tier, setTier] = useState(initial);
    const tiers = ['free', 'premium', 'pro'];
    const set = (t) => {
        try {
            localStorage.setItem('druz9_user_tier', t);
        }
        catch {
            /* noop */
        }
        setTier(t);
        // Force a refetch of /profile/me so consumers see the new tier.
        window.dispatchEvent(new Event('storage'));
        window.location.reload();
    };
    return (_jsxs(Card, { className: "flex-col gap-3 border-warn/40 p-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "font-display text-lg font-bold text-text-primary", children: "Dev: switch tier" }), _jsx("span", { className: "rounded-full bg-warn/20 px-2 py-0.5 font-mono text-[10px] font-bold text-warn", children: "DEV ONLY" })] }), _jsx("p", { className: "text-[12px] text-text-muted", children: "\u0421\u0438\u043C\u0443\u043B\u0438\u0440\u0443\u0435\u0442 \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443. Premium \u0432\u043A\u043B\u044E\u0447\u0430\u0435\u0442 proxy \u043A Edge TTS \u2014 Free fallback'\u0438\u0442 \u043D\u0430 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u043D\u044B\u0439 \u0433\u043E\u043B\u043E\u0441." }), _jsx("div", { className: "flex gap-2", children: tiers.map((t) => (_jsx("button", { type: "button", onClick: () => set(t), className: cn('flex-1 rounded-md border px-3 py-2 font-mono text-[11px] font-semibold uppercase transition-colors', tier === t
                        ? 'border-accent bg-accent/15 text-accent-hover'
                        : 'border-border bg-surface-1 text-text-secondary hover:bg-surface-2'), children: t }, t))) })] }));
}
export default function SettingsPage() {
    const { t } = useTranslation('settings');
    const [active, setActive] = useState('account');
    return (_jsx(AppShellV2, { children: _jsxs("div", { className: "flex flex-col gap-8 px-4 py-6 sm:px-8 lg:px-10 lg:py-10", children: [_jsxs("div", { className: "flex flex-col gap-1.5", children: [_jsx("h1", { className: "font-display text-2xl font-bold text-text-primary lg:text-[32px]", children: t('title') }), _jsx("p", { className: "text-sm text-text-secondary", children: t('subtitle') })] }), _jsxs("div", { className: "flex flex-col gap-6 lg:flex-row", children: [_jsx(Sidebar, { active: active, setActive: setActive }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col gap-5", children: [_jsx(ProfileCard, {}), _jsx(AccountInfoCard, {}), _jsx(IntegrationsCard, {}), _jsx(AppearanceCard, {}), _jsx(DevTierCard, {})] })] })] }) }));
}
