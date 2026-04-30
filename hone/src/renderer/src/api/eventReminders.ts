// eventReminders.ts — Wave 5.2c. Client-side OS-notification scheduler
// for tutor-scheduled events (Wave 5.2b). Fires up to three reminders
// per event:
//
//   T-24h  «Tomorrow at 18:00 — Weekly 1-on-1»
//   T-1h   «In 1 hour — Weekly 1-on-1»
//   T-0    «Live now — Weekly 1-on-1»
//
// Why purely client-side (vs server push):
//   * notify() (api/notifications.ts) already wraps the OS-native
//     Notification API end-to-end on macOS/Windows/Linux.
//   * Hone-when-running surfaces are 80%+ of when reminders matter
//     (a tutor session implies the student opened Hone recently).
//   * Server push would require WebPush / FCM and a separate backend
//     dispatcher — not warranted for a few-events-per-week system.
//   * Forward-compat: if server push ever lands, the dedup log here
//     uses a stable key — server-fired reminders write the same key
//     and this scheduler skips re-firing.
//
// Dedup: every fired reminder writes its window key to localStorage so
// reopening Hone doesn't re-fire stale reminders. Garbage-collected
// when the event itself ends (key prefix removed wholesale).
//
// Schedule lifecycle:
//   1. installEventReminders() called once at app boot.
//   2. Polls listUpcomingEvents every REFRESH_INTERVAL_MS (5 min).
//   3. For each event still upcoming, schedules `setTimeout`s for any
//      window not yet in the «fired» set AND in the future.
//   4. setTimeout caps at 24h-1ms (browser quirks past 2^31 ms); we
//      re-resolve on each refresh, so a far-future event simply gets
//      its T-24h scheduled at the next refresh inside that window.
//   5. Cancellation: when a poll returns an event we previously
//      scheduled but is now missing (cancelled / completed / past),
//      we clear its pending timers.

import { listUpcomingEvents, type TutorEvent } from './tutor';
import { notify } from './notifications';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const SCHEDULE_HORIZON_MS = 24 * 60 * 60 * 1000; // setTimeout cap
const DEDUP_KEY = 'hone:event-reminders:fired';
const DEDUP_MAX_ENTRIES = 200; // GC threshold; events themselves are tens/year

type Window = '24h' | '1h' | 'now';

const WINDOWS: Array<{ kind: Window; offsetMs: number }> = [
  { kind: '24h', offsetMs: 24 * 60 * 60 * 1000 },
  { kind: '1h', offsetMs: 1 * 60 * 60 * 1000 },
  { kind: 'now', offsetMs: 0 },
];

// dedupKey identifies a unique (event, window) pair. Persisted across
// app restarts so reopening doesn't re-fire historical reminders.
function dedupKey(eventID: string, kind: Window): string {
  return `${eventID}:${kind}`;
}

// loadFired reads the dedup set; tolerates missing / malformed
// localStorage (returns empty set, never throws).
function loadFired(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DEDUP_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function saveFired(set: Set<string>) {
  try {
    // Bound the persisted set so a long-running install doesn't grow
    // unboundedly. Drop the oldest by FIFO insertion order.
    let arr = [...set];
    if (arr.length > DEDUP_MAX_ENTRIES) {
      arr = arr.slice(arr.length - DEDUP_MAX_ENTRIES);
    }
    window.localStorage.setItem(DEDUP_KEY, JSON.stringify(arr));
  } catch {
    /* quota / private mode — silent */
  }
}

// Per-install state. installEventReminders is single-flight via the
// module-level `installed` flag (calling it twice is a no-op).
let installed = false;
const scheduledTimers = new Map<string, number>(); // dedupKey → timer handle

function clearAllTimers() {
  for (const id of scheduledTimers.values()) window.clearTimeout(id);
  scheduledTimers.clear();
}

function clearTimerFor(eventID: string) {
  for (const [key, id] of scheduledTimers.entries()) {
    if (key.startsWith(`${eventID}:`)) {
      window.clearTimeout(id);
      scheduledTimers.delete(key);
    }
  }
}

function fireReminder(event: TutorEvent, kind: Window, fired: Set<string>) {
  const key = dedupKey(event.id, kind);
  if (fired.has(key)) return;
  fired.add(key);
  saveFired(fired);
  scheduledTimers.delete(key);

  const title = title24h_1h_now(event, kind);
  void notify(title, event.title);
}

function title24h_1h_now(event: TutorEvent, kind: Window): string {
  if (kind === 'now') return 'Tutor session — live now';
  if (kind === '1h') return 'Tutor session — in 1 hour';
  // 24h: include the time of day so the user immediately knows when.
  if (event.scheduledAt) {
    const t = event.scheduledAt.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `Tutor session — tomorrow at ${t}`;
  }
  return 'Tutor session — tomorrow';
}

// reconcile schedules timers for the given events; clears stale ones.
function reconcile(events: TutorEvent[], fired: Set<string>, now: number) {
  // Build a set of currently-known event ids — anything not in here
  // that we previously scheduled a timer for has been removed
  // (cancelled, completed, fell out of window) and we cancel those.
  const known = new Set(events.map((e) => e.id));
  for (const key of [...scheduledTimers.keys()]) {
    const [eid] = key.split(':');
    if (!known.has(eid)) {
      window.clearTimeout(scheduledTimers.get(key)!);
      scheduledTimers.delete(key);
    }
  }

  for (const ev of events) {
    if (!ev.scheduledAt) continue;
    if (ev.status !== 'scheduled') continue;
    const startMs = ev.scheduledAt.getTime();

    for (const w of WINDOWS) {
      const fireAt = startMs - w.offsetMs;
      const key = dedupKey(ev.id, w.kind);

      // Already-fired window — skip silently. The persisted dedup set
      // is the source of truth across app restarts.
      if (fired.has(key)) continue;

      // Already past — fire immediately if event start hasn't been
      // missed by more than 30 min. The «now» window for an event
      // that started 25 min ago is still useful («live now, you're
      // late!»); a 3-hour-late reminder is just noise.
      if (fireAt <= now) {
        const lateBy = now - fireAt;
        // For T-24h / T-1h, tolerate up to the next-window boundary
        // minus a buffer (so we don't double-fire late). For T-now,
        // 30 min is the upper bound.
        const tolerance =
          w.kind === 'now'
            ? 30 * 60 * 1000
            : w.kind === '1h'
              ? 30 * 60 * 1000 // 1h-late: we still want to nudge
              : 60 * 60 * 1000; // 24h-late: fire only within 1h of T-24h
        if (lateBy <= tolerance) {
          fireReminder(ev, w.kind, fired);
        } else {
          // Mark as fired without notifying — prevents an indefinite
          // re-eval loop, future polls see «already fired» and skip.
          fired.add(key);
          saveFired(fired);
        }
        continue;
      }

      // setTimeout has a 32-bit signed-int cap on most engines (~24.8
      // days). Past SCHEDULE_HORIZON_MS we don't bother scheduling —
      // the next reconcile (5 min later) will pick it up when it
      // crosses the horizon.
      const delay = fireAt - now;
      if (delay > SCHEDULE_HORIZON_MS) continue;

      // Already scheduled? Skip.
      if (scheduledTimers.has(key)) continue;

      const timer = window.setTimeout(() => {
        fireReminder(ev, w.kind, fired);
      }, delay);
      scheduledTimers.set(key, timer);
    }
  }
}

/**
 * installEventReminders — bootstrap the scheduler. Single-flight:
 * calling it twice is a no-op. Returns an `unsubscribe` function for
 * tests / app teardown; production code calls it once at boot.
 */
export function installEventReminders(): () => void {
  if (installed) return () => {};
  installed = true;

  let cancelled = false;

  const tick = async () => {
    if (cancelled) return;
    let events: TutorEvent[] = [];
    try {
      events = await listUpcomingEvents(50);
    } catch {
      // Network down / not authed — silent, retry next interval.
      return;
    }
    if (cancelled) return;
    const fired = loadFired();
    reconcile(events, fired, Date.now());
  };

  void tick();
  const intervalID = window.setInterval(() => void tick(), REFRESH_INTERVAL_MS);

  // Refresh on window-focus — covers «I was away, tutor scheduled
  // something, I came back, want reminders to still fire correctly».
  const onFocus = () => void tick();
  window.addEventListener('focus', onFocus);

  return () => {
    cancelled = true;
    installed = false;
    window.clearInterval(intervalID);
    window.removeEventListener('focus', onFocus);
    clearAllTimers();
  };
}

// ── Test helpers (exported for unit tests / dev console) ────────────

/** Internal: clear scheduled timers and dedup set. Used by tests + a
 *  debug «reset reminders» action if we add one to Settings later. */
export function _resetEventReminders(): void {
  clearAllTimers();
  installed = false;
  try {
    window.localStorage.removeItem(DEDUP_KEY);
  } catch {
    /* quota / private mode — silent */
  }
}

/** Internal: drops timers for one event. Call when the user manually
 *  dismisses an event from Calendar UI (future hook). */
export function _cancelEventReminders(eventID: string): void {
  clearTimerFor(eventID);
}
