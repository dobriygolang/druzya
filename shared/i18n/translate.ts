import { en } from './en';
import { ru } from './ru';
import { useLocaleStore } from './store';
import type { Dict, Locale } from './types';

const DICTS: Record<Locale, Dict> = { ru, en };

const INTERPOLATION = /\{\{(\w+)\}\}/g;

export type TFunc = (key: keyof Dict, vars?: Record<string, string | number>) => string;

export function lookup(locale: Locale, key: keyof Dict, vars?: Record<string, string | number>): string {
  const raw = DICTS[locale][key] ?? key;
  if (!vars) return raw;
  return raw.replace(INTERPOLATION, (_, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`,
  );
}

export function translate(key: keyof Dict, vars?: Record<string, string | number>): string {
  return lookup(useLocaleStore.getState().locale, key, vars);
}
