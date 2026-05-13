// analytics.ts — opt-in product analytics client for Cue (stealth desktop).
//
// Stealth product privacy posture: defaults OPTED-OUT. User must explicitly
// flip the toggle in Settings → Privacy. Once on, behaves identically to
// the web/hone clients.
//
// Transport: renderer batches into a queue + flushes via IPC to the main
// process every 2s (or BATCH_CAP). Main owns the bearer auth (keychain),
// renderer never sees the token.
//
// Privacy guards:
//   - PII regex drops emails / phone numbers / JWT tokens before queueing.
//   - On opt-out: queue is wiped, no further events buffer.
//   - Stealth default: opted-OUT until explicitly enabled.
import { ANALYTICS_EVENTS, type AnalyticsEvent } from './analytics-events';

const STORAGE_KEY = 'druz9:analytics-opted-in:v1';
// Surface tag is injected на main-process side (see cue/main/api/telemetry.ts)
// so the renderer never has to thread it through every event. Documented here
// to keep the cross-product taxonomy story consistent with hone/web clients
// where SURFACE is renderer-side.
const FLUSH_INTERVAL_MS = 2_000;
const BATCH_CAP = 100;

type PropValue = string | number | boolean;

interface QueuedEvent {
  name: string;
  occurredAt: string;
  properties: Record<string, string>;
}

const PII_REGEX = /\b[\w.+-]+@[\w.-]+\.\w{2,}\b|\b\+?\d{10,}\b|eyJ[\w-]+\.[\w-]+\.[\w-]+/i;

function sanitize(props: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue;
    const str = String(v);
    if (PII_REGEX.test(str)) continue;
    out[k] = str.length > 512 ? str.slice(0, 512) : str;
  }
  return out;
}

class AnalyticsClient {
  private optedIn = false; // Cue default: opted-OUT (stealth privacy).
  private userId: string | null = null;
  private queue: QueuedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  init(opts: { userId: string; optedIn?: boolean }): void {
    this.userId = opts.userId;
    if (typeof opts.optedIn === 'boolean') {
      this.optedIn = opts.optedIn;
    } else {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        // Stealth default: opted-OUT unless user explicitly enables.
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
      /* private mode */
    }
    // Best-effort backend sync via main process.
    void this.callBackendConsent(opted);
    if (!opted) {
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
   * Bound user id, or null до init(). Cue-specific note: this stays
   * client-side only — main process never sees it; bearer auth is the
   * canonical identity для backend.
   */
  getUserId(): string | null {
    return this.userId;
  }

  track(event: AnalyticsEvent | string, properties: Record<string, PropValue> = {}): void {
    if (!this.optedIn) return;
    if (typeof window === 'undefined') return;
    this.queue.push({
      name: event,
      occurredAt: new Date().toISOString(),
      properties: sanitize(properties),
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
    const batch = this.queue.splice(0, BATCH_CAP);
    try {
      const bridge = typeof window !== 'undefined' ? window.druz9 : undefined;
      if (!bridge?.telemetry) return;
      await bridge.telemetry.record(batch);
    } catch {
      // Silent: events ephemeral, retry storm worse than data gap.
    }
  }

  private async callBackendConsent(opted: boolean): Promise<void> {
    try {
      const bridge = typeof window !== 'undefined' ? window.druz9 : undefined;
      if (!bridge?.telemetry) return;
      await bridge.telemetry.setConsent({ optedIn: opted, consentVersion: 1 });
    } catch {
      /* best-effort */
    }
  }

  private installFlushHooks(): void {
    if (typeof window === 'undefined') return;
    const onHide = (): void => {
      void this.flush();
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
  }
}

export const analytics = new AnalyticsClient();
export { ANALYTICS_EVENTS };
export type { AnalyticsEvent };
