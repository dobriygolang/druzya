// Yandex OAuth callback. Регистрируется как роут /auth/callback/yandex.
//
// Yandex редиректит пользователя сюда с ?code=...&state=... после успешной
// авторизации. Мы сверяем state с тем, что положили в sessionStorage перед
// редиректом (CSRF), POST'им code на /api/v1/auth/yandex и сохраняем
// access_token.
//
// Контракт ответа (см. backend/services/auth/ports/server.go,
// AuthServer.LoginYandex → buildLoginResponse):
//   {access_token, expires_in, user: {...}}
// Refresh-токен ставится бэком в HttpOnly-cookie, фронт его не видит.

import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { api } from '../lib/apiClient'
import { persistAccessToken, type AuthUser } from '../lib/queries/auth'

interface YandexAuthResponse {
  access_token: string
  expires_in?: number
  user?: AuthUser
  // is_new_user не возвращается стандартным AuthResponse (нужно расширение
  // proto), поэтому Yandex-вход всегда уходит на /sanctum.
  // STUB: после расширения proto добавить is_new_user → /onboarding.
}

export default function AuthCallbackYandexPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code = params.get('code')
    const state = params.get('state')
    const errParam = params.get('error')
    if (errParam) {
      setError(`Yandex отказал в авторизации: ${errParam}`)
      return
    }
    if (!code) {
      setError('В ответе нет кода авторизации.')
      return
    }
    const expected = sessionStorage.getItem('oauth_state_yandex')
    if (expected && state && expected !== state) {
      setError('CSRF state mismatch — повтори вход.')
      return
    }
    sessionStorage.removeItem('oauth_state_yandex')

    let cancelled = false
    void (async () => {
      try {
        const res = await api<YandexAuthResponse>('/auth/yandex', {
          method: 'POST',
          body: JSON.stringify({ code, state: state ?? '' }),
        })
        if (cancelled) return
        if (res?.access_token) {
          persistAccessToken(res.access_token)
        }
        navigate('/sanctum', { replace: true })
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        setError(`Не получилось обменять код на токен: ${msg}`)
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
            <h1 className="font-display text-2xl font-bold">Не удалось войти</h1>
            <p className="text-[14px] text-text-muted">{error}</p>
            <Link
              to="/login"
              className="mt-2 inline-flex h-10 items-center justify-center rounded-lg border border-border bg-surface-1 px-4 text-[14px] font-medium text-text-primary hover:bg-surface-2"
            >
              Вернуться к входу
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-cyan" />
            <p className="text-[14px] text-text-muted">Заходим в твой профиль…</p>
          </>
        )}
      </div>
    </div>
  )
}
