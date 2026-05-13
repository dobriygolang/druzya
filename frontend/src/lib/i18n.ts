import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import ruCommon from '../locales/ru/common.json'
import ruProfile from '../locales/ru/profile.json'
import ruWelcome from '../locales/ru/welcome.json'
import ruOnboarding from '../locales/ru/onboarding.json'
import ruSettings from '../locales/ru/settings.json'
import ruCodex from '../locales/ru/codex.json'
import ruErrors from '../locales/ru/errors.json'
import ruPages from '../locales/ru/pages.json'
import ruWave10 from '../locales/ru/wave10.json'
import ruAuth from '../locales/ru/auth.json'
import ruToasts from '../locales/ru/toasts.json'
import ruLingua from '../locales/ru/lingua.json'
import ruAdmin from '../locales/ru/admin.json'

import enCommon from '../locales/en/common.json'
import enProfile from '../locales/en/profile.json'
import enWelcome from '../locales/en/welcome.json'
import enOnboarding from '../locales/en/onboarding.json'
import enSettings from '../locales/en/settings.json'
import enCodex from '../locales/en/codex.json'
import enErrors from '../locales/en/errors.json'
import enPages from '../locales/en/pages.json'
import enWave10 from '../locales/en/wave10.json'
import enAuth from '../locales/en/auth.json'
import enToasts from '../locales/en/toasts.json'
import enLingua from '../locales/en/lingua.json'
import enAdmin from '../locales/en/admin.json'

// Unified storage key across web / Hone / Cue. The legacy 'druz9_lang' value
// is read once below and migrated forward so existing users don't lose their
// choice on first load after this change.
const STORAGE_KEY = 'druz9.locale'
const LEGACY_STORAGE_KEY = 'druz9_lang'

export type Lang = 'ru' | 'en'

export const NAMESPACES = [
  'common',
  'profile',
  'welcome',
  'onboarding',
  'settings',
  'codex',
  'errors',
  'pages',
  'wave10',
  'auth',
  'toasts',
  'lingua',
  'admin',
] as const

export const resources = {
  ru: {
    common: ruCommon,
    profile: ruProfile,
    welcome: ruWelcome,
    onboarding: ruOnboarding,
    settings: ruSettings,
    codex: ruCodex,
    errors: ruErrors,
    pages: ruPages,
    wave10: ruWave10,
    auth: ruAuth,
    toasts: ruToasts,
    lingua: ruLingua,
    admin: ruAdmin,
  },
  en: {
    common: enCommon,
    profile: enProfile,
    welcome: enWelcome,
    onboarding: enOnboarding,
    settings: enSettings,
    codex: enCodex,
    errors: enErrors,
    pages: enPages,
    wave10: enWave10,
    auth: enAuth,
    toasts: enToasts,
    lingua: enLingua,
    admin: enAdmin,
  },
}

function detectLang(): Lang {
  if (typeof window === 'undefined') return 'en'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'ru' || stored === 'en') return stored
  // One-shot migration: legacy 'druz9_lang' key from before the unification.
  // If it has a valid value, copy it forward and drop the old key.
  const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY)
  if (legacy === 'ru' || legacy === 'en') {
    try {
      window.localStorage.setItem(STORAGE_KEY, legacy)
      window.localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      /* private mode */
    }
    return legacy
  }
  const browser = (navigator.language || 'en').toLowerCase()
  if (browser.startsWith('ru')) return 'ru'
  return 'en'
}

export async function initI18n() {
  const lng = detectLang()
  await i18n.use(initReactI18next).init({
    lng,
    fallbackLng: 'en',
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

// toggleLanguage cycles ru → en → ru.
export function toggleLanguage() {
  const order: Lang[] = ['ru', 'en']
  const cur = currentLanguage()
  const idx = order.indexOf(cur)
  const next = order[(idx + 1) % order.length]
  return changeLanguage(next)
}

// LANG_LIST — порядок отображения в dropdown'е языков (см. AppShell).
export const LANG_LIST: { code: Lang; flag: string; label: string }[] = [
  { code: 'ru', flag: '🇷🇺', label: 'Русский' },
  { code: 'en', flag: '🇬🇧', label: 'English' },
]

// bcp47 maps internal lang codes (ru/en) to canonical BCP47 tags для Intl.*.
export function bcp47(lang: Lang = currentLanguage()): string {
  switch (lang) {
    case 'ru':
      return 'ru-RU'
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
