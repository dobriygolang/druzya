// InstallHoneCTA — Phase J / X1 (P0) "Install Hone" step on /all-set.
//
// Sits between the "Запусти первый mock" card and the ghost-pill links.
// B/W only. Hairline border, apple icon, ghost dismiss link. The CTA
// opens the DMG download URL — actual binary is hosted on the GitHub
// release CDN linked from DRUZ9_DESKTOP_DOWNLOAD_URL.
//
// Behaviour:
//   - First visit on /all-set → visible.
//   - User clicks "Skip" or downloads → localStorage flag set.
//   - Returning to /all-set after that → hidden.
//   - User installs Hone (heartbeat lands) → backend reports Hone in
//     getInstalledApps and the parent page can suppress this card on
//     subsequent renders. We don't gate on getInstalledApps here so the
//     card works pre-auth-confirm too.

import { useState } from 'react'
import { Download as DownloadIcon } from 'lucide-react'

const DISMISS_KEY = 'druz9:install-hone-cta:dismissed'
const DOWNLOAD_URL =
  (import.meta.env.VITE_DRUZ9_HONE_DOWNLOAD_URL as string | undefined)?.trim() ||
  'https://druz9.online/hone/download'

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function markDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* localStorage absent (private mode / quota full) — never throws */
  }
}

interface Props {
  /** When true, skip the dismiss-state check (forced render from Settings). */
  forceShow?: boolean
}

export function InstallHoneCTA({ forceShow = false }: Props) {
  const [dismissed, setDismissed] = useState(() => (forceShow ? false : wasDismissed()))
  if (dismissed) return null

  const handleInstall = () => {
    window.open(DOWNLOAD_URL, '_blank', 'noopener,noreferrer')
    markDismissed()
    setDismissed(true)
  }

  const handleSkip = () => {
    markDismissed()
    setDismissed(true)
  }

  return (
    <div
      className="flex-wrap-row"
      style={{
        width: '100%',
        maxWidth: 700,
        padding: '20px 24px',
        border: '1px solid var(--hair-2)',
        borderRadius: 'var(--radius-outer)',
        background: 'transparent',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
      }}
    >
      <div className="flex flex-col" style={{ minWidth: 0, gap: 6 }}>
        <span
          style={{
            fontSize: 'var(--type-h3-size)',
            lineHeight: 'var(--type-h3-lh)',
            letterSpacing: 'var(--type-h3-ls)',
            fontWeight: 'var(--type-h3-weight)',
            color: 'rgb(var(--ink))',
          }}
        >
          Установи Hone — daily focus
        </span>
        <span style={{ fontSize: 13, color: 'var(--ink-60)', lineHeight: 1.55 }}>
          Тихий desktop-кокпит: AI-план на день, фокус, заметки. Offline-first.
        </span>
      </div>
      <div className="flex flex-wrap-row" style={{ gap: 10, alignItems: 'center' }}>
        <button
          type="button"
          onClick={handleSkip}
          className="focus-ring"
          style={{
            background: 'transparent',
            border: 0,
            color: 'var(--ink-60)',
            fontSize: 12,
            cursor: 'pointer',
            padding: '6px 10px',
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Позже
        </button>
        <button
          type="button"
          onClick={handleInstall}
          className="focus-ring motion-press"
          style={{
            padding: '10px 22px',
            background: 'rgb(var(--ink))',
            color: 'rgb(var(--color-bg))',
            border: 0,
            borderRadius: 'var(--radius-inner)',
            fontSize: 14,
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            flex: '0 0 auto',
          }}
        >
          <DownloadIcon style={{ width: 14, height: 14 }} />
          Скачать для macOS
        </button>
      </div>
    </div>
  )
}
