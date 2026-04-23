// Runtime configuration for the main process. Everything here comes from
// either environment variables (in dev) or electron-builder's extraMetadata
// (in packaged builds). No config is baked into the renderer.

export interface RuntimeConfig {
  /** Base URL of the Druz9 backend (monolith). */
  apiBaseURL: string;
  /** Channel for electron-updater. Empty disables auto-update. */
  updateFeedURL: string;
  /** true when running via `electron-vite dev`. */
  isDev: boolean;
}

export function loadRuntimeConfig(): RuntimeConfig {
  const isDev = process.env.NODE_ENV !== 'production' && !process.env.ELECTRON_IS_PACKAGED;
  return {
    apiBaseURL:
      process.env.DRUZ9_API_BASE_URL ||
      (isDev ? 'http://localhost:8080' : 'https://api.druzya.tech'),
    updateFeedURL: process.env.DRUZ9_UPDATE_FEED_URL || '',
    isDev,
  };
}
