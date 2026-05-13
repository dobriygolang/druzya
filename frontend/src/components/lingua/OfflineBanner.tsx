// OfflineBanner (lingua) — subtle B/W hairline indicator для /lingua surface.
//
// Отличия от глобального components/OfflineBanner.tsx:
//   - чёрно-белый (без #FF3B30 background — это нарушение color-rule);
//   - тонкий 1.5px stripe сверху + tiny status pill снизу-справа;
//   - explicitly Lingua-aware: упоминает vocab review + outbox count.
//
// Color rule (Sergey 2026-05-04): #FF3B30 — точка-индикатор / 1.5px stripe /
// single SVG stroke. Никогда в bg/fill/gradient. Здесь используем тонкий 1.5px
// горизонтальный stripe вверху на чёрном — это допустимое использование.
// Текст pill'а — белый на #0A0A0F (B/W).

import { useEffect, useState } from 'react'

import { getOutboxCount, useOnline } from '../../lib/offline'

interface OfflineBannerProps {
  /** Если passed — bypass useOnline() (для тестов / story-режима). */
  forceOffline?: boolean
}

export function OfflineBanner({ forceOffline }: OfflineBannerProps) {
  const onlineLive = useOnline()
  const online = forceOffline === undefined ? onlineLive : !forceOffline
  const [pending, setPending] = useState<number>(0)

  // Lightweight polling — каждые 5s обновляем outbox-counter пока offline.
  // Online — обновляемся один раз (после flush counter обычно = 0).
  useEffect(() => {
    let cancelled = false
    const tick = () => {
      getOutboxCount()
        .then((n) => {
          if (!cancelled) setPending(n)
        })
        .catch(() => {
          /* IDB unavailable — ничего не показываем */
        })
    }
    tick()
    if (online) return () => {
      cancelled = true
    }
    const handle = window.setInterval(tick, 5000)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [online])

  if (online && pending === 0) return null

  return (
    <>
      {!online && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: 1.5,
            background: '#FF3B30',
            zIndex: 1000,
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          bottom: 12,
          right: 12,
          padding: '6px 10px',
          fontSize: 10.5,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#ffffff',
          background: '#0A0A0F',
          border: '1px solid rgba(255,255,255,0.16)',
          borderRadius: 999,
          fontFamily: '"JetBrains Mono", monospace',
          zIndex: 1000,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {online ? (
          <>Syncing · {pending} pending</>
        ) : pending > 0 ? (
          <>Offline · {pending} queued</>
        ) : (
          <>Offline · vocab only</>
        )}
      </div>
    </>
  )
}
