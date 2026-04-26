// useCanvasDraft — React hook bundling the localStorage + BroadcastChannel
// dance so consumers (SysDesignCanvas, MockCanvasFullscreen) just call
// `update(...)` on each edit and receive `restored` + `quotaExceeded` +
// peer presence flags back.
//
// The hook is dual-role:
//   - role='main'       — the /mock/pipeline/{id} tab. Watches for the
//                         standalone tab's heartbeat to know whether to
//                         show the "доска открыта в новой вкладке"
//                         banner. Sends 'submitted' on success.
//   - role='fullscreen' — the /mock/canvas/{id} tab. Pings 'alive' every
//                         3s so the main tab knows it's open. Listens
//                         for 'submitted' so it can auto-close.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './apiClient'
import {
  clearCanvasDraft,
  loadCanvasDraft,
  openCanvasChannel,
  saveCanvasDraft,
  type CanvasDraft,
  type CanvasMessage,
} from './canvasDraft'

const HEARTBEAT_MS = 3000
const PEER_TIMEOUT_MS = 8000 // 2.5 missed heartbeats → declare dead
const SAVE_DEBOUNCE_MS = 1500

export type CanvasDraftState = {
  // The draft as it was on first read (used to seed the canvas / form).
  // null when there's no usable saved draft.
  restored: CanvasDraft | null
  // Latest broadcast we received from the OTHER tab — drives
  // live cross-tab sync without going through localStorage.
  remote: CanvasDraft | null
  // True when localStorage refused our write even after a stale-sweep.
  // UI surfaces this as a non-blocking warning; Submit still works
  // (in-memory state is unaffected).
  quotaExceeded: boolean
  // Main-tab only: true if the fullscreen tab pinged within the last
  // PEER_TIMEOUT_MS. Drives the "доска открыта" hint.
  fullscreenAlive: boolean
}

export function useCanvasDraft(
  attemptId: string,
  role: 'main' | 'fullscreen',
): {
  state: CanvasDraftState
  update: (draft: Omit<CanvasDraft, 'updatedAt'>) => void
  notifySubmitted: () => void
  onSubmittedFromMain: (handler: () => void) => () => void
} {
  const [state, setState] = useState<CanvasDraftState>(() => ({
    restored: loadCanvasDraft(attemptId),
    remote: null,
    quotaExceeded: false,
    fullscreenAlive: false,
  }))

  // If localStorage was empty (cleared, different device, fresh tab in
  // a quota-exhausted session), fall back to the Redis-backed server
  // draft. We only do this once per mount — same convention as
  // `restored` (it seeds initial UI, then live edits flow via update()).
  useEffect(() => {
    if (state.restored) return
    let cancelled = false
    void (async () => {
      try {
        const r = await api<{
          scene_json: unknown
          non_functional_md: string
          context_md: string
          updated_at: string
        }>(`/mock/attempts/${attemptId}/canvas-draft`)
        if (cancelled) return
        const sceneAny = r.scene_json as { elements?: unknown[]; files?: Record<string, unknown> }
        const updatedAt = Date.parse(r.updated_at)
        if (!Number.isFinite(updatedAt)) return
        setState((s) =>
          s.restored
            ? s
            : {
                ...s,
                restored: {
                  sceneJSON: {
                    elements: sceneAny?.elements ?? [],
                    files: sceneAny?.files ?? {},
                  },
                  nonFunctionalMD: r.non_functional_md ?? '',
                  contextMD: r.context_md ?? '',
                  updatedAt,
                },
              },
        )
      } catch {
        // 404 / 503 / network — no draft to restore. Silent.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [attemptId, state.restored])

  const channelRef = useRef<ReturnType<typeof openCanvasChannel> | null>(null)
  const lastPeerSeenAt = useRef<number>(0)
  const debounceRef = useRef<number | null>(null)
  const submittedHandlersRef = useRef<Set<() => void>>(new Set())

  // Open the channel + handle inbound messages.
  useEffect(() => {
    const ch = openCanvasChannel(attemptId)
    channelRef.current = ch
    const unsub = ch.subscribe((msg: CanvasMessage) => {
      switch (msg.type) {
        case 'draft':
          setState((s) => ({ ...s, remote: msg.payload }))
          break
        case 'alive':
          if (role === 'main') {
            lastPeerSeenAt.current = Date.now()
            setState((s) => (s.fullscreenAlive ? s : { ...s, fullscreenAlive: true }))
          }
          break
        case 'gone':
          if (role === 'main') {
            lastPeerSeenAt.current = 0
            setState((s) => (s.fullscreenAlive ? { ...s, fullscreenAlive: false } : s))
          }
          break
        case 'submitted':
          // Only meaningful for fullscreen — main is the sender.
          for (const h of submittedHandlersRef.current) h()
          break
      }
    })
    return () => {
      unsub()
      ch.close()
      channelRef.current = null
    }
  }, [attemptId, role])

  // Heartbeat: fullscreen pings alive; main checks the timeout.
  useEffect(() => {
    if (role === 'fullscreen') {
      const tabId = Math.random().toString(36).slice(2)
      const tick = () => channelRef.current?.post({ type: 'alive', tabId })
      tick()
      const iv = window.setInterval(tick, HEARTBEAT_MS)
      const onUnload = () => channelRef.current?.post({ type: 'gone', tabId })
      window.addEventListener('beforeunload', onUnload)
      return () => {
        window.clearInterval(iv)
        window.removeEventListener('beforeunload', onUnload)
        onUnload()
      }
    }
    // Main: poll the lastSeen flag, flip alive→false when stale.
    const iv = window.setInterval(() => {
      if (lastPeerSeenAt.current === 0) return
      if (Date.now() - lastPeerSeenAt.current > PEER_TIMEOUT_MS) {
        lastPeerSeenAt.current = 0
        setState((s) => (s.fullscreenAlive ? { ...s, fullscreenAlive: false } : s))
      }
    }, HEARTBEAT_MS)
    return () => window.clearInterval(iv)
  }, [role])

  const update = useCallback(
    (draft: Omit<CanvasDraft, 'updatedAt'>) => {
      // Debounce localStorage write — ms-level edits would otherwise
      // serialise the entire scene many times per second.
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
      debounceRef.current = window.setTimeout(() => {
        const result = saveCanvasDraft(attemptId, draft)
        if (result === 'quota') {
          // Quota exhausted → fall back to Redis. Best-effort, errors
          // are swallowed (autosave is non-critical, Submit is the real
          // safety net). Mark the quota flag so the UI shows a reduced-
          // protection hint instead of a full "выкл" warning.
          void api(`/mock/attempts/${attemptId}/canvas-draft`, {
            method: 'PUT',
            body: JSON.stringify({
              scene_json: draft.sceneJSON,
              non_functional_md: draft.nonFunctionalMD,
              context_md: draft.contextMD,
            }),
            headers: { 'Content-Type': 'application/json' },
          }).catch(() => {})
        }
        setState((s) => {
          const quota = result === 'quota'
          return s.quotaExceeded === quota ? s : { ...s, quotaExceeded: quota }
        })
      }, SAVE_DEBOUNCE_MS)
      // Broadcast immediately — peer tab shouldn't wait for the debounce.
      channelRef.current?.post({
        type: 'draft',
        payload: { ...draft, updatedAt: Date.now() },
      })
    },
    [attemptId],
  )

  const notifySubmitted = useCallback(() => {
    channelRef.current?.post({ type: 'submitted' })
    // Drop both layers of persistence — the canonical record now lives
    // in pipeline_attempts. Best-effort on the Redis side (server already
    // does this on submit success, but a duplicate DEL is cheap).
    clearCanvasDraft(attemptId)
    void api(`/mock/attempts/${attemptId}/canvas-draft`, { method: 'DELETE' }).catch(() => {})
  }, [attemptId])

  const onSubmittedFromMain = useCallback((handler: () => void) => {
    submittedHandlersRef.current.add(handler)
    return () => {
      submittedHandlersRef.current.delete(handler)
    }
  }, [])

  return { state, update, notifySubmitted, onSubmittedFromMain }
}
