# @d9-i18n — shared i18n for Hone + Cue

Flat, type-safe dictionary. Used via Vite alias `@d9-i18n` in both Electron apps.

## Usage

```tsx
import { useT, useLocale, useLocaleStore, translate } from '@d9-i18n';

function MyComponent() {
  const t = useT();
  const [locale, setLocale] = useLocale();
  return <button onClick={() => setLocale('en')}>{t('common.action.save')}</button>;
}

// outside React (store actions, notifications):
notify(translate('common.status.saved'));
```

## Adding a key

1. Add the key to `types.ts` (`Dict` interface).
2. Fill both `ru.ts` and `en.ts` — TypeScript will fail compile if you miss one.
3. Use via `t('your.new.key')` or `translate('your.new.key')`.

## Conventions

- Flat keys with dot-separated namespaces: `<app>.<surface>.<element>` or `common.<bucket>.<name>`.
- `common.*` is shared between Hone and Cue.
- `hone.*` is Hone-specific; `cue.*` is Cue-specific.
- Snake_case leaf names.
- Interpolation via `{{name}}`: `t('greeting', { name: user.name })`.

## Backend sync

Single source of truth is `users.locale` in the DB. On auth restore, call
`bootstrapLocaleFromBackend({ fetchLocale, pushLocale })` once. On user-initiated
locale change, call `setLocaleWithBackend(next, pushLocale)`.
