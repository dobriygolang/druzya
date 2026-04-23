// MaintenanceOverlay — full-screen takeover for planned downtime
// (Wave-11 global error UI).
//
// Triggers when GET /api/v1/system/maintenance returns a non-empty
// window. Until that endpoint exists, this component is mounted with
// `active=false` and renders nothing — wire-and-forget.
//
// Anti-fallback: NEVER renders cute robots / "we'll be back soon!"
// stock-character. Geometric shapes + honest countdown only, per
// _rules.md anti-pattern list.
//
// API:
//   <MaintenanceOverlay
//     active={true}
//     startsAt={Date}
//     endsAt={Date}
//     message="Релиз 14:00–14:30 МСК. Зашли пораньше?"
//   />

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Wrench, ExternalLink } from 'lucide-react'

export type MaintenanceOverlayProps = {
  active: boolean
  startsAt?: Date
  endsAt?: Date
  /** Honest single-line copy explaining what's happening. */
  message?: string
}

export function MaintenanceOverlay({ active, startsAt, endsAt, message }: MaintenanceOverlayProps) {
  const { t } = useTranslation('wave10')
  const [now, setNow] = useState<Date>(new Date())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [active])

  if (!active) return null

  // Determine phase: "starts in N" / "ends in N" / "active".
  let label: string
  let countdown: string
  if (startsAt && now < startsAt) {
    label = t('globalError.maintenance.startsIn')
    countdown = formatCountdown(startsAt.getTime() - now.getTime())
  } else if (endsAt && now < endsAt) {
    label = t('globalError.maintenance.endsIn')
    countdown = formatCountdown(endsAt.getTime() - now.getTime())
  } else {
    label = t('globalError.maintenance.active')
    countdown = '—'
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-bg p-6"
    >
      <div className="max-w-[480px] text-center">
        {/* Geometric icon — anti-pattern compliance: no characters */}
        <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl border border-warn/40 bg-warn/10">
          <Wrench className="h-7 w-7 text-warn" aria-hidden="true" />
        </div>

        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-warn mb-3">
          {t('globalError.maintenance.kicker')}
        </div>
        <h1 className="font-display text-2xl font-bold text-text-primary mb-3 sm:text-3xl">
          {t('globalError.maintenance.title')}
        </h1>
        {message && (
          <p className="text-[14px] text-text-secondary leading-relaxed mb-6 max-w-[400px] mx-auto">
            {message}
          </p>
        )}

        <div className="rounded-xl border border-border bg-surface-1 p-5 mb-6">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
            {label}
          </div>
          <div className="font-display text-3xl font-extrabold tabular-nums text-text-primary">
            {countdown}
          </div>
        </div>

        <a
          href="/status"
          className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-text-secondary hover:text-text-primary"
        >
          {t('globalError.statusLink')}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  )
}

// formatCountdown — "HH:MM:SS" up to 24h, then "Nд HH:MM" beyond.
function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00'
  const totalSec = Math.floor(ms / 1000)
  const days = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (days > 0) {
    return `${days}д ${pad(h)}:${pad(m)}`
  }
  if (h > 0) {
    return `${pad(h)}:${pad(m)}:${pad(s)}`
  }
  return `${pad(m)}:${pad(s)}`
}
