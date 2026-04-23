// matchmaking.ts — global Zustand store for cross-page matchmaking state.
//
// User feedback (sanctum/arena bug): "При нажатии на кнопку мы не будем
// перенаправяляться в комнату и не будет создаваться комната, пока два
// игрока не найдутся. Условно мы сделаем также поиск как и на faceit ...
// при переходе на другую страницу поиск не сбрасывался."
//
// Architecture:
//   - State lives in a single Zustand store (NOT per-component) so it
//     survives navigation between /arena, /sanctum, /atlas, anywhere.
//   - Persisted to sessionStorage so a hard refresh doesn't lose the
//     queue ticket. Cleared on browser-tab close (sessionStorage scope)
//     because cross-tab queue would race with the backend's per-user
//     matchmaker which assumes one ticket per user.
//   - Drives <MatchmakingDock/> (UI affordance — floating pill on every
//     page) and <MatchmakingPoller/> (effect-only — polls backend +
//     auto-navigates ALL mounted clients to /arena/match/{id} when paired).
//
// Anti-fallback: when backend is unreachable the store surfaces an
// `error` string and keeps `inQueue=true` so the user sees "поиск
// прерван — повторить?" rather than silent abandonment.
//
// Scope: ONLY online PvP modes (ranked / casual_1v1 / duo_2v2). The
// other modes (mock pipeline, AI-allowed, pair editor, custom lobby)
// have different flows and don't go through this store.

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// Mirror the wire-form arena modes from lib/queries/arena.ts. Kept as a
// string union here to avoid a cross-module dep cycle (the store doesn't
// import the query file, only the page-level wirer does).
export type MatchmakingMode = 'solo_1v1' | 'duo_2v2' | 'ranked'
export type MatchmakingSection = string // SectionKey

export type MatchmakingState = {
  /** True while the user has an active queue ticket on the backend. */
  inQueue: boolean
  /** Current parameters of the search — replayed on cross-tab restore so
   *  the dock can show "Ranked · алгоритмы" while waiting. */
  mode: MatchmakingMode | null
  section: MatchmakingSection | null
  neuralModel: string
  /** Wall-clock timestamp (ms epoch) when the search began. The dock
   *  derives `elapsedSec` from `Date.now() - startedAt`, so refresh +
   *  cross-tab restore both keep ticking from the right second. */
  startedAt: number | null
  /** Last error message from the backend (cancel / find / poll). null
   *  when healthy. */
  error: string | null

  // ─── Actions ───
  start: (input: {
    mode: MatchmakingMode
    section: MatchmakingSection
    neuralModel: string
  }) => void
  setError: (msg: string | null) => void
  /** Local-only stop — used by the navigate-on-found effect. Does NOT
   *  send a cancel request to backend (caller already paired). */
  finishLocal: () => void
  /** Stop + clear, fired after a successful backend cancel. Used by the
   *  Dock's ✕ button + the auto-cancel timeout. */
  reset: () => void
}

export const useMatchmakingStore = create<MatchmakingState>()(
  persist(
    (set) => ({
      inQueue: false,
      mode: null,
      section: null,
      neuralModel: '',
      startedAt: null,
      error: null,

      start: ({ mode, section, neuralModel }) =>
        set({
          inQueue: true,
          mode,
          section,
          neuralModel,
          startedAt: Date.now(),
          error: null,
        }),

      setError: (msg) => set({ error: msg }),

      finishLocal: () =>
        set({
          inQueue: false,
          mode: null,
          section: null,
          neuralModel: '',
          startedAt: null,
          error: null,
        }),

      reset: () =>
        set({
          inQueue: false,
          mode: null,
          section: null,
          neuralModel: '',
          startedAt: null,
          error: null,
        }),
    }),
    {
      name: 'druz9.matchmaking',
      // sessionStorage so cross-tab queue races don't happen (backend
      // matchmaker keeps one ticket per user; spawning two browser tabs
      // searching simultaneously confused our queue dispatcher in the
      // production-bug pre-Wave-13). localStorage version is opt-in via
      // a future flag if we ever decide to support multi-tab.
      storage: createJSONStorage(() => sessionStorage),
      // Don't persist the transient `error` field — a hard refresh after
      // a network blip should re-evaluate from the live backend, not
      // leave a stale red dot on the dock.
      partialize: ({ error: _err, ...rest }) => rest,
    },
  ),
)

/** elapsedSec — pure derivation: how many seconds have passed since
 *  `startedAt`. Returns 0 when not in queue. Pure to make Dock testable. */
export function elapsedSec(startedAt: number | null, now: number = Date.now()): number {
  if (!startedAt) return 0
  return Math.max(0, Math.floor((now - startedAt) / 1000))
}
