// OAuth-only login. Email/password убрали в Phase 2 — см. удалённый
// frontend/src/lib/api/auth.ts и backend/cmd/monolith/services/auth_pwd.go.
//
// Поток:
//   • Yandex: кнопка строит authorize-URL (response_type=code) + редирект.
//     Yandex редиректит обратно на /auth/callback/yandex?code=... — там
//     AuthCallbackYandexPage POST'ит на /api/v1/auth/yandex и сохраняет токены.
//   • Telegram: подгружаем Telegram Login Widget (telegram.org/js), он
//     рендерит свою кнопку. Когда пользователь авторизуется в Telegram,
//     виджет зовёт глобальный onTelegramAuth(user) — мы POST'им user
//     на /api/v1/auth/telegram и сохраняем токены.

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/apiClient'

const YANDEX_CLIENT_ID = import.meta.env.VITE_YANDEX_CLIENT_ID as string | undefined
const TELEGRAM_BOT_NAME = import.meta.env.VITE_TELEGRAM_BOT_NAME as string | undefined
// Redirect URI: фронт сам знает свой origin → /auth/callback/yandex.
// Этот же URL должен быть зарегистрирован в Yandex OAuth app settings.
const yandexRedirectURI = () => `${window.location.origin}/auth/callback/yandex`

function buildYandexAuthorizeURL(): string | null {
  if (!YANDEX_CLIENT_ID) return null
  // CSRF state: один раз сгенерили → положили в sessionStorage → callback сверит.
  const state = crypto.randomUUID()
  sessionStorage.setItem('oauth_state_yandex', state)
  const u = new URL('https://oauth.yandex.ru/authorize')
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', YANDEX_CLIENT_ID)
  u.searchParams.set('redirect_uri', yandexRedirectURI())
  u.searchParams.set('state', state)
  return u.toString()
}

interface TelegramAuthPayload {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuthPayload) => void
  }
}

export default function LoginPage() {
  const { t } = useTranslation('welcome')
  const navigate = useNavigate()
  const tgContainer = useRef<HTMLDivElement>(null)
  const [tgPending, setTgPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.body.classList.add('v2')
    return () => document.body.classList.remove('v2')
  }, [])

  // Telegram Login Widget. Включаем только если задан BOT_NAME.
  useEffect(() => {
    if (!TELEGRAM_BOT_NAME || !tgContainer.current) return

    window.onTelegramAuth = async (user) => {
      setTgPending(true)
      setError(null)
      try {
        const res = await api<{ tokens: { access_token: string; refresh_token: string } }>(
          '/auth/telegram',
          {
            method: 'POST',
            body: JSON.stringify({
              id: String(user.id),
              first_name: user.first_name,
              last_name: user.last_name ?? '',
              username: user.username ?? '',
              photo_url: user.photo_url ?? '',
              auth_date: user.auth_date,
              hash: user.hash,
            }),
          },
        )
        if (res?.tokens?.access_token) {
          localStorage.setItem('druz9.access_token', res.tokens.access_token)
        }
        navigate('/', { replace: true })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(`Telegram авторизация не прошла: ${msg}`)
      } finally {
        setTgPending(false)
      }
    }

    const script = document.createElement('script')
    script.async = true
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.setAttribute('data-telegram-login', TELEGRAM_BOT_NAME)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-radius', '10')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    tgContainer.current.appendChild(script)

    return () => {
      delete window.onTelegramAuth
    }
  }, [navigate])

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
        <Link to="/onboarding?step=1" className="text-sm font-medium text-text-muted hover:text-text-secondary">
          {t('start')}
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-[420px] flex-col gap-8 px-4 py-12 sm:py-16">
        <h1 className="font-display text-3xl font-extrabold text-text-primary sm:text-4xl">{t('login')}</h1>
        <p className="text-[14px] text-text-muted">
          Войди через свой профиль провайдера. Email/пароль больше не поддерживаются.
        </p>

        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-4">
          {/* Telegram — рендерит сам Telegram-виджет */}
          <div>
            <div className="mb-2 text-[13px] uppercase tracking-wider text-text-muted">Telegram</div>
            {TELEGRAM_BOT_NAME ? (
              <div className="flex min-h-[48px] items-center justify-center" ref={tgContainer}>
                {tgPending && <Loader2 className="h-5 w-5 animate-spin text-cyan" />}
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-surface-1 px-4 py-3 text-[13px] text-text-muted">
                Telegram-логин не настроен (нет VITE_TELEGRAM_BOT_NAME).
              </div>
            )}
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
          Нет аккаунта? Просто войди через провайдера — мы создадим профиль автоматически.{' '}
          <Link to="/onboarding?step=1" className="font-semibold text-accent-hover hover:underline">
            или пройди онбординг
          </Link>
        </p>
      </main>
    </div>
  )
}
