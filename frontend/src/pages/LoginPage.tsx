import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { login, describeAuthError } from '../lib/api/auth'

function OAuthButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-transparent text-sm font-semibold text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
    >
      {label}
    </button>
  )
}

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</span>
      <input
        {...rest}
        className="h-12 w-full rounded-lg border border-border bg-surface-2 px-4 text-[14px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
      />
    </label>
  )
}

/**
 * Login page — POSTs to /api/v1/auth/login, persists access token, then
 * navigates to the authenticated landing page.
 */
export default function LoginPage() {
  const { t } = useTranslation('welcome')
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    document.body.classList.add('v2')
    return () => document.body.classList.remove('v2')
  }, [])

  const emailRe = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    if (!emailRe.test(email)) {
      setErrorMsg('Введите корректный email')
      return
    }
    if (password.length < 8) {
      setErrorMsg('Пароль должен быть минимум 8 символов')
      return
    }
    setSubmitting(true)
    try {
      await login({ email, password })
      navigate('/')
    } catch (err) {
      setErrorMsg(describeAuthError(err))
    } finally {
      setSubmitting(false)
    }
  }

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
      <main className="mx-auto flex w-full max-w-[420px] flex-col gap-6 px-4 py-12 sm:py-16">
        <h1 className="font-display text-3xl font-extrabold text-text-primary sm:text-4xl">
          {t('login')}
        </h1>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <Field
            label="Email"
            placeholder="dima@example.com"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Field
            label="Пароль"
            placeholder="••••••••"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {errorMsg && (
            <p className="text-[12px] font-medium text-danger" role="alert">
              {errorMsg}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            iconRight={<ArrowRight className="h-5 w-5" />}
            className="mt-2 h-14 text-[15px] shadow-glow"
            disabled={submitting}
          >
            {submitting ? '…' : t('login')}
          </Button>
        </form>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">или</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="flex gap-3">
          <OAuthButton label="GitHub" />
          <OAuthButton label="Google" />
          <OAuthButton label="Yandex" />
        </div>

        <p className="text-center text-[13px] text-text-muted">
          Нет аккаунта?{' '}
          <Link to="/onboarding?step=1" className="font-semibold text-accent-hover hover:underline">
            Создать
          </Link>
        </p>
      </main>
    </div>
  )
}
