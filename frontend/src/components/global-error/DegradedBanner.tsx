// DegradedBanner — sticky top notice when at least one critical service
// is down (Wave-11 global error UI).
//
// Triggers per the design-review #6 spec:
//   - Listens to a tiny in-process bus (degradedBus) that the apiClient
//     pushes scope+reason events into when a critical query fails 5xx
//     more than N times in M seconds.
//   - Renders honest copy: "⚠ {scope} недоступен · мы смотрим. Остальное
//     работает."
//   - Auto-dismisses when the same scope flips healthy.
//
// Anti-fallback: if NO scopes are degraded, the banner renders nothing.
// We never show a stale red bar after recovery.
//
// Status link → /status (we don't ship status.druz9.online subdomain yet,
// the route alias resolves to a placeholder StatusPage). When the real
// uptime page lands, swap the href in one place.

import { useEffect, useState } from 'react'
import { AlertTriangle, X, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { degradedBus, type DegradedScope } from './degradedBus'
import { cn } from '../../lib/cn'

export function DegradedBanner() {
  const { t } = useTranslation('wave10')
  const [scopes, setScopes] = useState<Map<DegradedScope, string>>(new Map())
  const [dismissed, setDismissed] = useState<Set<DegradedScope>>(new Set())

  useEffect(() => {
    const off = degradedBus.subscribe((evt) => {
      setScopes((prev) => {
        const next = new Map(prev)
        if (evt.kind === 'degraded') {
          next.set(evt.scope, evt.reason)
        } else {
          next.delete(evt.scope)
          // also clear dismissal so a future degrade re-shows
          setDismissed((prevD) => {
            if (!prevD.has(evt.scope)) return prevD
            const nd = new Set(prevD)
            nd.delete(evt.scope)
            return nd
          })
        }
        return next
      })
    })
    return off
  }, [])

  // Render the most recent un-dismissed scope. Stack semantics
  // intentionally avoided — multiple stacked banners create a wall of
  // red and obscure the page below.
  const visible = Array.from(scopes.entries()).filter(([s]) => !dismissed.has(s))
  if (visible.length === 0) return null
  const [scope, reason] = visible[visible.length - 1]

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'sticky top-0 z-50 flex items-center gap-3 border-b border-warn/40 bg-warn/15 px-4 py-2.5',
        'sm:px-6',
      )}
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />
      <div className="flex-1 min-w-0 text-[13px] text-text-primary">
        <strong className="font-mono uppercase text-[11px] tracking-wider text-warn mr-2">
          {t('globalError.degraded.label')}
        </strong>
        <span className="font-medium">{scope}</span>
        <span className="text-text-secondary"> · {reason}</span>
      </div>
      <a
        href="/status"
        className="inline-flex items-center gap-1 text-[12px] font-mono uppercase tracking-wider text-text-secondary hover:text-text-primary"
      >
        {t('globalError.statusLink')}
        <ExternalLink className="h-3 w-3" />
      </a>
      <button
        type="button"
        onClick={() => setDismissed((d) => new Set(d).add(scope))}
        className="grid h-6 w-6 place-items-center rounded-md text-text-muted hover:bg-warn/20 hover:text-text-primary"
        aria-label={t('globalError.dismiss')}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
