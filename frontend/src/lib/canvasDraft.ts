// canvasDraft.ts — ephemeral autosave for the system-design canvas.
//
// Storage: localStorage (5–10 MB quota per origin, browser-managed
// eviction). Backend never sees a draft — the canonical record only
// appears in `pipeline_attempts` after the user clicks Submit. This
// keeps the LLM-attached PNG out of Redis and avoids any "Redis OOM"
// failure mode.
//
// Sync: BroadcastChannel (one per attempt) so the standalone
// /mock/canvas/{id} tab and the main /mock/pipeline/{id} tab see each
// other's edits within ~10 ms. Falls back to the `storage` event
// (cross-tab) if BroadcastChannel is unavailable — the storage event
// fires on every localStorage write in OTHER tabs of the same origin.
//
// TTL: 24h. The browser doesn't expire localStorage by itself, so we
// stamp `updatedAt` on every write and discard on read if the draft is
// stale. Cleared explicitly on submit success or pipeline finalisation.

export type ExcalidrawSceneJSON = {
  elements: unknown[]
  files: Record<string, unknown>
}

export type CanvasDraft = {
  sceneJSON: ExcalidrawSceneJSON
  nonFunctionalMD: string
  contextMD: string
  updatedAt: number // Date.now() at write time
}

const KEY_PREFIX = 'druz9.mock.canvas.'
const TTL_MS = 24 * 60 * 60 * 1000

export function draftStorageKey(attemptId: string): string {
  return KEY_PREFIX + attemptId
}

export function loadCanvasDraft(attemptId: string): CanvasDraft | null {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(attemptId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CanvasDraft
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.updatedAt !== 'number') return null
    if (Date.now() - parsed.updatedAt > TTL_MS) {
      // Stale — drop it now instead of leaving the row to rot.
      window.localStorage.removeItem(draftStorageKey(attemptId))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

// saveCanvasDraft returns 'ok' on success, 'quota' on quota exhaustion
// even after sweeping stale entries, 'error' for any other failure.
// The hook surfaces 'quota' to the UI as a non-blocking warning so the
// user knows autosave is OFF and Submit is the only safety net.
export type SaveResult = 'ok' | 'quota' | 'error'

export function saveCanvasDraft(
  attemptId: string,
  draft: Omit<CanvasDraft, 'updatedAt'>,
): SaveResult {
  const key = draftStorageKey(attemptId)
  const payload: CanvasDraft = { ...draft, updatedAt: Date.now() }
  const serialised = JSON.stringify(payload)
  try {
    window.localStorage.setItem(key, serialised)
    return 'ok'
  } catch (e) {
    if (!isQuotaError(e)) return 'error'
    // Quota exhausted — try to reclaim space from stale drafts (other
    // attempts older than TTL) and retry once before giving up.
    sweepStaleCanvasDrafts()
    try {
      window.localStorage.setItem(key, serialised)
      return 'ok'
    } catch (e2) {
      return isQuotaError(e2) ? 'quota' : 'error'
    }
  }
}

function isQuotaError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  // Different browsers use different names / codes — match all known
  // QuotaExceeded shapes.
  const name = e.name
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    name === 'QUOTA_EXCEEDED_ERR'
  )
}

// sweepStaleCanvasDrafts removes draft entries whose updatedAt is older
// than TTL. Cheap to call — localStorage is fully synchronous and the
// number of mock-canvas keys is bounded by user activity (typically <5).
export function sweepStaleCanvasDrafts(): void {
  try {
    const cutoff = Date.now() - TTL_MS
    const toDelete: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (!k || !k.startsWith(KEY_PREFIX)) continue
      try {
        const raw = window.localStorage.getItem(k)
        if (!raw) {
          toDelete.push(k)
          continue
        }
        const parsed = JSON.parse(raw) as CanvasDraft
        if (typeof parsed?.updatedAt !== 'number' || parsed.updatedAt < cutoff) {
          toDelete.push(k)
        }
      } catch {
        // Corrupt row — drop it.
        toDelete.push(k)
      }
    }
    for (const k of toDelete) window.localStorage.removeItem(k)
  } catch {
    /* noop */
  }
}

export function clearCanvasDraft(attemptId: string): void {
  try {
    window.localStorage.removeItem(draftStorageKey(attemptId))
  } catch {
    /* noop */
  }
}

// Sweep drafts for every attempt of a finished pipeline. Called from
// the debrief page on mount (debrief = the only place the user lands
// after finalisation, so the cleanup is reliably triggered).
export function clearCanvasDraftsForAttempts(attemptIds: string[]): void {
  for (const id of attemptIds) clearCanvasDraft(id)
}

// ── BroadcastChannel ──────────────────────────────────────────────────

export type CanvasMessage =
  | { type: 'draft'; payload: CanvasDraft }
  | { type: 'alive'; tabId: string }
  | { type: 'gone'; tabId: string }
  | { type: 'submitted' }

const CHANNEL_PREFIX = 'druz9.mock.canvas.'

export function openCanvasChannel(attemptId: string): {
  post: (msg: CanvasMessage) => void
  subscribe: (handler: (msg: CanvasMessage) => void) => () => void
  close: () => void
} {
  const name = CHANNEL_PREFIX + attemptId
  const ch = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(name) : null
  return {
    post: (msg) => {
      if (ch) {
        try {
          ch.postMessage(msg)
        } catch {
          /* ignore — closed or DataCloneError */
        }
      }
    },
    subscribe: (handler) => {
      if (!ch) return () => {}
      const onMessage = (e: MessageEvent<CanvasMessage>) => handler(e.data)
      ch.addEventListener('message', onMessage)
      return () => ch.removeEventListener('message', onMessage)
    },
    close: () => {
      if (ch) {
        try {
          ch.close()
        } catch {
          /* ignore */
        }
      }
    },
  }
}
