// InstallPwaPrompt — once-dismissable «add to home screen» pill.
//
// Listens `beforeinstallprompt` event (fires in Chromium-based browsers when
// PWA install criteria met). Сохраняем deferred event и показываем subtle pill
// в bottom-right. Tap → prompt.prompt() → user choice → cleanup.
//
// Dismiss flow:
//   - tap dismiss (×) → localStorage.setItem('pwa_install_prompt_dismissed', '1')
//   - pill больше не показывается до тех пор пока storage не очистится
//     (clear-site-data или dev tools).
//
// iOS Safari не fires beforeinstallprompt — там install via Share menu.
// Не показываем prompt на iOS вообще: criteria.matches('(display-mode:
// standalone)') === false плюс отсутствие event = nothing to do.

import { useEffect, useState } from 'react'

const DISMISS_KEY = 'pwa_install_prompt_dismissed'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export function InstallPwaPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (dismissed) return

    const handler = (e: Event) => {
      // Prevent Chromium's mini-info-bar — мы render'им свой UI.
      e.preventDefault()
      setEvt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)

    const onInstalled = () => {
      // App installed — pill больше не нужен.
      setEvt(null)
      try {
        localStorage.setItem(DISMISS_KEY, '1')
      } catch {
        /* noop */
      }
    }
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [dismissed])

  const install = async () => {
    if (!evt) return
    try {
      await evt.prompt()
      await evt.userChoice
    } catch {
      /* user agent threw — silently abort */
    }
    // Один раз: deferred event одноразовый.
    setEvt(null)
  }

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* noop */
    }
    setDismissed(true)
    setEvt(null)
  }

  if (!evt || dismissed) return null

  return (
    <div
      role="dialog"
      aria-label="Install druz9"
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px 8px 14px',
        background: '#0A0A0F',
        border: '1px solid rgba(255,255,255,0.16)',
        borderRadius: 999,
        fontFamily: '"Inter", system-ui, sans-serif',
        fontSize: 12,
        color: '#ffffff',
        zIndex: 999,
        boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
      }}
    >
      <span style={{ letterSpacing: '0.02em' }}>Install Lingua for offline review</span>
      <button
        type="button"
        onClick={install}
        style={{
          padding: '4px 10px',
          background: '#ffffff',
          color: '#000000',
          border: 'none',
          borderRadius: 999,
          fontWeight: 600,
          fontSize: 11,
          cursor: 'pointer',
          letterSpacing: '0.02em',
        }}
      >
        Install
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        style={{
          width: 22,
          height: 22,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          color: 'rgba(255,255,255,0.6)',
          border: 'none',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )
}
