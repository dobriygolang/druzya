// GoogleCalendarCallback — receives ?code & ?state after Google's consent
// screen redirects back here. Validates state nonce stashed in sessionStorage
// during StartOAuth → POSTs to /google_calendar/oauth/callback → on success
// redirects to /profile/settings.
//
// If opened in a popup (the default UX from GoogleCalendarSection), the
// page closes itself once tokens are persisted server-side; the parent
// window re-invalidates `useConnectionStatusQuery` via storage event below.

import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

import { completeOAuth } from '../../lib/queries/googleCalendar'
import {
  GCAL_OAUTH_REDIRECT_KEY,
  GCAL_OAUTH_STATE_KEY,
} from '../../components/GoogleCalendarSection'

const COMPLETE_BROADCAST_KEY = 'gcal_oauth_completed_at'

export default function GoogleCalendarCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code = params.get('code')
    const state = params.get('state')
    const errParam = params.get('error')
    if (errParam) {
      setError(`Google отказал в доступе: ${errParam}`)
      return
    }
    if (!code || !state) {
      setError('В ответе нет code/state.')
      return
    }
    const expected = sessionStorage.getItem(GCAL_OAUTH_STATE_KEY)
    if (expected && expected !== state) {
      setError('CSRF state mismatch — попробуй ещё раз.')
      return
    }
    const redirectURI =
      sessionStorage.getItem(GCAL_OAUTH_REDIRECT_KEY) ??
      `${window.location.origin}/auth/google-calendar-callback`

    let cancelled = false
    void (async () => {
      try {
        await completeOAuth({ code, state, redirect_uri: redirectURI })
        if (cancelled) return
        sessionStorage.removeItem(GCAL_OAUTH_STATE_KEY)
        sessionStorage.removeItem(GCAL_OAUTH_REDIRECT_KEY)
        // Tell the spawning window the flow completed so it can invalidate
        // its react-query cache without polling. Storage events fire across
        // tabs/windows of the same origin.
        try {
          localStorage.setItem(COMPLETE_BROADCAST_KEY, String(Date.now()))
          localStorage.removeItem(COMPLETE_BROADCAST_KEY)
        } catch {
          /* private mode — ignore */
        }
        // If we are в popup, закроемся; иначе редиректим к настройкам.
        if (window.opener && window.opener !== window) {
          window.close()
          return
        }
        navigate('/profile/settings?tab=integrations', { replace: true })
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Не удалось завершить подключение')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [params, navigate])

  return (
    <div className="grid min-h-screen place-items-center bg-bg text-text-primary">
      <div className="flex max-w-md flex-col items-center gap-4 px-4 text-center">
        {error ? (
          <>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              google calendar
            </div>
            <h1 className="font-display text-2xl font-bold">Подключение не удалось</h1>
            <p className="text-[14px] text-text-muted">{error}</p>
            <Link
              to="/profile/settings?tab=integrations"
              className="mt-2 inline-flex h-10 items-center justify-center rounded-lg border border-border bg-surface-1 px-4 text-[14px] font-medium tracking-[0.08em] text-text-primary transition-colors hover:bg-surface-2"
            >
              Назад к настройкам
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-text-secondary" />
            <p className="text-[14px] tracking-[0.08em] text-text-muted">
              Связываем твой Google Calendar…
            </p>
          </>
        )}
      </div>
    </div>
  )
}
