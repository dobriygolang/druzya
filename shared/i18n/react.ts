import { useLocaleStore, type LocaleState } from './store';
import { lookup, type TFunc } from './translate';
import type { Locale } from './types';

export function useT(): TFunc {
  const locale = useLocaleStore((s: LocaleState) => s.locale);
  return (key, vars) => lookup(locale, key, vars);
}

export function useLocale(): [Locale, (l: Locale) => void] {
  const locale = useLocaleStore((s: LocaleState) => s.locale);
  const setLocale = useLocaleStore((s: LocaleState) => s.setLocale);
  return [locale, setLocale];
}
