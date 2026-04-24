// Renderer-side Sentry bootstrap. Paired with main/sentry.ts; the
// electron transport in main forwards renderer events automatically.
//
// We don't pass a DSN here — the @sentry/electron renderer init picks
// up the main-side configuration. Renderer code only needs to call the
// init once to register the global window.onerror handler.

let started = false;

export async function initSentryRenderer(): Promise<void> {
  if (started) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Sentry: any = await import('@sentry/electron/renderer');
    Sentry.init({});
    started = true;
  } catch {
    // Package not installed — renderer stays silent.
  }
}
