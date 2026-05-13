import { createPromiseClient } from '@connectrpc/connect';
import { ProfileService } from '@generated/pb/druz9/v1/profile_connect';

import { useT, useLocale, useLocaleStore, type Locale } from '@d9-i18n';
import { transport } from '../../../api/transport';

// LanguageSection — Phase K language toggle. Source of truth is
// users.locale (DB) — when the user picks ru/en here, we update local
// store immediately AND write through to the backend Settings RPC so
// the LLM (coach / mock / copilot in web) answers in the same language
// next call. Cross-product sync arrives naturally on next Hone bootstrap
// when bootstrapLocaleFromBackend reads the value back.
const profileClient = createPromiseClient(ProfileService, transport);

export function LanguageSection() {
  const t = useT();
  const [locale, setLocale] = useLocale();

  const pick = (next: Locale) => {
    if (next === locale) return;
    setLocale(next);
    void profileClient.updateSettings({ settings: { locale: next } }).catch((err: unknown) => {
      console.warn('hone.LanguageSection: backend sync failed', err);
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, color: 'var(--ink-60)' }}>{t('common.lang.hint')}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {(['ru', 'en'] as const).map((l) => {
          const active = locale === l;
          return (
            <button
              key={l}
              type="button"
              onClick={() => pick(l)}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid var(--ink-20)',
                background: active ? 'var(--ink-95)' : 'transparent',
                color: active ? 'var(--bg)' : 'var(--ink-90)',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 120ms ease',
              }}
            >
              {l === 'ru' ? t('common.lang.ru') : t('common.lang.en')}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Exposed for bootstrap to read the current locale after auth restore.
export function getCurrentHoneLocale(): Locale {
  return useLocaleStore.getState().locale;
}
