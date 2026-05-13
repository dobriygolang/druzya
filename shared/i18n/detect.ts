import type { Locale } from './types';

export const STORAGE_KEY = 'druz9.locale';
const LEGACY_STORAGE_KEYS = ['druz9_lang', 'hone:lang'];

export function initialLocale(): Locale {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'ru' || stored === 'en') return stored;
    for (const legacy of LEGACY_STORAGE_KEYS) {
      const old = localStorage.getItem(legacy);
      if (old === 'ru' || old === 'en') {
        try {
          localStorage.setItem(STORAGE_KEY, old);
          localStorage.removeItem(legacy);
        } catch {
          /* private mode */
        }
        return old;
      }
    }
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return nav.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}
