/**
 * Frontend observability — Sentry for errors + manual breadcrumbs for actions.
 *
 * Activated when VITE_SENTRY_DSN is set. Otherwise no-op (dev-friendly).
 *
 * To plug into prod:
 *   1. Create Sentry project → grab DSN
 *   2. Set in .env.production: VITE_SENTRY_DSN=https://...
 *   3. Errors auto-captured, breadcrumbs attach via captureBreadcrumb() helpers below.
 *
 * Backend tracing (Jaeger/OTel) — TODO, see /docs/observability.md.
 */
import * as Sentry from '@sentry/react'

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined
const ENV = (import.meta.env.MODE ?? 'development') as string
const RELEASE = (import.meta.env.VITE_RELEASE ?? 'dev') as string

let initialized = false

export function initObservability() {
  if (initialized) return
  if (!DSN) {
    // Dev mode without DSN — keep silent. Console errors stay visible.
    initialized = true
    return
  }

  Sentry.init({
    dsn: DSN,
    environment: ENV,
    release: RELEASE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    tracesSampleRate: ENV === 'production' ? 0.1 : 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      // strip MSW-mocked errors out (avoid noise from local dev with mocks)
      if (event.request?.url?.includes('/api/v1') && import.meta.env.VITE_USE_MSW === 'true') {
        return null
      }
      return event
    },
  })

  initialized = true
}

/** Add a breadcrumb manually for important user actions (used by mutations). */
export function track(category: string, message: string, data?: Record<string, unknown>) {
  if (!initialized || !DSN) return
  Sentry.addBreadcrumb({ category, message, data, level: 'info', timestamp: Date.now() / 1000 })
}

/** Identify the user (call after auth). */
export function identifyUser(id: string, username?: string) {
  if (!initialized || !DSN) return
  Sentry.setUser({ id, username })
}

/** Clear user context on logout. */
export function clearUser() {
  if (!initialized || !DSN) return
  Sentry.setUser(null)
}

export const ErrorBoundary = Sentry.ErrorBoundary
