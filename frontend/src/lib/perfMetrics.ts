// perfMetrics.ts — Core Web Vitals capture (Phase I launch readiness, 2026-05-12).
//
// Why hand-rolled and not `web-vitals` npm package:
//   1. The library is ~5KB but pulls a runtime dep we can avoid — same
//      PerformanceObserver primitives below.
//   2. We only need four numbers (LCP / INP / CLS / TTFB) and a tiny
//      reporter — not the full battery (FCP, FID-legacy, etc).
//   3. Zero deps keeps the bundle slim and the security surface narrow.
//
// In dev: each metric is logged via console.debug under '[CWV]' prefix.
// In prod: posted to backend `/api/v1/telemetry/cwv` with sendBeacon (silent
// on failure — no user-visible side effect).
//
// Thresholds (Google CWV guidance, 2025-04 update):
//   LCP   ≤ 2500ms  good   ≤ 4000ms needs-improvement   > 4000ms poor
//   INP   ≤ 200ms   good   ≤ 500ms  needs-improvement   > 500ms  poor
//   CLS   ≤ 0.1     good   ≤ 0.25   needs-improvement   > 0.25   poor
//   TTFB  ≤ 800ms   good   ≤ 1800ms needs-improvement   > 1800ms poor

export type CWVMetricName = 'LCP' | 'INP' | 'CLS' | 'TTFB'
export type CWVRating = 'good' | 'needs-improvement' | 'poor'

export interface CWVMetric {
  name: CWVMetricName
  value: number
  rating: CWVRating
  /** Page path (no query/hash) at the moment of capture. */
  path: string
}

type Reporter = (metric: CWVMetric) => void

const THRESHOLDS: Record<CWVMetricName, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  TTFB: [800, 1800],
}

function rate(name: CWVMetricName, value: number): CWVRating {
  const [good, poor] = THRESHOLDS[name]
  if (value <= good) return 'good'
  if (value <= poor) return 'needs-improvement'
  return 'poor'
}

function safePath(): string {
  if (typeof window === 'undefined') return '/'
  return window.location.pathname || '/'
}

function emit(report: Reporter, name: CWVMetricName, value: number) {
  report({ name, value, rating: rate(name, value), path: safePath() })
}

function observeLCP(report: Reporter) {
  // Pick the LARGEST element rendered before user interaction. We capture the
  // final value on visibilitychange (matches web-vitals semantics).
  let lastValue = 0
  try {
    const po = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const last = entries[entries.length - 1] as PerformanceEntry & {
        renderTime?: number
        loadTime?: number
      }
      if (!last) return
      lastValue = last.renderTime ?? last.loadTime ?? last.startTime
    })
    po.observe({ type: 'largest-contentful-paint', buffered: true })
    const finalize = () => {
      if (lastValue > 0) emit(report, 'LCP', lastValue)
      po.disconnect()
    }
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') finalize()
    })
    addEventListener('pagehide', finalize)
  } catch {
    // Browser without LCP support — silent.
  }
}

function observeINP(report: Reporter) {
  // INP = worst-case input latency. We track via `event` PerformanceObserver
  // and emit the max duration observed when the page hides.
  let worst = 0
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { duration: number }>) {
        if (entry.duration > worst) worst = entry.duration
      }
    })
    // 'event' is the modern type backing INP; ignore older 'first-input'.
    po.observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit)
    const finalize = () => {
      if (worst > 0) emit(report, 'INP', worst)
      po.disconnect()
    }
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') finalize()
    })
    addEventListener('pagehide', finalize)
  } catch {
    // 'event' entry type unsupported (Safari < 16.4) — silent.
  }
}

function observeCLS(report: Reporter) {
  // CLS = sum of layout-shift scores in a session window (5s rolling).
  // Simplified: cumulative total minus shifts marked hadRecentInput.
  let cls = 0
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<
        PerformanceEntry & { value: number; hadRecentInput: boolean }
      >) {
        if (!entry.hadRecentInput) cls += entry.value
      }
    })
    po.observe({ type: 'layout-shift', buffered: true })
    const finalize = () => {
      emit(report, 'CLS', cls)
      po.disconnect()
    }
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') finalize()
    })
    addEventListener('pagehide', finalize)
  } catch {
    // Unsupported — silent.
  }
}

function measureTTFB(report: Reporter) {
  // Read directly from navigation timing API. Available on document ready.
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    if (!nav) return
    const ttfb = nav.responseStart - nav.requestStart
    if (ttfb >= 0 && Number.isFinite(ttfb)) emit(report, 'TTFB', ttfb)
  } catch {
    // Unsupported — silent.
  }
}

// Default reporter — dev logs, prod posts to backend.
function defaultReporter(metric: CWVMetric) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[CWV]', metric)
    return
  }
  // Prod: best-effort sendBeacon. If endpoint missing → backend returns 404,
  // the metric is dropped on the floor (silent — no retry, no console error).
  try {
    const body = JSON.stringify(metric)
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      navigator.sendBeacon('/api/v1/telemetry/cwv', new Blob([body], { type: 'application/json' }))
    }
  } catch {
    // sendBeacon throws on quota / size — ignore.
  }
}

/**
 * Start capturing Core Web Vitals for the current page load.
 *
 * Idempotent: subsequent calls are no-ops (PerformanceObservers are bound to
 * the page lifecycle, not the call). Safe to call from `main.tsx` bootstrap.
 *
 * @param report optional custom reporter (defaults to dev-console + prod-beacon)
 */
let started = false
export function startCWV(report: Reporter = defaultReporter): void {
  if (started) return
  if (typeof window === 'undefined') return
  if (typeof PerformanceObserver === 'undefined') return
  started = true

  observeLCP(report)
  observeINP(report)
  observeCLS(report)
  // TTFB is synchronous — read it immediately.
  measureTTFB(report)
}
