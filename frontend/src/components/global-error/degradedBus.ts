// degradedBus — tiny in-process pub/sub for service-degradation events
// (Wave-11 global error UI plumbing).
//
// The apiClient (or any feature query) calls degradedBus.report() when it
// detects a critical scope is failing. <DegradedBanner /> subscribes and
// surfaces the message. There is exactly ONE bus per app — global module
// state, not React context, because the apiClient lives outside the React
// tree.
//
// Design note: scope is intentionally a free-form string so callers don't
// have to pre-register. Naming convention recommended: lowercase
// dot-separated module path, e.g. "weekly-report", "ai-coach", "atlas".

export type DegradedScope = string

type DegradedEvent =
  | { kind: 'degraded'; scope: DegradedScope; reason: string }
  | { kind: 'recovered'; scope: DegradedScope }

type Listener = (evt: DegradedEvent) => void

class DegradedBus {
  private listeners = new Set<Listener>()
  private active = new Map<DegradedScope, string>()

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    // Replay current state to the new subscriber so a banner mounted after
    // a degradation event still knows about it.
    for (const [scope, reason] of this.active) {
      fn({ kind: 'degraded', scope, reason })
    }
    return () => {
      this.listeners.delete(fn)
    }
  }

  /** Mark a scope as degraded. Idempotent — calling with the same reason
   *  twice doesn't re-fire listeners. */
  report(scope: DegradedScope, reason: string): void {
    if (this.active.get(scope) === reason) return
    this.active.set(scope, reason)
    this.emit({ kind: 'degraded', scope, reason })
  }

  /** Mark a scope as healthy again. No-op if it wasn't degraded. */
  recover(scope: DegradedScope): void {
    if (!this.active.has(scope)) return
    this.active.delete(scope)
    this.emit({ kind: 'recovered', scope })
  }

  private emit(evt: DegradedEvent): void {
    for (const l of this.listeners) {
      try {
        l(evt)
      } catch (e) {
        // Don't let one buggy subscriber break the others.
        // eslint-disable-next-line no-console
        console.error('[degradedBus] listener threw:', e)
      }
    }
  }
}

export const degradedBus = new DegradedBus()
