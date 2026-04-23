import { useEffect, useState, useCallback } from 'react';
const STORAGE_KEY = 'druz9_theme';
function readStored() {
    if (typeof window === 'undefined')
        return 'dark';
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light' || v === 'auto')
        return v;
    return 'dark';
}
function resolveEffective(mode) {
    if (mode === 'auto') {
        if (typeof window !== 'undefined' && window.matchMedia) {
            return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        }
        return 'dark';
    }
    return mode;
}
function applyTheme(mode) {
    if (typeof document === 'undefined')
        return;
    const effective = resolveEffective(mode);
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(effective);
    root.dataset.theme = effective;
}
// Применяем как можно раньше при загрузке модуля, чтобы избежать стартовой вспышки
if (typeof document !== 'undefined') {
    applyTheme(readStored());
}
const listeners = new Set();
let current = readStored();
function setMode(mode) {
    current = mode;
    if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, mode);
    }
    applyTheme(mode);
    listeners.forEach((l) => l(mode));
}
export function useTheme() {
    const [theme, setThemeState] = useState(current);
    useEffect(() => {
        const l = (m) => setThemeState(m);
        listeners.add(l);
        return () => {
            listeners.delete(l);
        };
    }, []);
    // Слушаем изменения системной color scheme в режиме auto
    useEffect(() => {
        if (theme !== 'auto')
            return;
        if (typeof window === 'undefined' || !window.matchMedia)
            return;
        const mql = window.matchMedia('(prefers-color-scheme: light)');
        const handler = () => applyTheme('auto');
        mql.addEventListener?.('change', handler);
        return () => mql.removeEventListener?.('change', handler);
    }, [theme]);
    const set = useCallback((m) => setMode(m), []);
    const toggle = useCallback(() => {
        const effective = resolveEffective(current);
        setMode(effective === 'dark' ? 'light' : 'dark');
    }, []);
    return { theme, set, toggle };
}
export function getEffectiveTheme() {
    return resolveEffective(current);
}
