import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'
import { usePublicStats } from '../lib/api/stats'

function MinimalTopBar() {
  const { t } = useTranslation('welcome')
  return (
    <header
      className="flex h-[64px] items-center justify-between border-b border-border bg-bg px-4 sm:px-8 lg:h-[80px] lg:px-20"
    >
      <Link to="/welcome" className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-lg font-extrabold text-text-primary">
          9
        </span>
        <span className="font-display text-xl font-bold text-text-primary">druz9</span>
      </Link>
      <div className="flex items-center gap-2 sm:gap-3">
        <Link
          to="/login"
          className="hidden rounded-md px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary sm:inline-block"
        >
          {t('login')}
        </Link>
        {/* Onboarding-туториал теперь только для авторизованных юзеров после
            первого входа. На лендинге CTA ведёт на /login, а онбординг
            запустится автоматически при первом успешном логине (см. is_new_user). */}
        <Link to="/login">
          <Button variant="primary" iconRight={<ArrowRight className="h-4 w-4" />} className="px-3 shadow-glow sm:px-5">
            {t('start')}
          </Button>
        </Link>
      </div>
    </header>
  )
}

function TrustLogo({ name }: { name: string }) {
  return (
    <div className="grid h-10 w-[120px] place-items-center rounded-md border border-border bg-surface-2 font-display text-sm font-bold text-text-muted">
      {name}
    </div>
  )
}

export default function WelcomePage() {
  const { t } = useTranslation('welcome')
  const navigate = useNavigate()
  const stats = usePublicStats()
  const developersCount = stats.data?.users_count ?? 0
  useEffect(() => {
    document.body.classList.add('v2')
    return () => document.body.classList.remove('v2')
  }, [])

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <MinimalTopBar />
      <main
        className="flex flex-col items-center justify-center gap-7 px-4 pb-12 pt-10 sm:px-8 lg:px-20 lg:pb-20 lg:pt-[60px]"
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-cyan/30 bg-cyan/10 px-4 py-1.5 text-[13px] font-medium text-cyan">
          <span className="relative grid h-2 w-2 place-items-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-cyan opacity-75" />
            <span className="relative h-2 w-2 rounded-full bg-cyan" />
          </span>
          {stats.isLoading
            ? t('developers_inside', { count: 0 }).replace(/\d+/, '—')
            : t('developers_inside', { count: developersCount })}
          <ArrowRight className="h-3.5 w-3.5" />
        </span>

        <h1
          className="text-center font-display font-extrabold text-text-primary"
          style={{ fontSize: 'clamp(40px, 9vw, 80px)', lineHeight: 1.05, letterSpacing: '-0.03em', maxWidth: 1200, fontWeight: 800 }}
        >
          {t('headline_1')}
        </h1>
        <h2
          className="text-center font-display font-extrabold"
          style={{
            fontSize: 'clamp(40px, 9vw, 80px)',
            lineHeight: 1.05,
            letterSpacing: '-0.03em',
            maxWidth: 1200,
            fontWeight: 800,
            background: 'linear-gradient(90deg, #22D3EE 0%, #582CFF 50%, #F472B6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {t('headline_2')}
        </h2>
        <p className="max-w-[720px] text-center font-sans text-[18px] leading-relaxed text-text-secondary">
          {t('subhead')}
        </p>

        <div className="mt-2 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
          <Link to="/login" className="w-full sm:w-auto">
            <Button
              variant="primary"
              iconRight={<ArrowRight className="h-5 w-5" />}
              className="h-14 w-full justify-center px-7 text-[15px] shadow-glow sm:w-auto"
            >
              {t('start_free')}
            </Button>
          </Link>
          <Button
            variant="ghost"
            icon={<Play className="h-4 w-4" />}
            className="h-14 w-full justify-center px-6 text-[15px] sm:w-auto"
            onClick={() => navigate('/welcome/demo')}
          >
            {t('watch_demo')}
          </Button>
        </div>

        <div className="mt-10 flex flex-col items-center gap-4">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">
            {t('developers_from')}
          </span>
          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-5">
            <TrustLogo name="YANDEX" />
            <TrustLogo name="VK" />
            <TrustLogo name="OZON" />
            <TrustLogo name="AVITO" />
          </div>
        </div>
      </main>
    </div>
  )
}
