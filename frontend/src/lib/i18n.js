import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ruCommon from '../locales/ru/common.json';
import ruSanctum from '../locales/ru/sanctum.json';
import ruArena from '../locales/ru/arena.json';
import ruProfile from '../locales/ru/profile.json';
import ruDaily from '../locales/ru/daily.json';
import ruWelcome from '../locales/ru/welcome.json';
import ruOnboarding from '../locales/ru/onboarding.json';
import ruSettings from '../locales/ru/settings.json';
import ruCodex from '../locales/ru/codex.json';
import ruErrors from '../locales/ru/errors.json';
import ruPages from '../locales/ru/pages.json';
import enCommon from '../locales/en/common.json';
import enSanctum from '../locales/en/sanctum.json';
import enArena from '../locales/en/arena.json';
import enProfile from '../locales/en/profile.json';
import enDaily from '../locales/en/daily.json';
import enWelcome from '../locales/en/welcome.json';
import enOnboarding from '../locales/en/onboarding.json';
import enSettings from '../locales/en/settings.json';
import enCodex from '../locales/en/codex.json';
import enErrors from '../locales/en/errors.json';
import enPages from '../locales/en/pages.json';
const STORAGE_KEY = 'druz9_lang';
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
];
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
};
function detectLang() {
    if (typeof window === 'undefined')
        return 'en';
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'ru' || stored === 'en')
        return stored;
    const browser = (navigator.language || 'en').toLowerCase();
    if (browser.startsWith('ru'))
        return 'ru';
    return 'en';
}
export async function initI18n() {
    const lng = detectLang();
    await i18n.use(initReactI18next).init({
        lng,
        fallbackLng: 'en',
        ns: NAMESPACES,
        defaultNS: 'common',
        interpolation: { escapeValue: false },
        resources,
        returnObjects: true,
    });
    if (typeof document !== 'undefined') {
        document.documentElement.lang = lng;
    }
    i18n.on('languageChanged', (l) => {
        if (typeof document !== 'undefined') {
            document.documentElement.lang = l;
        }
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(STORAGE_KEY, l);
        }
    });
}
export function changeLanguage(lng) {
    return i18n.changeLanguage(lng);
}
export function currentLanguage() {
    return i18n.language || 'en';
}
export function toggleLanguage() {
    const next = currentLanguage() === 'ru' ? 'en' : 'ru';
    return changeLanguage(next);
}
export default i18n;
