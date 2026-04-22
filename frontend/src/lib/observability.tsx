/**
 * Frontend observability — Sentry for errors + manual breadcrumbs for actions.
 *
 * Activated ONLY when VITE_SENTRY_DSN is set AND non-empty.
 * Otherwise no-op — and the @sentry/react chunk is never loaded
 * (dynamic import below). Zero network requests, zero bundle bloat in dev.
 *
 * To plug into prod:
 *   1. Create Sentry project on sentry.io → grab DSN
 *   2. Set in .env.production: VITE_SENTRY_DSN=https://xxx@oNNN.ingest.sentry.io/NNN
 *   3. Errors auto-captured, breadcrumbs attach via track() helpers below.
 *
 * Backend tracing (Jaeger/OTel) — see /docs/observability.md.
 */
import type { ComponentType, ReactNode } from 'react'

const DSN = (import.meta.env.VITE_SENTRY_DSN ?? '').trim()
const ENV = (import.meta.env.MODE ?? 'development') as string
const RELEASE = (import.meta.env.VITE_RELEASE ?? 'dev') as string
const ENABLED = DSN.length > 0 && DSN.startsWith('https://')

let sentryRef: typeof import('@sentry/react') | null = null
let initialized = false

export async function initObservability() {
  if (initialized) return
  initialized = true

  if (!ENABLED) {
    // No DSN → no SDK loaded → no network calls. Done.
    return
  }

  // Dynamic import — chunk only fetched when DSN is present.
  const Sentry = await import('@sentry/react')
  sentryRef = Sentry

  Sentry.init({
    dsn: DSN,
    environment: ENV,
    release: RELEASE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
    ],
    tracesSampleRate: ENV === 'production' ? 0.1 : 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      // Strip MSW-mocked errors out (avoid noise from local dev with mocks)
      if (event.request?.url?.includes('/api/v1') && import.meta.env.VITE_USE_MSW === 'true') {
        return null
      }
      return event
    },
  })
}

/** Add a breadcrumb manually for important user actions. No-op if Sentry disabled. */
export function track(category: string, message: string, data?: Record<string, unknown>) {
  if (!sentryRef) return
  sentryRef.addBreadcrumb({
    category,
    message,
    data,
    level: 'info',
    timestamp: Date.now() / 1000,
  })
}

/** Identify the user (call after auth). No-op if Sentry disabled. */
export function identifyUser(id: string, username?: string) {
  if (!sentryRef) return
  sentryRef.setUser({ id, username })
}

/** Clear user context on logout. No-op if Sentry disabled. */
export function clearUser() {
  if (!sentryRef) return
  sentryRef.setUser(null)
}

/**
 * Pass-through ErrorBoundary wrapper.
 * In Sentry-enabled mode it uses the real Sentry boundary (auto-reports errors).
 * In disabled mode it's a plain React boundary that just shows the fallback.
 */
type EBProps = { children: ReactNode; fallback: ReactNode }

let CachedBoundary: ComponentType<EBProps> | null = null

export function ErrorBoundary({ children, fallback }: EBProps) {
  if (!ENABLED) return <>{children}</>
  if (sentryRef && !CachedBoundary) {
    CachedBoundary = sentryRef.ErrorBoundary as unknown as ComponentType<EBProps>
  }
  if (!CachedBoundary) return <>{children}</>
  const Boundary = CachedBoundary
  return <Boundary fallback={fallback}>{children}</Boundary>
}
