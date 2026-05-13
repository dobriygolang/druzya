import { useLocaleStore } from './store';
import type { Locale } from './types';

export type FetchLocale = () => Promise<Locale | null>;
export type PushLocale = (locale: Locale) => Promise<void>;

// Backend wins on bootstrap. If the backend has a locale set and it differs
// from the local store, apply backend's choice. If the backend has no locale
// yet, push the local choice up so subsequent devices see the same value.
export async function bootstrapLocaleFromBackend(opts: {
  fetchLocale: FetchLocale;
  pushLocale?: PushLocale;
}): Promise<void> {
  try {
    const backend = await opts.fetchLocale();
    if (backend === 'ru' || backend === 'en') {
      const current = useLocaleStore.getState().locale;
      if (backend !== current) {
        useLocaleStore.getState().setLocale(backend);
      }
    } else if (opts.pushLocale) {
      await opts.pushLocale(useLocaleStore.getState().locale);
    }
  } catch {
    // Network failure is non-fatal; local locale stays in effect.
  }
}

// Write-through helper: update local store + push to backend in one call.
export async function setLocaleWithBackend(locale: Locale, pushLocale: PushLocale): Promise<void> {
  useLocaleStore.getState().setLocale(locale);
  try {
    await pushLocale(locale);
  } catch {
    // Hone has an outbox; Cue surfaces inline error. Local store already updated.
  }
}
