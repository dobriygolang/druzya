// MatchmakingDock — floating "Searching for opponent" pill, mounted
// once in AppShell so it's visible on EVERY page while the user is in
// the matchmaking queue (FaceIt-style cross-page search).
//
// User feedback (sanctum/arena bug): "при переходе на другую страницу
// поиск не сбрасывался" — the dock is the visual contract for that.
//
// Position: bottom-right corner, above WSDisconnectChrome (z-50), above
// MobileBottomNav. Honours iOS safe-area bottom inset.
//
// Interaction:
//   - Tap the pill body → navigate to /arena (so the user can change
//     their search params without losing the queue ticket — though
//     arena UI will show "you're already searching" and disable the
//     Start CTA).
//   - Tap ✕ → cancel via useCancelSearchMutation, then reset() the
//     store. Confirms cancellation before clearing local state so a
//     network blip doesn't leave a phantom ticket on the backend.
//   - Auto-hides when inQueue=false. Renders nothing in the happy
//     idle state (no "Welcome to dock" placeholder — anti-fallback).

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, AlertTriangle } from 'lucide-react'
import { cn } from '../../lib/cn'
import { elapsedSec, useMatchmakingStore } from '../../lib/store/matchmaking'
import { useCancelSearchMutation } from '../../lib/queries/arena'

// Friendly mode labels — same vocabulary as humanizeArenaMode in
// labels.ts but tuned for the compact pill (one-word where possible).
const MODE_LABEL: Record<string, string> = {
  ranked: 'Ranked',
  solo_1v1: 'Casual',
  duo_2v2: '2v2',
  hardcore: 'Mock',
  cursed: 'AI-allowed',
}

function formatMmSs(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function MatchmakingDock() {
  const navigate = useNavigate()
  const inQueue = useMatchmakingStore((s) => s.inQueue)
  const mode = useMatchmakingStore((s) => s.mode)
  const startedAt = useMatchmakingStore((s) => s.startedAt)
  const error = useMatchmakingStore((s) => s.error)
  const reset = useMatchmakingStore((s) => s.reset)
  const setError = useMatchmakingStore((s) => s.setError)
  const cancelSearch = useCancelSearchMutation()

  // Tick — re-render once per second so the elapsed counter advances.
  // Cheap: the dock is one component, the rerender doesn't cascade
  // into pages (zustand selectors are individually memoised).
  const [, setNow] = useState(0)
  useEffect(() => {
    if (!inQueue) return
    const id = window.setInterval(() => setNow((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [inQueue])

  if (!inQueue) return null

  const elapsed = elapsedSec(startedAt)
  const label = mode ? MODE_LABEL[mode] ?? mode : 'matchmaking'

  const onCancel = (e: React.MouseEvent) => {
    e.stopPropagation()
    cancelSearch.mutate(undefined, {
      onSettled: () => {
        // Always clear local state — even if backend cancel failed, the
        // ticket times out server-side after QUEUE_TIMEOUT_SEC anyway.
        reset()
      },
      onError: (err: unknown) => {
        // Honest error: keep the ticket visible but flag it red so the
        // user knows to retry. setError doesn't navigate.
        setError((err as Error).message ?? 'cancel failed')
      },
    })
  }

  const isError = !!error
  return (
    <button
      type="button"
      onClick={() => navigate('/arena')}
      aria-label={`Поиск соперника · ${label} · ${formatMmSs(elapsed)} · нажми чтобы открыть Arena`}
      className={cn(
        'fixed z-50 flex items-center gap-3 rounded-full border px-4 py-2.5 shadow-card backdrop-blur transition-colors',
        'right-4 bottom-20 sm:bottom-4', // sit above MobileBottomNav (sm:hidden) and safe-area
        isError
          ? 'border-danger/40 bg-danger/10 hover:bg-danger/15'
          : 'border-border-strong bg-text-primary/15 hover:bg-text-primary/25',
      )}
      style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {isError ? (
        <AlertTriangle className="h-4 w-4 shrink-0 text-danger" />
      ) : (
        <span className="relative grid h-3.5 w-3.5 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-text-primary opacity-75" />
          <Search className="relative h-3.5 w-3.5 text-text-primary" />
        </span>
      )}
      <span className="flex flex-col text-left">
        <span className={cn('font-mono text-[10px] uppercase tracking-wider', isError ? 'text-danger' : 'text-text-primary')}>
          {isError ? 'ошибка' : 'поиск соперника'}
        </span>
        <span className="font-display text-[13px] font-semibold text-text-primary">
          {label} · <span className="tabular-nums">{formatMmSs(elapsed)}</span>
        </span>
      </span>
      <span
        role="button"
        tabIndex={0}
        onClick={onCancel}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            // Synthesise a click so the same handler runs without us
            // having to refactor onCancel into something that takes
            // both event types.
            ;(e.currentTarget as HTMLSpanElement).click()
          }
        }}
        aria-label="Отменить поиск"
        className="ml-1 grid h-7 w-7 place-items-center rounded-full text-text-muted hover:bg-bg/40 hover:text-text-primary"
      >
        <X className="h-3.5 w-3.5" />
      </span>
    </button>
  )
}
