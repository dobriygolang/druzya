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
}

export function loadRuntimeConfig(): RuntimeConfig {
  const isDev = process.env.NODE_ENV !== 'production' && !process.env.ELECTRON_IS_PACKAGED;
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
  };
}
