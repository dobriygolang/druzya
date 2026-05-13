import { create, type StateCreator } from 'zustand';

import { STORAGE_KEY, initialLocale } from './detect';
import type { Locale } from './types';

export interface LocaleState {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

const init: StateCreator<LocaleState> = (set) => ({
  locale: initialLocale(),
  setLocale: (locale: Locale) => {
    set({ locale });
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, locale);
      } catch {
        /* private mode */
      }
    }
  },
});

export const useLocaleStore = create<LocaleState>(init);
