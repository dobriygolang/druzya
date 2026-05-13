// use-online — React hook over navigator.onLine + online/offline events.
//
// Mirrors frontend/src/hooks/useOnlineStatus.ts но в offline lib namespace —
// чтобы lingua-pages могли импортить только из @/lib/offline без знания о
// общем hooks/ слое. Behavior identical.

import { useEffect, useState } from 'react'

export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])
  return online
}
