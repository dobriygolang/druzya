import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Menu, Search, X, Sun, Moon, Languages, User, LogOut, Settings, Users, HelpCircle, Shield, Briefcase } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Avatar } from './Avatar';
import { cn } from '../lib/cn';
import { useTheme, getEffectiveTheme } from '../lib/theme';
import { toggleLanguage, currentLanguage } from '../lib/i18n';
// Главная навигация — только 6 ключевых разделов. Остальное (Друзья, Помощь,
// Настройки, Выход) уехало в user-menu под аватаром, чтобы header не был
// перегружен (раньше было 8 nav-items + 5 кнопок справа = 13 элементов).
function useNavItems() {
    const { t } = useTranslation('common');
    return [
        { to: '/sanctum', label: t('nav.sanctum') },
        { to: '/arena', label: t('nav.arena') },
        { to: '/daily', label: t('nav.kata') },
        { to: '/guild', label: t('nav.guild') },
        { to: '/atlas', label: t('nav.atlas') },
        { to: '/codex', label: t('nav.codex') },
    ];
}
function Logo() {
    return (_jsxs(Link, { to: "/sanctum", className: "flex items-center gap-2.5", children: [_jsx("span", { className: "grid h-8 w-8 shrink-0 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-lg font-extrabold text-text-primary", children: "9" }), _jsx("span", { className: "font-display text-lg font-bold text-text-primary", children: "druz9" })] }));
}
function NavItem({ to, label, onClick }) {
    const { pathname } = useLocation();
    const reduced = useReducedMotion();
    const active = pathname === to || pathname.startsWith(`${to}/`);
    return (_jsx(motion.div, { whileHover: reduced ? undefined : { scale: 1.02 }, whileTap: reduced ? undefined : { scale: 0.98 }, children: _jsx(Link, { to: to, onClick: onClick, className: cn('block rounded-md px-3.5 py-2 text-sm transition-colors', active
                ? 'bg-surface-2 font-semibold text-text-primary'
                : 'font-medium text-text-secondary hover:bg-surface-2 hover:text-text-primary'), children: label }) }));
}
function ThemeToggleButton() {
    const { toggle, theme } = useTheme();
    const effective = theme === 'auto' ? getEffectiveTheme() : theme;
    const Icon = effective === 'dark' ? Sun : Moon;
    return (_jsx("button", { type: "button", onClick: toggle, className: "grid h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-surface-2", "aria-label": "Toggle theme", title: "Toggle theme", children: _jsx(Icon, { className: "h-5 w-5" }) }));
}
function LanguageToggleButton() {
    const [, setTick] = useState(0);
    const lang = currentLanguage();
    const onClick = () => {
        void toggleLanguage().then(() => setTick((x) => x + 1));
    };
    return (_jsxs("button", { type: "button", onClick: onClick, className: "hidden h-9 items-center gap-1.5 rounded-md px-2.5 text-text-secondary hover:bg-surface-2 sm:flex", "aria-label": "Toggle language", title: "Toggle language", children: [_jsx(Languages, { className: "h-4 w-4" }), _jsx("span", { className: "font-mono text-[12px] font-semibold uppercase", children: lang })] }));
}
// UserMenu — выпадающее меню под аватаром: профиль, настройки, друзья,
// уведомления, помощь, админка (если роль admin), выход. Раньше эти
// разделы лежали в основном nav и захламляли его.
function UserMenu({ onClose }) {
    const { t } = useTranslation('common');
    const navigate = useNavigate();
    const items = [
        { to: '/profile', label: t('nav.profile', { defaultValue: 'Профиль' }), icon: User },
        { to: '/vacancies', label: t('nav.vacancies', { defaultValue: 'Вакансии' }), icon: Briefcase },
        { to: '/settings', label: t('nav.settings', { defaultValue: 'Настройки' }), icon: Settings },
        { to: '/friends', label: t('nav.friends'), icon: Users },
        { to: '/notifications', label: t('nav.notifications', { defaultValue: 'Уведомления' }), icon: Bell },
        { to: '/help', label: t('nav.help'), icon: HelpCircle },
        { to: '/admin', label: t('nav.admin', { defaultValue: 'Админка' }), icon: Shield },
    ];
    function handleLogout() {
        try {
            window.localStorage.removeItem('druz9_access_token');
        }
        catch {
            /* ignore */
        }
        onClose();
        navigate('/welcome');
    }
    return (_jsxs("div", { className: "absolute right-0 top-full z-50 mt-2 flex w-56 flex-col rounded-lg border border-border bg-surface-1 p-1.5 shadow-card", role: "menu", children: [items.map((it) => (_jsxs(Link, { to: it.to, onClick: onClose, className: "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary", role: "menuitem", children: [_jsx(it.icon, { className: "h-4 w-4 shrink-0" }), _jsx("span", { className: "truncate", children: it.label })] }, it.to))), _jsx("div", { className: "my-1 border-t border-border" }), _jsxs("button", { type: "button", onClick: handleLogout, className: "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary", role: "menuitem", children: [_jsx(LogOut, { className: "h-4 w-4 shrink-0" }), _jsx("span", { children: t('nav.logout', { defaultValue: 'Выйти' }) })] })] }));
}
function TopNav() {
    const { t } = useTranslation('common');
    const NAV_ITEMS = useNavItems();
    const [menuOpen, setMenuOpen] = useState(false);
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const userMenuRef = useRef(null);
    // Закрываем user-menu по клику снаружи.
    useEffect(() => {
        if (!userMenuOpen)
            return;
        const onClick = (e) => {
            if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
                setUserMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [userMenuOpen]);
    return (_jsxs("header", { className: "sticky top-0 z-40 flex h-[64px] items-center justify-between border-b border-border bg-bg px-4 sm:px-6 lg:h-[72px] lg:px-8", children: [_jsxs("div", { className: "flex min-w-0 items-center gap-4 lg:gap-8", children: [_jsx(Logo, {}), _jsx("nav", { className: "hidden items-center gap-1 lg:flex", children: NAV_ITEMS.map((item) => (_jsx(NavItem, { ...item }, item.to))) })] }), _jsxs("div", { className: "flex shrink-0 items-center gap-1.5 sm:gap-2", children: [_jsxs("div", { className: "hidden h-9 w-[240px] items-center gap-2 rounded-md border border-border bg-surface-2 px-3 lg:flex", children: [_jsx(Search, { className: "h-4 w-4 shrink-0 text-text-muted" }), _jsx("span", { className: "truncate font-sans text-[13px] text-text-muted", children: t('labels.search_placeholder') })] }), _jsx("button", { type: "button", className: "grid h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-surface-2 lg:hidden", "aria-label": "Search", children: _jsx(Search, { className: "h-5 w-5" }) }), _jsx(ThemeToggleButton, {}), _jsx(LanguageToggleButton, {}), _jsxs("div", { ref: userMenuRef, className: "relative", children: [_jsx("button", { type: "button", onClick: () => setUserMenuOpen((v) => !v), className: "grid h-9 w-9 place-items-center rounded-full transition hover:ring-2 hover:ring-accent/40", "aria-label": "User menu", "aria-expanded": userMenuOpen, children: _jsx(Avatar, { size: "md", gradient: "pink-violet", initials: "\u0414" }) }), userMenuOpen && _jsx(UserMenu, { onClose: () => setUserMenuOpen(false) })] }), _jsx("button", { type: "button", className: "grid h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-surface-2 lg:hidden", "aria-label": "Menu", onClick: () => setMenuOpen(true), children: _jsx(Menu, { className: "h-5 w-5" }) })] }), menuOpen && (_jsxs("div", { className: "fixed inset-0 z-50 lg:hidden", role: "dialog", "aria-modal": "true", children: [_jsx("div", { className: "absolute inset-0 bg-black/60 backdrop-blur-sm", onClick: () => setMenuOpen(false) }), _jsxs("div", { className: "absolute right-0 top-0 flex h-full w-[280px] flex-col gap-2 border-l border-border bg-surface-1 p-4", children: [_jsxs("div", { className: "mb-2 flex items-center justify-between", children: [_jsx(Logo, {}), _jsx("button", { type: "button", className: "grid h-9 w-9 place-items-center rounded-md text-text-secondary hover:bg-surface-2", "aria-label": "Close menu", onClick: () => setMenuOpen(false), children: _jsx(X, { className: "h-5 w-5" }) })] }), _jsxs("nav", { className: "flex flex-col gap-1", children: [NAV_ITEMS.map((item) => (_jsx(NavItem, { ...item, onClick: () => setMenuOpen(false) }, item.to))), _jsx("div", { className: "my-2 border-t border-border" }), _jsx(NavItem, { to: "/profile", label: t('nav.profile', { defaultValue: 'Профиль' }), onClick: () => setMenuOpen(false) }), _jsx(NavItem, { to: "/settings", label: t('nav.settings', { defaultValue: 'Настройки' }), onClick: () => setMenuOpen(false) }), _jsx(NavItem, { to: "/friends", label: t('nav.friends'), onClick: () => setMenuOpen(false) }), _jsx(NavItem, { to: "/notifications", label: t('nav.notifications', { defaultValue: 'Уведомления' }), onClick: () => setMenuOpen(false) }), _jsx(NavItem, { to: "/help", label: t('nav.help'), onClick: () => setMenuOpen(false) })] })] })] }))] }));
}
export function AppShellV2({ children }) {
    const location = useLocation();
    const reduced = useReducedMotion();
    // Body class enables v2 design tokens & Inter font globally for the page.
    useEffect(() => {
        document.body.classList.add('v2');
        return () => document.body.classList.remove('v2');
    }, []);
    // Reset scroll on route change.
    useEffect(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }, [location.pathname]);
    const motionProps = reduced
        ? {}
        : {
            initial: { opacity: 0, y: 12 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: -12 },
            transition: { duration: 0.25, ease: 'easeOut' },
        };
    return (_jsxs("div", { className: "min-h-screen bg-bg text-text-primary", children: [_jsx(TopNav, {}), _jsx(AnimatePresence, { mode: "wait", children: _jsx(motion.main, { ...motionProps, children: children }, location.pathname) })] }));
}
