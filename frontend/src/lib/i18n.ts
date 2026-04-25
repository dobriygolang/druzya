import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import ruCommon from '../locales/ru/common.json'
import ruArena from '../locales/ru/arena.json'
import ruProfile from '../locales/ru/profile.json'
import ruDaily from '../locales/ru/daily.json'
import ruWelcome from '../locales/ru/welcome.json'
import ruOnboarding from '../locales/ru/onboarding.json'
import ruSettings from '../locales/ru/settings.json'
import ruCodex from '../locales/ru/codex.json'
import ruErrors from '../locales/ru/errors.json'
import ruPages from '../locales/ru/pages.json'
import ruWave10 from '../locales/ru/wave10.json'

import enCommon from '../locales/en/common.json'
import enArena from '../locales/en/arena.json'
import enProfile from '../locales/en/profile.json'
import enDaily from '../locales/en/daily.json'
import enWelcome from '../locales/en/welcome.json'
import enOnboarding from '../locales/en/onboarding.json'
import enSettings from '../locales/en/settings.json'
import enCodex from '../locales/en/codex.json'
import enErrors from '../locales/en/errors.json'
import enPages from '../locales/en/pages.json'
import enWave10 from '../locales/en/wave10.json'

// STRATEGIC SCAFFOLD — Phase 1 of docs/strategic/i18n.md.
// kz/* are byte-identical copies of ru/* until the content team ships
// translations. Fallback chain (configured below) is kz → ru → en, so
// untranslated keys never render as placeholders.
//
// WAVE-13 — Ukrainian (ua) locale removed by product decision; LANG_LIST
// no longer surfaces it and the locales/ua/ directory has been deleted.
import kzCommon from '../locales/kz/common.json'
import kzArena from '../locales/kz/arena.json'
import kzProfile from '../locales/kz/profile.json'
import kzDaily from '../locales/kz/daily.json'
import kzWelcome from '../locales/kz/welcome.json'
import kzOnboarding from '../locales/kz/onboarding.json'
import kzSettings from '../locales/kz/settings.json'
import kzCodex from '../locales/kz/codex.json'
import kzErrors from '../locales/kz/errors.json'
import kzPages from '../locales/kz/pages.json'
import kzWave10 from '../locales/kz/wave10.json'

const STORAGE_KEY = 'druz9_lang'

export type Lang = 'ru' | 'en' | 'kz'

export const NAMESPACES = [
  'common',
  'arena',
  'profile',
  'daily',
  'welcome',
  'onboarding',
  'settings',
  'codex',
  'errors',
  'pages',
  'wave10',
] as const

export const resources = {
  ru: {
    common: ruCommon,
    arena: ruArena,
    profile: ruProfile,
    daily: ruDaily,
    welcome: ruWelcome,
    onboarding: ruOnboarding,
    settings: ruSettings,
    codex: ruCodex,
    errors: ruErrors,
    pages: ruPages,
    wave10: ruWave10,
  },
  en: {
    common: enCommon,
    arena: enArena,
    profile: enProfile,
    daily: enDaily,
    welcome: enWelcome,
    onboarding: enOnboarding,
    settings: enSettings,
    codex: enCodex,
    errors: enErrors,
    pages: enPages,
    wave10: enWave10,
  },
  kz: {
    common: kzCommon,
    arena: kzArena,
    profile: kzProfile,
    daily: kzDaily,
    welcome: kzWelcome,
    onboarding: kzOnboarding,
    settings: kzSettings,
    codex: kzCodex,
    errors: kzErrors,
    pages: kzPages,
    wave10: kzWave10,
  },
}

function detectLang(): Lang {
  if (typeof window === 'undefined') return 'en'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  // Persisted 'ua' falls through to the browser-detection branch and
  // ultimately settles on EN — the legacy value никого не сломает.
  if (stored === 'ru' || stored === 'en' || stored === 'kz') return stored
  const browser = (navigator.language || 'en').toLowerCase()
  if (browser.startsWith('ru')) return 'ru'
  if (browser.startsWith('kk')) return 'kz' // Kazakh BCP47 is "kk"
  return 'en'
}

export async function initI18n() {
  const lng = detectLang()
  await i18n.use(initReactI18next).init({
    lng,
    // STRATEGIC SCAFFOLD: fallback per-locale so kz resolves missing keys
    // via ru first (the source of truth until content lands), then en as
    // the universal safety net. See docs/strategic/i18n.md §3.
    fallbackLng: {
      kz: ['ru', 'en'],
      default: ['en'],
    },
    ns: NAMESPACES as unknown as string[],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    resources,
    returnObjects: true,
  })

  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng
  }

  i18n.on('languageChanged', (l) => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = l
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, l)
    }
  })
}

export function changeLanguage(lng: Lang) {
  return i18n.changeLanguage(lng)
}

export function currentLanguage(): Lang {
  return (i18n.language as Lang) || 'en'
}

// toggleLanguage cycles ru → en → kz → ru. Phase 2 will replace the
// header toggle with a proper dropdown — see docs/strategic/i18n.md §8.
export function toggleLanguage() {
  const order: Lang[] = ['ru', 'en', 'kz']
  const cur = currentLanguage()
  const idx = order.indexOf(cur)
  const next = order[(idx + 1) % order.length]
  return changeLanguage(next)
}

// LANG_LIST — порядок отображения в dropdown'е языков (см. AppShell).
export const LANG_LIST: { code: Lang; flag: string; label: string }[] = [
  { code: 'ru', flag: '🇷🇺', label: 'Русский' },
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'kz', flag: '🇰🇿', label: 'Қазақша' },
]

// bcp47 maps internal lang codes (ru/en/kz) to canonical BCP47 tags
// for Intl.* APIs. KZ → kk-KZ (Kazakh) — see docs/strategic/i18n.md §6
// (number/date formatting).
export function bcp47(lang: Lang = currentLanguage()): string {
  switch (lang) {
    case 'ru':
      return 'ru-RU'
    case 'kz':
      return 'kk-KZ'
    case 'en':
    default:
      return 'en-US'
  }
}

// formatDate uses Intl.DateTimeFormat with the correct locale tag; falls
// back gracefully for runtimes without the chosen locale data (Intl will
// substitute the closest match instead of throwing).
export function formatDate(
  d: Date | string | number,
  opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
  lang: Lang = currentLanguage(),
): string {
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(bcp47(lang), opts).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-US', opts).format(date)
  }
}

// formatNumber — convenience wrapper around Intl.NumberFormat with the
// active locale. Used for leaderboard ranks, member counts, etc.
export function formatNumber(
  n: number,
  opts?: Intl.NumberFormatOptions,
  lang: Lang = currentLanguage(),
): string {
  try {
    return new Intl.NumberFormat(bcp47(lang), opts).format(n)
  } catch {
    return new Intl.NumberFormat('en-US', opts).format(n)
  }
}

export default i18n
