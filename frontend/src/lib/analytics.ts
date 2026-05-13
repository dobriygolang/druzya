// analytics.ts — opt-in product analytics client for web (druz9.online).
//
// Privacy model:
//   - Web default: opted-OUT until user explicitly accepts in Settings.
//   - localStorage caches consent для instant boot decision; backend
//     GetConsent — secondary truth for cross-device sync.
//   - PII sanitization runs in track() — emails / phones / tokens get
//     dropped before queueing.
//   - On opt-out: queue is flushed-empty, no more events buffer.
//
// Transport: plain fetch к REST alias `/api/v1/telemetry/events`. Bearer
// token attached if available (apiClient stores access_token в localStorage).
// Failures swallowed — events эфемерны, retry storms hurt UX more than
// missing a few data points.
import { ANALYTICS_EVENTS, type AnalyticsEvent } from './analytics-events';

const STORAGE_KEY = 'druz9:analytics-opted-in:v1';
const SURFACE = 'web' as const;
const FLUSH_INTERVAL_MS = 2_000;
const BATCH_CAP = 100;
const ACCESS_TOKEN_KEY = 'druz9_access_token';

type PropValue = string | number | boolean;

interface TrackPayload {
  name: string;
  occurred_at: string; // ISO-8601
  properties: Record<string, string>;
  surface: 'web' | 'hone' | 'cue';
}

// PII guard: drop properties that look like emails / phone numbers /
// JWT-ish tokens. Helps callers stay sloppy без отравления storage.
const PII_REGEX = /\b[\w.+-]+@[\w.-]+\.\w{2,}\b|\b\+?\d{10,}\b|eyJ[\w-]+\.[\w-]+\.[\w-]+/i;

function sanitize(props: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue;
    const str = String(v);
    if (PII_REGEX.test(str)) continue;
    // Cap at 512 chars to match server-side validator
    out[k] = str.length > 512 ? str.slice(0, 512) : str;
  }
  return out;
}

class AnalyticsClient {
  private optedIn = false;
  private userId: string | null = null;
  private queue: TrackPayload[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  /** Bootstrap session. Idempotent — повторный вызов re-reads consent. */
  init(opts: { userId: string; optedIn?: boolean }): void {
    this.userId = opts.userId;
    if (typeof opts.optedIn === 'boolean') {
      this.optedIn = opts.optedIn;
    } else {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        // Default web: opted-OUT until user explicitly accepts.
        this.optedIn = stored === 'true';
      } catch {
        this.optedIn = false;
      }
    }
    if (!this.initialized) {
      this.initialized = true;
      this.installFlushHooks();
    }
  }

  setOptedIn(opted: boolean): void {
    this.optedIn = opted;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(opted));
    } catch {
      /* private mode / quota — degrade gracefully */
    }
    // Best-effort backend sync для cross-device consent.
    void this.callBackendConsent(opted);
    if (!opted) {
      // Drop queued events on opt-out — privacy first.
      this.queue = [];
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
    }
  }

  isOptedIn(): boolean {
    return this.optedIn;
  }

  /**
   * Current bound user id, or null если init() ещё не вызывали. Backend
   * already sees the canonical id from auth — this getter exists so call
   * sites can branch on «logged-in?» без отдельного store lookup.
   */
  getUserId(): string | null {
    return this.userId;
  }

  /**
   * track — queue an event for batched flush. No-op when opted out.
   * Properties are sanitized против PII перед queueing.
   */
  track(event: AnalyticsEvent | string, properties: Record<string, PropValue> = {}): void {
    if (!this.optedIn) return;
    if (typeof window === 'undefined') return;
    this.queue.push({
      name: event,
      occurred_at: new Date().toISOString(),
      properties: sanitize(properties),
      surface: SURFACE,
    });
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    if (!this.optedIn) {
      this.queue = [];
      return;
    }
    const events = this.queue.splice(0, BATCH_CAP);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = readAccessToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch('/api/v1/telemetry/events', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ events }),
      });
    } catch {
      // Network failure — silent drop. Events эфемерны, retry storm worse.
    }
  }

  private async callBackendConsent(opted: boolean): Promise<void> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = readAccessToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
      await fetch('/api/v1/telemetry/consent', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          surface: SURFACE,
          opted_in: opted,
          consent_version: 1,
        }),
      });
    } catch {
      /* best-effort */
    }
  }

  private installFlushHooks(): void {
    if (typeof window === 'undefined') return;
    // Flush before tab close — `pagehide` survives bfcache better than `unload`.
    const onHide = (): void => {
      void this.flush();
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush();
    });
  }
}

function readAccessToken(): string | null {
  try {
    return window.localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export const analytics = new AnalyticsClient();
export { ANALYTICS_EVENTS };
export type { AnalyticsEvent };
