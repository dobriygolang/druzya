// OfflineBanner — top-of-screen полоска когда navigator.onLine === false.
// Web mirror hone/.../OfflineBanner.tsx — те же визуальные правила.
import { useOnlineStatus } from '../hooks/useOnlineStatus'

export function OfflineBanner() {
  const online = useOnlineStatus()
  if (online) return null
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        padding: '6px 12px',
        textAlign: 'center',
        fontSize: 10.5,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: '#0f0f10',
        background: '#ffaa55',
        borderBottom: '1px solid rgba(0,0,0,0.15)',
        zIndex: 1000,
        pointerEvents: 'none',
        fontFamily: '"JetBrains Mono", monospace',
      }}
    >
      ● Offline · sharing &amp; sync paused until you reconnect
    </div>
  )
}
