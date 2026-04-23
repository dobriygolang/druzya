import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import ruCommon from '../locales/ru/common.json'
import ruSanctum from '../locales/ru/sanctum.json'
import ruArena from '../locales/ru/arena.json'
import ruProfile from '../locales/ru/profile.json'
import ruDaily from '../locales/ru/daily.json'
import ruWelcome from '../locales/ru/welcome.json'
import ruOnboarding from '../locales/ru/onboarding.json'
import ruSettings from '../locales/ru/settings.json'
import ruCodex from '../locales/ru/codex.json'
import ruErrors from '../locales/ru/errors.json'
import ruPages from '../locales/ru/pages.json'

import enCommon from '../locales/en/common.json'
import enSanctum from '../locales/en/sanctum.json'
import enArena from '../locales/en/arena.json'
import enProfile from '../locales/en/profile.json'
import enDaily from '../locales/en/daily.json'
import enWelcome from '../locales/en/welcome.json'
import enOnboarding from '../locales/en/onboarding.json'
import enSettings from '../locales/en/settings.json'
import enCodex from '../locales/en/codex.json'
import enErrors from '../locales/en/errors.json'
import enPages from '../locales/en/pages.json'

// STRATEGIC SCAFFOLD — Phase 1 of docs/strategic/i18n.md.
// kz/* and ua/* are byte-identical copies of ru/* until the content team
// ships translations. Fallback chain (configured below) is kz → ru → en
// and ua → ru → en, so untranslated keys never render as placeholders.
import kzCommon from '../locales/kz/common.json'
import kzSanctum from '../locales/kz/sanctum.json'
import kzArena from '../locales/kz/arena.json'
import kzProfile from '../locales/kz/profile.json'
import kzDaily from '../locales/kz/daily.json'
import kzWelcome from '../locales/kz/welcome.json'
import kzOnboarding from '../locales/kz/onboarding.json'
import kzSettings from '../locales/kz/settings.json'
import kzCodex from '../locales/kz/codex.json'
import kzErrors from '../locales/kz/errors.json'
import kzPages from '../locales/kz/pages.json'

import uaCommon from '../locales/ua/common.json'
import uaSanctum from '../locales/ua/sanctum.json'
import uaArena from '../locales/ua/arena.json'
import uaProfile from '../locales/ua/profile.json'
import uaDaily from '../locales/ua/daily.json'
import uaWelcome from '../locales/ua/welcome.json'
import uaOnboarding from '../locales/ua/onboarding.json'
import uaSettings from '../locales/ua/settings.json'
import uaCodex from '../locales/ua/codex.json'
import uaErrors from '../locales/ua/errors.json'
import uaPages from '../locales/ua/pages.json'

const STORAGE_KEY = 'druz9_lang'

export type Lang = 'ru' | 'en' | 'kz' | 'ua'

export const NAMESPACES = [
  'common',
  'sanctum',
  'arena',
  'profile',
  'daily',
  'welcome',
  'onboarding',
  'settings',
  'codex',
  'errors',
  'pages',
] as const

export const resources = {
  ru: {
    common: ruCommon,
    sanctum: ruSanctum,
    arena: ruArena,
    profile: ruProfile,
    daily: ruDaily,
    welcome: ruWelcome,
    onboarding: ruOnboarding,
    settings: ruSettings,
    codex: ruCodex,
    errors: ruErrors,
    pages: ruPages,
  },
  en: {
    common: enCommon,
    sanctum: enSanctum,
    arena: enArena,
    profile: enProfile,
    daily: enDaily,
    welcome: enWelcome,
    onboarding: enOnboarding,
    settings: enSettings,
    codex: enCodex,
    errors: enErrors,
    pages: enPages,
  },
  kz: {
    common: kzCommon,
    sanctum: kzSanctum,
    arena: kzArena,
    profile: kzProfile,
    daily: kzDaily,
    welcome: kzWelcome,
    onboarding: kzOnboarding,
    settings: kzSettings,
    codex: kzCodex,
    errors: kzErrors,
    pages: kzPages,
  },
  ua: {
    common: uaCommon,
    sanctum: uaSanctum,
    arena: uaArena,
    profile: uaProfile,
    daily: uaDaily,
    welcome: uaWelcome,
    onboarding: uaOnboarding,
    settings: uaSettings,
    codex: uaCodex,
    errors: uaErrors,
    pages: uaPages,
  },
}

function detectLang(): Lang {
  if (typeof window === 'undefined') return 'en'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'ru' || stored === 'en' || stored === 'kz' || stored === 'ua') return stored
  const browser = (navigator.language || 'en').toLowerCase()
  if (browser.startsWith('ru')) return 'ru'
  if (browser.startsWith('kk')) return 'kz' // Kazakh BCP47 is "kk"
  if (browser.startsWith('uk')) return 'ua' // Ukrainian BCP47 is "uk"
  return 'en'
}

export async function initI18n() {
  const lng = detectLang()
  await i18n.use(initReactI18next).init({
    lng,
    // STRATEGIC SCAFFOLD: fallback per-locale so kz/ua resolve missing
    // keys via ru first (the source of truth until content lands), then
    // en as the universal safety net. See docs/strategic/i18n.md §3.
    fallbackLng: {
      kz: ['ru', 'en'],
      ua: ['ru', 'en'],
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

// toggleLanguage cycles ru → en → kz → ua → ru. Phase 2 will replace the
// header toggle with a proper dropdown — see docs/strategic/i18n.md §8.
export function toggleLanguage() {
  const order: Lang[] = ['ru', 'en', 'kz', 'ua']
  const cur = currentLanguage()
  const idx = order.indexOf(cur)
  const next = order[(idx + 1) % order.length]
  return changeLanguage(next)
}

export default i18n
