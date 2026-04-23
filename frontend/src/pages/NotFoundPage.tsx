import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Home, ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'

export default function NotFoundPage() {
  const { t } = useTranslation('pages')
  useEffect(() => {
    document.body.classList.add('v2')
    return () => document.body.classList.remove('v2')
  }, [])

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <header className="flex h-[72px] items-center border-b border-border bg-bg px-4 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-lg font-extrabold text-text-primary">9</span>
          <span className="font-display text-lg font-bold text-text-primary">druz9</span>
        </Link>
      </header>

      <main className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-center gap-6 px-6 py-12 sm:px-10 sm:py-[60px]">
        <div className="font-mono text-6xl sm:text-7xl lg:text-[96px] leading-none font-extrabold text-text-primary">
          <span className="text-accent">{'{ '}</span>
          404
          <span className="text-accent">{' }'}</span>
        </div>
        <h1 className="font-display text-2xl font-bold text-text-primary">{t('not_found.title')}</h1>
        <p className="max-w-md text-center font-sans text-sm text-text-secondary">
          {t('not_found.subtitle')}
        </p>
        {/* Шуточный <pre> с git-командами убран — выглядел странно для
            обычных пользователей. Если в i18n.fatal остался текст — выведем
            его одной строкой; иначе ничего. */}
        {t('not_found.fatal') && (
          <p className="text-center font-sans text-sm text-text-muted">
            {t('not_found.fatal')}
          </p>
        )}
        <div className="flex gap-3">
          {/* Прямая Link без вложенного <button> — иначе HTML невалидный (a > button)
              и getByRole('link') в Playwright не находит accessible name. */}
          <Link
            to="/sanctum"
            data-testid="back-home"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-text-primary shadow-glow transition hover:bg-accent-hover"
          >
            <Home className="h-4 w-4" />
            {t('not_found.home')}
          </Link>
          <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => window.history.back()}>
            {t('not_found.back')}
          </Button>
        </div>
      </main>
    </div>
  )
}
