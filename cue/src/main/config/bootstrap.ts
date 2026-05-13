// Runtime configuration for the main process. Everything here comes from
// either environment variables (in dev) or electron-builder's extraMetadata
// (in packaged builds). No config is baked into the renderer.

export interface RuntimeConfig {
  /** Base URL of the Druz9 backend (monolith). */
  apiBaseURL: string;
  /** Channel for electron-updater. Empty disables auto-update. */
  updateFeedURL: string;
  /** Sentry DSN for crash reporting. Empty disables Sentry entirely. */
  sentryDSN: string;
  /** "production" | "development" — forwarded to Sentry environment tag. */
  environment: string;
  /** Initial UI locale. User can override via Settings later. */
  defaultLocale: 'ru' | 'en';
  /** true when running via `electron-vite dev`. */
  isDev: boolean;
  /**
   * Pro-upgrade landing URL (без trailing slash). Renderer'ы клеят
   * `?source=cue&feature=<slug>`. Backend redirect'ит в Stripe Checkout.
   * Override через DRUZ9_PRO_URL env. Renderer'ы читают свою копию через
   * `renderer/lib/upgrade-config.ts` чтобы не таскать full RuntimeConfig
   * IPC bridge — единственный источник правды URL'а живёт в env'е, а
   * default'ы дублируются в renderer'е (acceptable для compile-time const).
   *
   * Optional, like voiceSource выше: handlers.ts собирает inline test
   * RuntimeConfig'и в 9+ call-sites; не хотим bloat'ить их каждым
   * добавленным полем.
   */
  proUpgradeURLBase?: string;
  /**
   * BYOK (bring-your-own-key) landing. Юзер'ы вводят OpenAI/Anthropic/
   * Groq/etc key → Pro features unlock без подписки.
   */
  byokURL?: string;
  /**
   * Audio source для voice transcription:
   *   'mic'    → AVAudioEngine + микрофон (default; нужен только
   *              Microphone TCC; ловит ровно голос юзера)
   *   'system' → ScreenCaptureKit + системный звук (нужен Screen
   *              Recording + Microphone TCC; ловит партнёра в Zoom/
   *              Teams + всё что играет в колонках)
   * Юзер переключает в Settings → Voice; persist'ится в keychain'е
   * через user-prefs IPC (см. handlers.ts:ui.getVoiceSource).
   *
   * Optional чтобы не ломать пять call-sites'ов в handlers.ts которые
   * собирают inline RuntimeConfig для test/legacy кода. audio-mac.ts
   * fallback'ает на 'mic' через `?? 'mic'`.
   */
  voiceSource?: 'mic' | 'system';
}

export function loadRuntimeConfig(): RuntimeConfig {
  // app.isPackaged — single source of truth: true в production .app-сборке,
  // false под `electron-vite dev`. Старая проверка через NODE_ENV+
  // ELECTRON_IS_PACKAGED ломалась в prod (Electron не выставляет ни одну из
  // этих переменных автоматически → isDev резолвился в TRUE → tray-icon
  // ресолвился в app.asar/resources вместо Contents/Resources).
  // require('electron') для совместимости с CJS bundle main-процесса.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require('electron') as typeof import('electron');
  const isDev = !app.isPackaged;
  return {
    apiBaseURL:
      process.env.DRUZ9_API_BASE_URL ||
      // Production Druzya deployment — matches infra/nginx/nginx.prod.conf
      // (server_name druz9.online). Both dev and prod default here
      // because the local docker-compose setup is seldom what desktop
      // users want; set DRUZ9_API_BASE_URL=http://localhost:8080 to
      // override when doing full-stack local work.
      'https://druz9.online',
    updateFeedURL: process.env.DRUZ9_UPDATE_FEED_URL || '',
    sentryDSN: process.env.DRUZ9_SENTRY_DSN || '',
    environment: isDev ? 'development' : 'production',
    defaultLocale:
      (process.env.DRUZ9_DEFAULT_LOCALE === 'en' ? 'en' : 'ru') as 'ru' | 'en',
    isDev,
    // Default to 'mic' — most users want «говорю с AI» flow без
    // Screen Recording promptа. Override через DRUZ9_VOICE_SOURCE env
    // (для разработки) или Settings UI (runtime).
    voiceSource:
      (process.env.DRUZ9_VOICE_SOURCE === 'system' ? 'system' : 'mic') as 'mic' | 'system',
    proUpgradeURLBase:
      process.env.DRUZ9_PRO_URL || 'https://druz9.online/upgrade',
    byokURL:
      process.env.DRUZ9_BYOK_URL || 'https://druz9.online/byok',
  };
}
