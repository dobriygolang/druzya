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
import { ArrowRight, Loader2, Send, X, Copy, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import {
  devLogin,
  pollTelegramAuth,
  startTelegramAuth,
  persistAuthTokens,
  type PollSuccess,
  type TelegramStartResponse,
} from '../lib/queries/auth'
import { staggerContainer, staggerItem } from '../lib/motion-presets'
import { Modal } from '../components/primitives/Modal'
import { motion as motionTokens } from '../lib/design-tokens'

const YANDEX_CLIENT_ID = import.meta.env.VITE_YANDEX_CLIENT_ID as string | undefined
const POLL_INTERVAL_MS = 3000
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
 * обычный navigate('/arena').
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
  const nextHref = params.get('next') ?? '/today'
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

  // Stash `?next=` в sessionStorage перед стартом OAuth — иначе после
  // редиректа Яндекса параметр теряется (callback URL содержит только
  // ?code=&state=). Читается в AuthCallbackYandexPage. Исключаем /onboarding
  // как `next`, чтобы новые юзеры не зацикливались.
  const oauthNext =
    nextHref && nextHref !== '/onboarding' && !nextHref.startsWith('/auth/')
      ? nextHref
      : null
  if (oauthNext) {
    try {
      sessionStorage.setItem('oauth_next', oauthNext)
    } catch {
      /* private mode — fall through to default /arena */
    }
  }

  const yandexHref = buildYandexAuthorizeURL()

  return (
    <div
      className="min-h-screen text-text-primary"
      style={{ background: 'rgb(var(--color-bg))' }}
    >
      <header
        className="flex items-center justify-between px-4 sm:px-8 lg:px-20"
        style={{
          height: 64,
          borderBottom: '1px solid var(--hair)',
        }}
      >
        <Link to="/welcome" className="flex items-center gap-2.5 focus-ring">
          <span
            className="grid place-items-center"
            style={{
              width: 28,
              height: 28,
              border: '1px solid var(--hair-2)',
              borderRadius: 8,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontWeight: 600,
              fontSize: 14,
              color: 'rgb(var(--ink))',
            }}
          >
            9
          </span>
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '-0.005em',
              color: 'rgb(var(--ink))',
            }}
          >
            druz9
          </span>
        </Link>
        <Link
          to="/welcome"
          className="focus-ring"
          style={{
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            color: 'var(--ink-60)',
            transition: 'color var(--motion-dur-small) var(--motion-ease-standard)',
            padding: '6px 10px',
            borderRadius: 6,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-60)')}
        >
          {t('start')}
        </Link>
      </header>

      <motion.main
        className="mx-auto flex w-full flex-col px-4 py-12 sm:py-16"
        style={{ maxWidth: 480, gap: 'var(--gap-section)' }}
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={staggerItem} className="flex flex-col" style={{ gap: 12 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 'var(--type-h1-size)',
              lineHeight: 'var(--type-h1-lh)',
              letterSpacing: 'var(--type-h1-ls)',
              fontWeight: 'var(--type-h1-weight)',
              color: 'rgb(var(--ink))',
            }}
          >
            <span className="sm:hidden">Войти</span>
            <span className="hidden sm:inline">Войти / Зарегистрироваться</span>
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-lh)',
              color: 'var(--ink-60)',
              maxWidth: '60ch',
            }}
          >
            Один клик — и мы создадим профиль автоматически. Email и пароли больше не нужны.
          </p>
        </motion.div>

        {error && (
          <motion.div
            variants={staggerItem}
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '12px 16px',
              border: '1px solid rgba(255, 59, 48, 0.4)',
              borderRadius: 'var(--radius-inner)',
              fontSize: 13,
              color: 'var(--red)',
              background: 'transparent',
            }}
          >
            <span style={{ display: 'inline-block', width: 1.5, minHeight: 16, background: 'var(--red)', marginTop: 4 }} />
            {error}
          </motion.div>
        )}

        <motion.div variants={staggerItem} className="flex flex-col" style={{ gap: 'var(--gap-row)' }}>
          {/* Telegram — deep-link + код */}
          <SectionLabel>Telegram</SectionLabel>
          <button
            type="button"
            onClick={handleTelegramClick}
            disabled={tgStarting || tgPolling}
            className="focus-ring motion-hover-lift motion-press"
            style={ghostButton}
          >
            {tgStarting ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Send className="h-[18px] w-[18px]" />}
            <span>Войти через Telegram</span>
          </button>
        </motion.div>

        <motion.div variants={staggerItem} className="flex flex-col" style={{ gap: 'var(--gap-row)' }}>
          {/* Yandex */}
          <SectionLabel>Yandex ID</SectionLabel>
          {yandexHref ? (
            <a
              href={yandexHref}
              className="focus-ring motion-hover-lift motion-press"
              style={ghostButton}
            >
              <span>Войти через Yandex</span>
              <ArrowRight className="h-[18px] w-[18px]" />
            </a>
          ) : (
            <div
              style={{
                padding: '12px 16px',
                border: '1px solid var(--hair)',
                borderRadius: 'var(--radius-inner)',
                fontSize: 13,
                color: 'var(--ink-40)',
              }}
            >
              Yandex-логин не настроен (нет VITE_YANDEX_CLIENT_ID).
            </div>
          )}
        </motion.div>

        <motion.p
          variants={staggerItem}
          style={{
            margin: 0,
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--ink-40)',
            maxWidth: '60ch',
            alignSelf: 'center',
          }}
        >
          Первый раз? Просто нажми Yandex или Telegram — мы создадим профиль автоматически.
        </motion.p>

        {/* DEV-ONLY login. Endpoint доступен ТОЛЬКО когда backend стартует
            с DEV_AUTH=true (response 404 иначе). Не показываем в production
            build — VITE_DEV_AUTH=true в .env.local включает UI. */}
        {import.meta.env.VITE_DEV_AUTH === 'true' && (
          <motion.div variants={staggerItem}>
            <DevLoginPane
              onError={setError}
              onSuccess={(r) => {
                persistAuthTokens({
                  access_token: r.access_token,
                  refresh_token: r.refresh_token,
                  expires_in: r.expires_in,
                })
                const dest = r.is_new_user ? '/onboarding' : nextHref
                navigate(dest, { replace: true })
              }}
            />
          </motion.div>
        )}
      </motion.main>

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

// v2 visual language helpers — section caption-mono uppercase + ghost button.

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        color: 'var(--ink-40)',
      }}
    >
      {children}
    </div>
  )
}

const ghostButton: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  width: '100%',
  minHeight: 44,
  padding: '12px 20px',
  border: '1px solid var(--hair-2)',
  borderRadius: 'var(--radius-inner)',
  background: 'transparent',
  color: 'rgb(var(--ink))',
  fontSize: 15,
  fontWeight: 500,
  letterSpacing: '-0.005em',
  cursor: 'pointer',
  textDecoration: 'none',
  transition:
    'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
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
  // Local open state for smooth exit animation. Parent unmounts TelegramCodeModal
  // when tgFlow flips to null — we delay that by motion.dur.medium so the
  // exit anim plays out.
  const [open, setOpen] = useState(true)
  const close = () => {
    setOpen(false)
    window.setTimeout(onCancel, motionTokens.dur.medium)
  }

  return (
    <Modal open={open} onClose={close} size="sm">
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 8 }}>
        <h2
          style={{
            margin: 0,
            fontSize: 'var(--type-h3-size)',
            lineHeight: 'var(--type-h3-lh)',
            letterSpacing: 'var(--type-h3-ls)',
            fontWeight: 'var(--type-h3-weight)',
            color: 'rgb(var(--ink))',
          }}
        >
          Подтверди вход в Telegram
        </h2>
        <button
          type="button"
          aria-label="Закрыть"
          onClick={close}
          className="focus-ring"
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'transparent',
            color: 'var(--ink-60)',
            border: 0,
            cursor: 'pointer',
            flex: '0 0 auto',
            transition:
              'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
            e.currentTarget.style.color = 'rgb(var(--ink))'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--ink-60)'
          }}
        >
          <X className="h-5 w-5" />
        </button>
      </header>
      <p style={{ margin: 0, marginBottom: 20, fontSize: 13, color: 'var(--ink-60)', lineHeight: 1.55 }}>
        Мы открыли бота в новой вкладке. Если этого не произошло — нажми «Открыть Telegram» ниже.
        После того как бот пришлёт «Готово», ты автоматически окажешься на сайте.
      </p>

      <div
        className="flex-wrap-row"
        style={{
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 16px',
          border: '1px solid var(--hair-2)',
          borderRadius: 'var(--radius-inner)',
          background: 'transparent',
        }}
      >
        <div className="flex flex-col" style={{ minWidth: 0 }}>
          <span
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ink-40)',
            }}
          >
            Код
          </span>
          <span
            style={{
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: 'rgb(var(--ink))',
            }}
          >
            {code}
          </span>
        </div>
        <button
          type="button"
          onClick={onCopy}
          aria-label="Скопировать код"
          className="focus-ring motion-press"
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 40,
            height: 40,
            borderRadius: 'var(--radius-inner)',
            border: '1px solid var(--hair-2)',
            color: 'var(--ink-60)',
            background: 'transparent',
            cursor: 'pointer',
            transition:
              'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
            e.currentTarget.style.color = 'rgb(var(--ink))'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--ink-60)'
          }}
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>

      <a
        href={deepLink}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-ring motion-press"
        style={{
          marginTop: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          minHeight: 44,
          padding: '12px 20px',
          border: '1px solid var(--hair-2)',
          borderRadius: 'var(--radius-inner)',
          background: 'transparent',
          color: 'rgb(var(--ink))',
          fontSize: 14,
          fontWeight: 500,
          textDecoration: 'none',
          transition:
            'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.18)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.borderColor = 'var(--hair-2)'
        }}
      >
        <ExternalLink className="h-4 w-4" />
        Открыть Telegram
      </a>

      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--ink-60)' }}>
        {polling ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Ждём подтверждения…
          </>
        ) : (
          <>
            <span aria-hidden="true" style={{ display: 'inline-block', width: 5, height: 5, borderRadius: 999, background: 'var(--red)' }} />
            Готово.
          </>
        )}
      </div>

      <button
        type="button"
        onClick={close}
        className="focus-ring motion-press"
        style={{
          marginTop: 14,
          width: '100%',
          padding: '10px 16px',
          border: '1px solid var(--hair)',
          borderRadius: 'var(--radius-inner)',
          background: 'transparent',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--ink-60)',
          cursor: 'pointer',
          transition:
            'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'
          e.currentTarget.style.color = 'rgb(var(--ink))'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--ink-60)'
        }}
      >
        Отмена
      </button>
    </Modal>
  )
}

// ─── DevLoginPane (INSECURE, DEV-only) ───────────────────────────────────
//
// Локальный bypass auth-flow. Завязан на backend env DEV_AUTH=true — если
// бэк production-собран без флага, endpoint 404 и onError получит понятное
// сообщение. UI скрыт за VITE_DEV_AUTH=true (см usage в LoginPage main).

interface DevLoginPaneProps {
  onSuccess: (r: PollSuccess) => void
  onError: (msg: string) => void
}

function DevLoginPane({ onSuccess, onError }: DevLoginPaneProps) {
  const [username, setUsername] = useState('sergey')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const u = username.trim()
    if (!u) return
    setBusy(true)
    onError('')
    try {
      const r = await devLogin(u)
      onSuccess(r)
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        padding: '16px 18px',
        border: '1px solid var(--hair)',
        borderRadius: 'var(--radius-outer)',
        background: 'rgba(255, 255, 255, 0.02)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 14,
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          color: 'var(--ink-60)',
        }}
      >
        {/* Red signal stripe — 1.5×24px, the v2 metaphor: live/dev indicator. */}
        <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 1.5, background: '#FF3B30' }} />
        DEV-only · DEV_AUTH=true
      </div>
      <div className="flex flex-wrap-row" style={{ gap: 12, alignItems: 'baseline' }}>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username"
          className="min-w-0"
          disabled={busy}
          aria-label="DEV username"
          style={{
            flex: '1 1 160px',
            minWidth: 0,
            padding: '10px 0',
            border: 0,
            borderBottom: '1px solid var(--hair-2)',
            background: 'transparent',
            color: 'rgb(var(--ink))',
            fontSize: 14,
            outline: 'none',
            transition: 'border-color var(--motion-dur-small) var(--motion-ease-decelerate)',
          }}
          onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'rgb(var(--ink))')}
          onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--hair-2)')}
        />
        <button
          type="submit"
          disabled={!username.trim() || busy}
          className="focus-ring motion-press"
          style={{
            flex: '0 0 auto',
            padding: '10px 18px',
            background: 'rgb(var(--ink))',
            color: 'rgb(var(--color-bg))',
            border: 0,
            borderRadius: 'var(--radius-inner)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            opacity: !username.trim() || busy ? 0.5 : 1,
            transition: 'opacity var(--motion-dur-small) var(--motion-ease-standard), background-color var(--motion-dur-small) var(--motion-ease-standard)',
          }}
          onMouseEnter={(e) => {
            if (!busy && username.trim()) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.92)'
          }}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--ink)')}
        >
          {busy ? '…' : 'Войти'}
        </button>
      </div>
      <p style={{ margin: 0, marginTop: 12, fontSize: 11, color: 'var(--ink-40)', lineHeight: 1.5 }}>
        Никаких паролей. Создаёт/пере-логинит юзера по имени. Видно только локально — на проде 404.
      </p>
    </form>
  )
}
