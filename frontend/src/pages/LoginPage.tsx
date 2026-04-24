// LoginPage — единая точка входа/регистрации.
//
// Контекст (см. требования redesign):
//   * Yandex: тот же authorize-URL → /auth/callback/yandex (как раньше).
//   * Telegram: НЕ Login Widget (был «Bot domain invalid» на dev-домене), а
//     deep-link + код. Бэк генерит 8-символьный код, кладёт в Redis с TTL,
//     и поллим `/auth/telegram/poll` пока Telegram-бот не пометит код как
//     подтверждённый. См. backend/services/auth/ports/code_flow.go.
//
// После успешной авторизации (и Telegram, и Yandex):
//   - access_token → localStorage (ключ druz9_access_token, тот же что
//     читает /lib/apiClient.ts);
//   - refresh-токен — HttpOnly cookie, ставится бэком;
//   - редирект:
//       is_new_user === true  → /onboarding (туториал без auth-форм)
//       is_new_user === false → / (Sanctum)
//     Для Yandex флаг is_new_user сейчас не возвращается — фронт делает
//     fallback на /sanctum (см. AuthCallbackYandexPage).
//
// Email/пароль удалены ещё в Phase 2.

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Loader2, Send, X, Copy, ExternalLink, CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  pollTelegramAuth,
  startTelegramAuth,
  persistAuthTokens,
  type TelegramStartResponse,
} from '../lib/queries/auth'

const YANDEX_CLIENT_ID = import.meta.env.VITE_YANDEX_CLIENT_ID as string | undefined
const POLL_INTERVAL_MS = 2000
const yandexRedirectURI = () => `${window.location.origin}/auth/callback/yandex`
const DESKTOP_RETURN_KEY = 'desktop_return_url'

// Разрешённые префиксы для desktop-return. Страхует от XSS-injection'а
// через ?desktop=javascript:... — хоть open-url и не выполнит, всё
// равно whitelist'им явно известные схемы.
const ALLOWED_DESKTOP_SCHEMES = ['druz9://']

function sanitizeDesktopReturn(raw: string | null): string | null {
  if (!raw) return null
  return ALLOWED_DESKTOP_SCHEMES.some((s) => raw.startsWith(s)) ? raw : null
}

/**
 * Если пользователь пришёл на /login?desktop=druz9://auth из hone-desktop'а,
 * после успешного persist'а токенов мы редиректим браузер в
 * `druz9://auth?token=...` — OS доставит URL приложению через
 * protocol-handler.
 *
 * Возвращает true когда redirect произошёл — callback'и тогда НЕ делают
 * обычный navigate('/sanctum').
 */
export function maybeRedirectToDesktop(tokens: {
  access_token: string
  refresh_token?: string | null
  user_id?: string
  expires_in?: number
}): boolean {
  const ret = sanitizeDesktopReturn(sessionStorage.getItem(DESKTOP_RETURN_KEY))
  if (!ret) return false
  sessionStorage.removeItem(DESKTOP_RETURN_KEY)
  const u = new URL(ret)
  u.searchParams.set('token', tokens.access_token)
  if (tokens.refresh_token) u.searchParams.set('refresh', tokens.refresh_token)
  if (tokens.user_id) u.searchParams.set('user', tokens.user_id)
  if (tokens.expires_in) {
    u.searchParams.set('exp', String(Date.now() + tokens.expires_in * 1000))
  }
  window.location.href = u.toString()
  return true
}

function buildYandexAuthorizeURL(): string | null {
  if (!YANDEX_CLIENT_ID) return null
  const state = crypto.randomUUID()
  sessionStorage.setItem('oauth_state_yandex', state)
  const u = new URL('https://oauth.yandex.ru/authorize')
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', YANDEX_CLIENT_ID)
  u.searchParams.set('redirect_uri', yandexRedirectURI())
  u.searchParams.set('state', state)
  return u.toString()
}

export default function LoginPage() {
  const { t } = useTranslation('welcome')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const nextHref = params.get('next') ?? '/sanctum'
  // ?reason=expired — выставляется apiClient'ом после неудачного refresh,
  // чтобы пользователь увидел осмысленное сообщение, а не «просто кинуло
  // на логин».
  const sessionExpired = params.get('reason') === 'expired'
  const [error, setError] = useState<string | null>(
    sessionExpired ? 'Сессия истекла, переавторизуйтесь.' : null,
  )
  const [tgFlow, setTgFlow] = useState<TelegramStartResponse | null>(null)
  const [tgPolling, setTgPolling] = useState(false)
  const [tgStarting, setTgStarting] = useState(false)
  const pollTimer = useRef<number | null>(null)

  useEffect(() => {
    document.body.classList.add('v2')
    return () => document.body.classList.remove('v2')
  }, [])

  // Desktop-return flow: если нас открыл Hone-desktop с ?desktop=druz9://auth,
  // кладём return-URL в sessionStorage — после OAuth callback'а его прочитает
  // maybeRedirectToDesktop() и отправит в druz9:// вместо /sanctum.
  useEffect(() => {
    const ret = sanitizeDesktopReturn(params.get('desktop'))
    if (ret) {
      sessionStorage.setItem(DESKTOP_RETURN_KEY, ret)
    }
  }, [params])

  // Cleanup polling on unmount.
  useEffect(() => () => stopPolling(), [])

  function stopPolling() {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
    setTgPolling(false)
  }

  async function pollLoop(code: string) {
    setTgPolling(true)
    const tick = async () => {
      const result = await pollTelegramAuth(code)
      if (result.kind === 'pending') {
        pollTimer.current = window.setTimeout(tick, POLL_INTERVAL_MS)
        return
      }
      stopPolling()
      if (result.kind === 'ok') {
        persistAuthTokens({
          access_token: result.access_token,
          refresh_token: result.refresh_token,
          expires_in: result.expires_in,
        })
        if (
          maybeRedirectToDesktop({
            access_token: result.access_token,
            refresh_token: result.refresh_token,
            user_id: result.user?.id,
            expires_in: result.expires_in,
          })
        ) {
          return
        }
        const dest = result.is_new_user ? '/onboarding' : nextHref
        navigate(dest, { replace: true })
        return
      }
      if (result.kind === 'expired') {
        setError('Код истёк. Попробуй ещё раз.')
        setTgFlow(null)
        return
      }
      if (result.kind === 'rate_limited') {
        setError(`Слишком часто опрашиваем. Подожди ${result.retry_after}с.`)
        return
      }
      setError(result.message || 'Не удалось проверить код.')
    }
    pollTimer.current = window.setTimeout(tick, POLL_INTERVAL_MS)
  }

  async function handleTelegramClick() {
    setError(null)
    setTgStarting(true)
    try {
      const res = await startTelegramAuth()
      setTgFlow(res)
      // Open the bot in a new tab — most users have the Telegram app installed
      // and the t.me link will deep-link them straight to /start <code>.
      window.open(res.deep_link, '_blank', 'noopener,noreferrer')
      void pollLoop(res.code)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`Не удалось запустить вход через Telegram: ${msg}`)
    } finally {
      setTgStarting(false)
    }
  }

  function handleCancelTelegram() {
    stopPolling()
    setTgFlow(null)
    setError(null)
  }

  async function handleCopyCode() {
    if (!tgFlow) return
    try {
      await navigator.clipboard.writeText(tgFlow.code)
    } catch {
      /* clipboard blocked — модалка всё равно показывает код. */
    }
  }

  const yandexHref = buildYandexAuthorizeURL()

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <header className="flex h-[72px] items-center justify-between border-b border-border bg-bg px-4 sm:px-8 lg:px-20">
        <Link to="/welcome" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-lg font-extrabold text-text-primary">
            9
          </span>
          <span className="font-display text-lg font-bold text-text-primary">druz9</span>
        </Link>
        <Link to="/welcome" className="text-sm font-medium text-text-muted hover:text-text-secondary">
          {t('start')}
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-[420px] flex-col gap-8 px-4 py-12 sm:py-16">
        {/* Раньше "Войти / Зарегистрироваться" перетекало в 3 строки на узких
            экранах: длинное слово + слэш ломали wrap. Используем компактный
            заголовок на mobile и полный — от sm. */}
        <h1 className="font-display text-2xl font-extrabold leading-tight text-text-primary sm:text-3xl lg:text-4xl">
          <span className="sm:hidden">Войти</span>
          <span className="hidden sm:inline">Войти&nbsp;/ Зарегистрироваться</span>
        </h1>
        <p className="text-[14px] text-text-muted">
          Один клик — и мы создадим профиль автоматически. Email и пароли больше не нужны.
        </p>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-4">
          {/* Telegram — deep-link + код */}
          <div>
            <div className="mb-2 text-[13px] uppercase tracking-wider text-text-muted">Telegram</div>
            <button
              type="button"
              onClick={handleTelegramClick}
              disabled={tgStarting || tgPolling}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-cyan/40 bg-cyan/15 text-[15px] font-semibold text-text-primary transition-colors hover:bg-cyan/25 disabled:cursor-wait disabled:opacity-60"
            >
              {tgStarting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
              Войти через Telegram
            </button>
          </div>

          {/* Yandex */}
          <div>
            <div className="mb-2 text-[13px] uppercase tracking-wider text-text-muted">Yandex ID</div>
            {yandexHref ? (
              <a
                href={yandexHref}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-pink/40 bg-pink/15 text-[15px] font-semibold text-text-primary transition-colors hover:bg-pink/25"
              >
                Войти через Yandex
                <ArrowRight className="h-5 w-5" />
              </a>
            ) : (
              <div className="rounded-lg border border-border bg-surface-1 px-4 py-3 text-[13px] text-text-muted">
                Yandex-логин не настроен (нет VITE_YANDEX_CLIENT_ID).
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-[13px] text-text-muted">
          Первый раз? Просто нажми Yandex или Telegram — мы создадим профиль автоматически.
        </p>
      </main>

      {tgFlow && (
        <TelegramCodeModal
          code={tgFlow.code}
          deepLink={tgFlow.deep_link}
          polling={tgPolling}
          onCopy={handleCopyCode}
          onCancel={handleCancelTelegram}
        />
      )}
    </div>
  )
}

function TelegramCodeModal({
  code,
  deepLink,
  polling,
  onCopy,
  onCancel,
}: {
  code: string
  deepLink: string
  polling: boolean
  onCopy: () => void
  onCancel: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onCancel}
    >
      <div
        className="relative w-full max-w-[420px] rounded-2xl border border-border bg-surface-1 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Закрыть"
          onClick={onCancel}
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
        >
          <X className="h-5 w-5" />
        </button>
        <h2 className="font-display text-xl font-bold text-text-primary">Подтверди вход в Telegram</h2>
        <p className="mt-2 text-[13px] text-text-muted">
          Мы открыли бота в новой вкладке. Если этого не произошло — нажми «Открыть Telegram» ниже.
          После того как бот пришлёт «Готово», ты автоматически окажешься на сайте.
        </p>

        <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-border bg-bg px-4 py-3">
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">Код</span>
            <span className="font-mono text-2xl font-bold tracking-[0.12em] text-text-primary">{code}</span>
          </div>
          <button
            type="button"
            onClick={onCopy}
            className="grid h-10 w-10 place-items-center rounded-md border border-border text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
            aria-label="Скопировать код"
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>

        <a
          href={deepLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-cyan/40 bg-cyan/15 text-[14px] font-semibold text-text-primary transition-colors hover:bg-cyan/25"
        >
          <ExternalLink className="h-4 w-4" />
          Открыть Telegram
        </a>

        <div className="mt-4 flex items-center gap-2 text-[12px] text-text-muted">
          {polling ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-cyan" />
              Ждём подтверждения…
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 text-success" />
              Готово.
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="mt-4 h-10 w-full rounded-lg border border-border text-[13px] font-medium text-text-muted transition-colors hover:bg-surface-2"
        >
          Отмена
        </button>
      </div>
    </div>
  )
}
