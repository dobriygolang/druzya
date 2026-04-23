// MatchmakingPoller — invisible component mounted ONCE in AppShell that
// drives the cross-page matchmaking polling loop.
//
// Responsibilities (none of them visual):
//   1. While `inQueue=true`, poll /arena/match/current every 2s.
//   2. When a match comes back, navigate THIS browser tab to the match
//      page and clear the local queue state (server already moved the
//      ticket → match).
//   3. After QUEUE_TIMEOUT_SEC of waiting, auto-cancel server-side and
//      surface a friendly "никого нет в очереди" message via the store's
//      `error` field — the dock turns red, ArenaPage shows the same.
//
// Why a sibling component instead of inline-in-AppShell hooks: the
// useCurrentMatchQuery hook is gated by `enabled` — keeping it in its
// own component lets React Query's cache and abort controller behave
// predictably (mounting/unmounting cleanly toggles the polling).
//
// Anti-fallback: NEVER fakes a found-match. If the backend's
// /arena/match/current endpoint is unreachable, the error surfaces in
// the dock — we don't pretend to have paired the user with a bot.

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCurrentMatchQuery, useCancelSearchMutation } from '../../lib/queries/arena'
import { useMatchmakingStore } from '../../lib/store/matchmaking'

// Same constant Wave-12 ArenaPage used. Lifted here as the single source
// of truth so the dock + page agree on when to give up.
const QUEUE_TIMEOUT_SEC = 120

export function MatchmakingPoller() {
  const navigate = useNavigate()
  const inQueue = useMatchmakingStore((s) => s.inQueue)
  const startedAt = useMatchmakingStore((s) => s.startedAt)
  const finishLocal = useMatchmakingStore((s) => s.finishLocal)
  const setError = useMatchmakingStore((s) => s.setError)
  const reset = useMatchmakingStore((s) => s.reset)
  const cancelSearch = useCancelSearchMutation()

  // Polling — useCurrentMatchQuery already polls when enabled; we just
  // gate it on the store's inQueue.
  const currentMatch = useCurrentMatchQuery(inQueue)

  // Navigate-on-found. Refs guard against double-navigation if the
  // effect re-fires while the navigate is still pending.
  const navigatedRef = useRef(false)
  useEffect(() => {
    if (!inQueue) {
      navigatedRef.current = false
      return
    }
    const m = currentMatch.data
    if (!m?.match_id || navigatedRef.current) return
    navigatedRef.current = true
    const path =
      m.mode === 'duo_2v2' ? `/arena/2v2/${m.match_id}` : `/arena/match/${m.match_id}`
    finishLocal()
    navigate(path)
  }, [inQueue, currentMatch.data, navigate, finishLocal])

  // Auto-timeout. Uses startedAt instead of a setInterval counter so
  // tab-throttled / backgrounded browsers don't accumulate drift.
  useEffect(() => {
    if (!inQueue || !startedAt) return
    const id = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAt
      if (elapsedMs >= QUEUE_TIMEOUT_SEC * 1000) {
        cancelSearch.mutate(undefined, {
          onSettled: () => {
            reset()
            setError(
              'В очереди сейчас никого нет. Попробуй другой раздел или повтори позже.',
            )
          },
        })
      }
    }, 2_000)
    return () => window.clearInterval(id)
    // cancelSearch + reset + setError are stable; only inQueue + startedAt drive re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inQueue, startedAt])

  return null
}
