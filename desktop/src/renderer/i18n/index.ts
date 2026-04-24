// i18n facade — a hook + a static `t` helper.
//
// Usage:
//   const t = useT();
//   <span>{t('ready')}</span>
//
// The locale lives in a zustand store so any component can change it;
// the change is persisted to localStorage so the next run picks it up.
// No bundler magic or async dictionary loading — two locales fit in
// memory easily.

import { create } from 'zustand';

import { en } from './en';
import { ru } from './ru';
import type { Dict, Locale } from './types';

const dicts: Record<Locale, Dict> = { ru, en };
const STORAGE_KEY = 'druz9.locale';

function initialLocale(): Locale {
  if (typeof localStorage === 'undefined') return 'ru';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'ru' || stored === 'en') return stored;
  // Falls back to browser language; anything not English → Russian.
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'ru';
  return nav.toLowerCase().startsWith('en') ? 'en' : 'ru';
}

interface LocaleState {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: initialLocale(),
  setLocale: (locale) => {
    set({ locale });
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* private mode */
    }
  },
}));

export function useT(): (key: keyof Dict) => string {
  const locale = useLocaleStore((s) => s.locale);
  const d = dicts[locale];
  return (key) => d[key] ?? key;
}

/** Non-hook lookup — for places outside React (store actions, etc.). */
export function translate(key: keyof Dict): string {
  const locale = useLocaleStore.getState().locale;
  return dicts[locale][key] ?? key;
}
