/**
 * Frontend-observability — Sentry для ошибок + ручные breadcrumbs для действий.
 *
 * Активируется ТОЛЬКО когда VITE_SENTRY_DSN задан и непуст.
 * Иначе — no-op, и chunk @sentry/react никогда не грузится (динамический
 * импорт ниже). Ноль сетевых запросов, ноль раздувания бандла в dev.
 *
 * Как подключить в prod:
 *   1. Создать Sentry-проект на sentry.io → взять DSN
 *   2. В .env.production: VITE_SENTRY_DSN=https://xxx@oNNN.ingest.sentry.io/NNN
 *   3. Ошибки ловятся автоматически, breadcrumbs цепляются через track() ниже.
 *
 * Backend-трассировка (Jaeger/OTel) — см. /docs/observability.md.
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
    // Нет DSN → SDK не грузим → сетевых вызовов нет. Готово.
    return
  }

  // Динамический импорт — chunk скачивается только при наличии DSN.
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
      // Срезаем MSW-мокнутые ошибки (избегаем шума от локального dev с моками)
      if (event.request?.url?.includes('/api/v1') && import.meta.env.VITE_USE_MSW === 'true') {
        return null
      }
      return event
    },
  })
}

/** Добавить breadcrumb вручную для важных пользовательских действий. No-op, если Sentry выключен. */
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

/** Идентифицировать пользователя (вызывать после авторизации). No-op, если Sentry выключен. */
export function identifyUser(id: string, username?: string) {
  if (!sentryRef) return
  sentryRef.setUser({ id, username })
}

/** Очистить пользовательский контекст при logout. No-op, если Sentry выключен. */
export function clearUser() {
  if (!sentryRef) return
  sentryRef.setUser(null)
}

/**
 * Прозрачная обёртка над ErrorBoundary.
 * В режиме с Sentry использует настоящий Sentry boundary (авто-репорт ошибок).
 * В выключенном режиме — обычный React boundary, просто показывающий fallback.
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
