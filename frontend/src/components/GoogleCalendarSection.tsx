// GoogleCalendarSection — Stream E Settings surface. Two states:
//   1. Disconnected → «Подключить Google Calendar» CTA. Opens auth URL в
//      новом окне; callback page завершает OAuth и инвалидирует status.
//   2. Connected → calendar_id + last_synced + Sync / Disconnect actions.
//
// Frontend mounts this в Settings → Integrations tab (или Profile tab —
// зависит от текущего IA). Component standalone: можно paste anywhere.

import { Loader2, RefreshCcw, Unplug, Link as LinkIcon, CheckCircle2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  useConnectionStatusQuery,
  useDisconnectMutation,
  useStartOAuthMutation,
  useSyncEventsMutation,
} from '../lib/queries/googleCalendar'

const STORAGE_STATE_KEY = 'gcal_oauth_state'
const STORAGE_REDIRECT_KEY = 'gcal_oauth_redirect_uri'

function buildRedirectURI(): string {
  if (typeof window === 'undefined') return ''
  const origin = window.location.origin
  return `${origin}/auth/google-calendar-callback`
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'ещё не синхронизировано'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diffSec < 60) return 'только что'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} мин назад`
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)} ч назад`
  return d.toLocaleString()
}

export function GoogleCalendarSection() {
  const status = useConnectionStatusQuery()
  const startOAuth = useStartOAuthMutation()
  const disconnect = useDisconnectMutation()
  const sync = useSyncEventsMutation()
  const [error, setError] = useState<string | null>(null)

  // Clean up stale state if user navigated away from callback flow.
  useEffect(() => {
    if (!startOAuth.isPending && !startOAuth.isError) return
  }, [startOAuth.isPending, startOAuth.isError])

  const onConnect = async () => {
    setError(null)
    const redirectURI = buildRedirectURI()
    try {
      const out = await startOAuth.mutateAsync(redirectURI)
      sessionStorage.setItem(STORAGE_STATE_KEY, out.state)
      sessionStorage.setItem(STORAGE_REDIRECT_KEY, redirectURI)
      // Открываем в новом окне, чтобы текущая SPA-страница оставалась live
      // для callback'а post-completion (callback страница может закрыть окно
      // или редиректнуть). Если popup заблокирован — fallback на same-window.
      const w = window.open(out.auth_url, 'gcal_oauth', 'width=520,height=720')
      if (!w) {
        window.location.href = out.auth_url
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось начать подключение')
    }
  }

  const onDisconnect = async () => {
    setError(null)
    try {
      await disconnect.mutateAsync()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отключить')
    }
  }

  const onSync = async () => {
    setError(null)
    try {
      await sync.mutateAsync()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось синхронизировать')
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface-1 p-5">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          integrations
        </span>
        <h2 className="font-display text-base font-bold leading-tight">Google Calendar</h2>
        <p className="text-[12.5px] leading-relaxed text-text-muted">
          Двусторонняя синхронизация: подтянем встречи и собеседования из Google в Hone Calendar,
          и сможем класть мок-интервью / план-сессии обратно. Pull-обновление раз в 5 минут.
        </p>
      </header>

      {status.isLoading ? (
        <div className="flex items-center gap-2 text-[12.5px] text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Проверяем подключение…
        </div>
      ) : status.data?.connected ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px]">
            <CheckCircle2 className="h-4 w-4 text-text-primary" />
            <span className="font-mono">{status.data.calendar_id || 'primary'}</span>
            <span className="text-text-muted">·</span>
            <span className="text-text-muted">синхронизировано: {formatRelative(status.data.last_synced)}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSync}
              disabled={sync.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] font-semibold text-text-primary transition-colors hover:border-border-strong disabled:opacity-60"
            >
              {sync.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="h-3.5 w-3.5" />
              )}
              Синхронизировать сейчас
            </button>
            <button
              type="button"
              onClick={onDisconnect}
              disabled={disconnect.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[12px] font-semibold text-text-secondary transition-colors hover:text-text-primary hover:border-border-strong disabled:opacity-60"
            >
              {disconnect.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Unplug className="h-3.5 w-3.5" />
              )}
              Отключить
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={startOAuth.isPending}
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] font-semibold text-text-primary transition-colors hover:border-border-strong disabled:opacity-60"
        >
          {startOAuth.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <LinkIcon className="h-3.5 w-3.5" />
          )}
          Подключить Google Calendar
        </button>
      )}

      {(error || status.isError) && (
        <p role="alert" aria-live="assertive" className="text-[12px] text-text-secondary">
          {error ?? (status.error instanceof Error ? status.error.message : 'Ошибка чтения статуса')}
        </p>
      )}
    </section>
  )
}

// Constants exported so the callback page reads exact same storage keys.
export const GCAL_OAUTH_STATE_KEY = STORAGE_STATE_KEY
export const GCAL_OAUTH_REDIRECT_KEY = STORAGE_REDIRECT_KEY
