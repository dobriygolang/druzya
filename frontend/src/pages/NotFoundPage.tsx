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
      <header className="flex h-[72px] items-center border-b border-border bg-bg px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-lg font-extrabold text-text-primary">9</span>
          <span className="font-display text-lg font-bold text-text-primary">druz9</span>
        </Link>
      </header>

      <main className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-center gap-6" style={{ padding: '60px 40px' }}>
        <div className="font-mono text-6xl sm:text-7xl lg:text-[96px] leading-none font-extrabold text-text-primary">
          <span className="text-accent">{'{ '}</span>
          404
          <span className="text-accent">{' }'}</span>
        </div>
        <h1 className="font-display text-2xl font-bold text-text-primary">{t('not_found.title')}</h1>
        <p className="max-w-md text-center font-sans text-sm text-text-secondary">
          {t('not_found.subtitle')}
        </p>
        <pre className="rounded-lg border border-border bg-surface-1 p-4 font-mono text-[12px] leading-relaxed text-text-secondary">
{`$ git log --grep="this page"
$ git checkout main -- pages/`}
          {'\n'}<span className="text-danger">{t('not_found.fatal')}</span>
        </pre>
        <div className="flex gap-3">
          <Link to="/sanctum"><Button variant="primary" icon={<Home className="h-4 w-4" />}>{t('not_found.home')}</Button></Link>
          <button onClick={() => window.history.back()}>
            <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />}>{t('not_found.back')}</Button>
          </button>
        </div>
      </main>
    </div>
  )
}
