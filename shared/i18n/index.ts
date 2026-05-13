export type { Dict, Locale } from './types';
export { STORAGE_KEY, initialLocale } from './detect';
export { useLocaleStore } from './store';
export { translate, lookup, type TFunc } from './translate';
export { useT, useLocale } from './react';
export {
  bootstrapLocaleFromBackend,
  setLocaleWithBackend,
  type FetchLocale,
  type PushLocale,
} from './sync';
