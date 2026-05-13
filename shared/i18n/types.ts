// Flat, type-safe dictionary. A missing key in any locale is a compile error,
// not a silent runtime fallback to the key string. Add new keys here and fill
// both ru.ts and en.ts in the same change.

export type Locale = 'ru' | 'en';

export interface Dict {
  'common.action.save': string;
  'common.action.cancel': string;
  'common.action.delete': string;
  'common.action.confirm': string;
  'common.action.dismiss': string;
  'common.action.retry': string;
  'common.action.close': string;
  'common.action.back': string;
  'common.action.next': string;
  'common.action.edit': string;
  'common.action.copy': string;
  'common.action.create': string;
  'common.action.send': string;
  'common.action.open': string;
  'common.action.apply': string;

  'common.status.loading': string;
  'common.status.saving': string;
  'common.status.saved': string;
  'common.status.deleting': string;
  'common.status.deleted': string;
  'common.status.syncing': string;
  'common.status.offline': string;
  'common.status.ready': string;
  'common.status.thinking': string;
  'common.status.empty': string;

  'common.error.generic': string;
  'common.error.network': string;
  'common.error.unauthorized': string;
  'common.error.not_found': string;

  'common.lang.title': string;
  'common.lang.hint': string;
  'common.lang.ru': string;
  'common.lang.en': string;
}
