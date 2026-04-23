// WSDisconnectChrome — persistent corner pill shown on live screens
// (arena/voice-mock) when their WebSocket has been disconnected for
// more than 30 seconds (Wave-11 global error UI).
//
// Why a separate component vs <DegradedBanner />:
//   - Sticky-top banner would cover the live editor, which is exactly
//     where the user is trying to focus.
//   - WS disconnects are usually transient (network dropout); a quiet
//     bottom-right pill with reconnect status is the correct affordance.
//   - On reconnect, the pill auto-dismisses with a 1-second "✓ снова в
//     сети" green flash, then disappears.
//
// API:
//   <WSDisconnectChrome status="disconnected" sinceMs={45_000} onRetry={...} />
//
// Caller owns the state machine; we just render. Typical caller:
//   const { status, sinceMs, retry } = useWebSocket(url);
//   return <>...{status === 'disconnected' && <WSDisconnectChrome status={status} sinceMs={sinceMs} onRetry={retry}/>}...</>;

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WifiOff, Wifi, RefreshCw } from 'lucide-react'
import { cn } from '../../lib/cn'

export type WSStatus = 'connected' | 'reconnecting' | 'disconnected'

export type WSDisconnectChromeProps = {
  status: WSStatus
  /** Milliseconds since the disconnect started — drives the "Nс назад"
   *  freshness label. Pass 0 for "just now". */
  sinceMs: number
  onRetry?: () => void
}

export function WSDisconnectChrome({ status, sinceMs, onRetry }: WSDisconnectChromeProps) {
  const { t } = useTranslation('wave10')
  // Track recent recovery so we can flash a 1-second green confirmation
  // before unmounting. Avoids the "blink and gone" problem.
  const [flashRecovery, setFlashRecovery] = useState(false)
  useEffect(() => {
    if (status === 'connected') {
      setFlashRecovery(true)
      const id = window.setTimeout(() => setFlashRecovery(false), 1200)
      return () => window.clearTimeout(id)
    }
  }, [status])

  // 30-second grace: don't shout about a disconnect that may resolve in
  // a couple of frames. Shown only after sustained outage.
  if (status === 'connected' && !flashRecovery) return null
  if (status !== 'connected' && sinceMs < 30_000) return null

  const isRecovered = status === 'connected' && flashRecovery
  const Icon = isRecovered ? Wifi : WifiOff

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full border px-3 py-2 shadow-card backdrop-blur',
        // Sit above MobileBottomNav (bottom-20 + safe-area for iPhones).
        'sm:bottom-4',
        isRecovered
          ? 'border-success/40 bg-success/15 text-success'
          : status === 'reconnecting'
            ? 'border-warn/40 bg-warn/15 text-warn'
            : 'border-danger/40 bg-danger/15 text-danger',
      )}
      style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="font-mono text-[11px] font-semibold uppercase tracking-wider">
        {isRecovered
          ? t('globalError.ws.recovered')
          : status === 'reconnecting'
            ? t('globalError.ws.reconnecting', { sec: Math.floor(sinceMs / 1000) })
            : t('globalError.ws.disconnected', { sec: Math.floor(sinceMs / 1000) })}
      </span>
      {!isRecovered && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="grid h-6 w-6 place-items-center rounded-md hover:bg-current/10"
          aria-label={t('globalError.ws.retry')}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
