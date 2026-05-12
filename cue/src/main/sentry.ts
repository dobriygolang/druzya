// Sentry bootstrap for the main process.
//
// We use @sentry/electron, which transparently handles the
// main-vs-renderer split: initialize here in main, and every renderer
// that calls `@sentry/electron/renderer`'s init gets wired into the
// same transport. No DSN → no init → fully silent (not even a warning
// logged) so dev builds stay quiet.
//
// Privacy: we scrub the access token from breadcrumbs and set the
// `beforeSend` hook to drop events whose `message` contains an
// Authorization header string. We never ship user prompt text
// contents to Sentry — only structural error info.

import type { RuntimeConfig } from './config/bootstrap';

let started = false;

export async function initSentryMain(cfg: RuntimeConfig, appVersion: string): Promise<void> {
  if (started || !cfg.sentryDSN) return;
  try {
    // Dynamic import so the package is truly optional: if it's not
    // installed (users who skipped the `npm i @sentry/electron` step),
    // nothing breaks.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Sentry: any = await import('@sentry/electron/main');
    Sentry.init({
      dsn: cfg.sentryDSN,
      environment: cfg.environment,
      release: `druz9-copilot@${appVersion}`,
      // Keep the volume down: only tag real exceptions; no performance
      // / session / autoBreadcrumbs flood.
      tracesSampleRate: 0,
      autoSessionTracking: false,
      beforeSend(event: { message?: string; request?: { headers?: Record<string, unknown> } }) {
        const msg = event?.message ?? '';
        if (typeof msg === 'string' && /authorization/i.test(msg)) return null;
        // Scrub any accidental Authorization header.
        if (event?.request?.headers) {
          delete event.request.headers.Authorization;
          delete event.request.headers.authorization;
        }
        return event;
      },
    });
    started = true;
  } catch {
    // Module not installed or failed to load — stay silent.
  }
}
