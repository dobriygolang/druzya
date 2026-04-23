import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Play,
  Sword,
  Bot,
  Flame,
  Users,
  Map,
  Headphones,
  Check,
  Code2,
  Send,
  MessageCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'framer-motion'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { CopilotPromoBanner } from '../components/CopilotPromoBanner'
import { usePublicStats } from '../lib/api/stats'

// druz9 brand gradient — violet → cyan → pink — used as the gradient text fill
// in the hero и accent strokes на final CTA. Хранится локально, чтобы не
// плодить tailwind utility-цепочки и держать визуал в одном месте.
const BRAND_GRADIENT =
  'linear-gradient(90deg, #22D3EE 0%, #582CFF 50%, #F472B6 100%)'

function MinimalTopBar() {
  const { t } = useTranslation('welcome')
  return (
    <header
      className="sticky top-0 z-30 flex h-[64px] items-center justify-between border-b border-border bg-bg/85 px-4 backdrop-blur sm:px-8 lg:h-[80px] lg:px-20"
    >
      <Link to="/welcome" className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-lg font-extrabold text-text-primary">
          9
        </span>
        <span className="font-display text-xl font-bold text-text-primary">druz9</span>
      </Link>
      <nav className="hidden items-center gap-6 md:flex">
        <a href="#features" className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary">
          {t('nav.features')}
        </a>
        <a href="#stats" className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary">
          {t('nav.stats')}
        </a>
        <a href="#testimonials" className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary">
          {t('nav.testimonials')}
        </a>
        <a href="#pricing" className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary">
          {t('nav.pricing')}
        </a>
      </nav>
      {/* Один CTA в топбаре — "Войти". Кнопка "Начать" дублировала бы
          основной hero-CTA "Начать бесплатно" (обе на /login), поэтому убрана.
          Onboarding-туториал запустится автоматически при первом логине
          (см. is_new_user в AuthResponse). */}
      <Link
        to="/login"
        className="rounded-md px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
      >
        {t('login')}
      </Link>
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

// FadeInSection — обёртка для секций, fade-in при появлении в viewport.
// `useReducedMotion` отключает анимацию для пользователей с
// prefers-reduced-motion (a11y).
function FadeInSection({
  children,
  className,
  id,
}: {
  children: React.ReactNode
  className?: string
  id?: string
}) {
  const reduced = useReducedMotion()
  if (reduced) {
    return (
      <section id={id} className={className}>
        {children}
      </section>
    )
  }
  return (
    <motion.section
      id={id}
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {children}
    </motion.section>
  )
}

type FeatureKey = 'pvp' | 'ai' | 'daily' | 'guilds' | 'atlas' | 'podcasts'

const FEATURE_ICONS: Record<FeatureKey, React.ComponentType<{ className?: string }>> = {
  pvp: Sword,
  ai: Bot,
  daily: Flame,
  guilds: Users,
  atlas: Map,
  podcasts: Headphones,
}

function FeatureCard({ k }: { k: FeatureKey }) {
  const { t } = useTranslation('welcome')
  const Icon = FEATURE_ICONS[k]
  return (
    <Card variant="elevated" interactive padding="lg" className="h-full">
      <div className="mb-4 grid h-11 w-11 place-items-center rounded-lg bg-gradient-to-br from-accent/30 to-cyan/30 text-accent">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mb-2 font-display text-[18px] font-bold text-text-primary">
        {t(`features.${k}.title`)}
      </h3>
      <p className="text-[14px] leading-relaxed text-text-secondary">
        {t(`features.${k}.desc`)}
      </p>
    </Card>
  )
}

// formatStat — компактный числовой формат для метрик платформы.
// Returns "—" при загрузке, "1.2k" / "12.4k" / "1.2M" дальше.
function formatStat(value: number | undefined, loading: boolean, fallback: string) {
  if (loading || value === undefined) return fallback
  if (value < 1000) return value.toLocaleString('ru-RU')
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <Card variant="gradient" padding="lg" className="text-center">
      <div
        className="font-display text-[44px] font-extrabold leading-none"
        style={{
          background: BRAND_GRADIENT,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        {value}
      </div>
      <div className="mt-2 font-mono text-[12px] uppercase tracking-[0.12em] text-text-muted">
        {label}
      </div>
    </Card>
  )
}

type Testimonial = {
  quote: string
  name: string
  role: string
  company: string
}

function TestimonialCard({ item }: { item: Testimonial }) {
  // Аватар — инициал, окрашен под brand-gradient. Без upload, без fake-фото.
  const initial = item.name.trim().charAt(0).toUpperCase()
  return (
    <Card variant="elevated" padding="lg" className="h-full">
      <p className="mb-5 text-[15px] leading-relaxed text-text-primary">
        “{item.quote}”
      </p>
      <div className="mt-auto flex items-center gap-3">
        <span
          className="grid h-10 w-10 place-items-center rounded-full font-display text-base font-bold text-text-primary"
          style={{ background: BRAND_GRADIENT }}
          aria-hidden="true"
        >
          {initial}
        </span>
        <div className="min-w-0">
          <div className="truncate font-display text-sm font-semibold text-text-primary">
            {item.name}
          </div>
          <div className="truncate font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted">
            {item.role} · {item.company}
          </div>
        </div>
      </div>
    </Card>
  )
}

type PricingTierKey = 'free' | 'premium' | 'pro'

function PricingCard({
  tier,
  highlighted,
  href,
}: {
  tier: PricingTierKey
  highlighted?: boolean
  href: string
}) {
  const { t } = useTranslation('welcome')
  const features = t(`pricing.${tier}.features`, { returnObjects: true }) as string[]
  const badge =
    tier === 'premium' ? (t('pricing.premium.badge') as string) : null

  return (
    <Card
      variant={highlighted ? 'selected' : 'elevated'}
      padding="lg"
      className="relative h-full"
    >
      {badge ? (
        <span className="absolute right-5 top-5 rounded-full bg-accent px-3 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-text-primary">
          {badge}
        </span>
      ) : null}
      <div className="mb-1 font-display text-[20px] font-bold text-text-primary">
        {t(`pricing.${tier}.name`)}
      </div>
      <p className="mb-5 text-[13px] text-text-secondary">{t(`pricing.${tier}.desc`)}</p>
      <div className="mb-6 flex items-baseline gap-2">
        <span className="font-display text-[36px] font-extrabold text-text-primary">
          {t(`pricing.${tier}.price`)}
        </span>
        <span className="font-mono text-[12px] text-text-muted">
          {t(`pricing.${tier}.period`)}
        </span>
      </div>
      <ul className="mb-6 flex flex-col gap-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-[14px] text-text-secondary">
            <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-cyan" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link to={href} className="mt-auto block">
        <Button
          variant={highlighted ? 'primary' : 'ghost'}
          className="h-11 w-full justify-center"
        >
          {t(`pricing.${tier}.cta`)}
        </Button>
      </Link>
    </Card>
  )
}

function Footer() {
  const { t } = useTranslation('welcome')
  return (
    <footer className="border-t border-border bg-surface-1 px-4 py-12 sm:px-8 lg:px-20">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 md:grid-cols-4">
        <div>
          <Link to="/welcome" className="mb-4 flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-gradient-to-br from-accent to-cyan font-display text-base font-extrabold text-text-primary">
              9
            </span>
            <span className="font-display text-lg font-bold text-text-primary">druz9</span>
          </Link>
          <p className="max-w-[260px] text-[13px] leading-relaxed text-text-muted">
            {t('footer.tagline')}
          </p>
        </div>
        <div>
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">
            {t('footer.product')}
          </div>
          <ul className="flex flex-col gap-2 text-[14px]">
            <li>
              <Link to="/arena" className="text-text-secondary transition-colors hover:text-text-primary">
                {t('footer.links.arena')}
              </Link>
            </li>
            <li>
              <Link to="/arena/kata" className="text-text-secondary transition-colors hover:text-text-primary">
                {t('footer.links.daily')}
              </Link>
            </li>
            <li>
              <Link to="/atlas" className="text-text-secondary transition-colors hover:text-text-primary">
                {t('footer.links.atlas')}
              </Link>
            </li>
            <li>
              <a href="#pricing" className="text-text-secondary transition-colors hover:text-text-primary">
                {t('footer.links.pricing')}
              </a>
            </li>
          </ul>
        </div>
        <div>
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">
            {t('footer.resources')}
          </div>
          <ul className="flex flex-col gap-2 text-[14px]">
            <li>
              <Link to="/help" className="text-text-secondary transition-colors hover:text-text-primary">
                {t('footer.links.help')}
              </Link>
            </li>
            <li>
              <Link to="/podcasts" className="text-text-secondary transition-colors hover:text-text-primary">
                {t('footer.links.podcasts')}
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">
            {t('footer.community')}
          </div>
          <ul className="flex flex-col gap-2 text-[14px]">
            <li>
              <a
                href="https://github.com/druz9"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-text-secondary transition-colors hover:text-text-primary"
              >
                <Code2 className="h-4 w-4" />
                {t('footer.links.github')}
              </a>
            </li>
            <li>
              <a
                href="https://t.me/druz9"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-text-secondary transition-colors hover:text-text-primary"
              >
                <Send className="h-4 w-4" />
                {t('footer.links.telegram')}
              </a>
            </li>
            <li>
              <a
                href="https://discord.gg/druz9"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-text-secondary transition-colors hover:text-text-primary"
              >
                <MessageCircle className="h-4 w-4" />
                {t('footer.links.discord')}
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="mx-auto mt-10 max-w-7xl border-t border-border pt-6 font-mono text-[11px] uppercase tracking-[0.12em] text-text-muted">
        {t('footer.rights', { year: new Date().getFullYear() })}
      </div>
    </footer>
  )
}

export default function WelcomePage() {
  const { t } = useTranslation('welcome')
  const navigate = useNavigate()
  const stats = usePublicStats()
  const developersCount = stats.data?.users_count ?? 0
  const reduced = useReducedMotion()

  useEffect(() => {
    document.body.classList.add('v2')
    // smooth scroll для anchor-links в навигации
    const prev = document.documentElement.style.scrollBehavior
    document.documentElement.style.scrollBehavior = 'smooth'
    return () => {
      document.body.classList.remove('v2')
      document.documentElement.style.scrollBehavior = prev
    }
  }, [])

  const heroMotion = reduced
    ? {}
    : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } }

  const features: FeatureKey[] = ['pvp', 'ai', 'daily', 'guilds', 'atlas', 'podcasts']
  const testimonials = t('testimonials.items', { returnObjects: true }) as Testimonial[]

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <MinimalTopBar />

      {/* Wave-13 — Promo banner for the new Copilot desktop product. Sits
          above the hero so first-time visitors discover Copilot before they
          scroll. Keep it ABOVE motion-animation so it appears instantly
          (no fade-in delay competing with hero animation). */}
      <div className="mx-auto w-full max-w-[1200px] px-4 pt-5 sm:px-8 lg:px-20">
        <CopilotPromoBanner variant="hero" />
      </div>

      {/* HERO */}
      <main className="relative overflow-hidden">
        {/* фоновые цветные пятна — мягкий violet→cyan glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-[-120px] -z-10 mx-auto h-[520px] max-w-[1400px] opacity-60 blur-[120px]"
          style={{
            background:
              'radial-gradient(40% 50% at 30% 50%, rgba(88,44,255,0.35) 0%, transparent 70%), radial-gradient(35% 45% at 70% 60%, rgba(34,211,238,0.28) 0%, transparent 70%)',
          }}
        />
        <motion.div
          {...heroMotion}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="flex flex-col items-center justify-center gap-7 px-4 pb-16 pt-10 sm:px-8 lg:px-20 lg:pb-24 lg:pt-[60px]"
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
            style={{
              fontSize: 'clamp(40px, 9vw, 80px)',
              lineHeight: 1.05,
              letterSpacing: '-0.03em',
              maxWidth: 1200,
              fontWeight: 800,
            }}
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
              background: BRAND_GRADIENT,
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
              <TrustLogo name="T-BANK" />
            </div>
          </div>
        </motion.div>
      </main>

      {/* FEATURES */}
      <FadeInSection
        id="features"
        className="border-t border-border px-4 py-20 sm:px-8 lg:px-20"
      >
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 max-w-3xl">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-cyan">
              {t('features.eyebrow')}
            </div>
            <h2 className="mb-4 font-display text-[36px] font-extrabold leading-tight text-text-primary lg:text-[44px]">
              {t('features.title')}
            </h2>
            <p className="text-[16px] leading-relaxed text-text-secondary">
              {t('features.subtitle')}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((k) => (
              <FeatureCard key={k} k={k} />
            ))}
          </div>
        </div>
      </FadeInSection>

      {/* STATS — реальные backend numbers */}
      <FadeInSection
        id="stats"
        className="border-t border-border bg-surface-1 px-4 py-20 sm:px-8 lg:px-20"
      >
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 text-center">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-cyan">
              {t('stats.eyebrow')}
            </div>
            <h2 className="mb-4 font-display text-[36px] font-extrabold leading-tight text-text-primary lg:text-[44px]">
              {t('stats.title')}
            </h2>
            <p className="mx-auto max-w-2xl text-[16px] leading-relaxed text-text-secondary">
              {t('stats.subtitle')}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <StatCard
              value={formatStat(stats.data?.users_count, stats.isLoading, t('stats.loading'))}
              label={t('stats.users')}
            />
            <StatCard
              value={formatStat(stats.data?.active_today, stats.isLoading, t('stats.loading'))}
              label={t('stats.active')}
            />
            <StatCard
              value={formatStat(stats.data?.matches_total, stats.isLoading, t('stats.loading'))}
              label={t('stats.matches')}
            />
          </div>
        </div>
      </FadeInSection>

      {/* TESTIMONIALS */}
      <FadeInSection
        id="testimonials"
        className="border-t border-border px-4 py-20 sm:px-8 lg:px-20"
      >
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 max-w-3xl">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-cyan">
              {t('testimonials.eyebrow')}
            </div>
            <h2 className="mb-4 font-display text-[36px] font-extrabold leading-tight text-text-primary lg:text-[44px]">
              {t('testimonials.title')}
            </h2>
            <p className="text-[14px] italic leading-relaxed text-text-muted">
              {t('testimonials.subtitle')}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {testimonials.map((item) => (
              <TestimonialCard key={item.name} item={item} />
            ))}
          </div>
        </div>
      </FadeInSection>

      {/* PRICING */}
      <FadeInSection
        id="pricing"
        className="border-t border-border bg-surface-1 px-4 py-20 sm:px-8 lg:px-20"
      >
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 text-center">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-cyan">
              {t('pricing.eyebrow')}
            </div>
            <h2 className="mb-4 font-display text-[36px] font-extrabold leading-tight text-text-primary lg:text-[44px]">
              {t('pricing.title')}
            </h2>
            <p className="mx-auto max-w-2xl text-[16px] leading-relaxed text-text-secondary">
              {t('pricing.subtitle')}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <PricingCard tier="free" href="/login" />
            <PricingCard tier="premium" highlighted href="/settings" />
            <PricingCard tier="pro" href="/settings" />
          </div>
        </div>
      </FadeInSection>

      {/* FINAL CTA */}
      <FadeInSection className="relative overflow-hidden border-t border-border px-4 py-24 sm:px-8 lg:px-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 opacity-60 blur-[120px]"
          style={{
            background:
              'radial-gradient(40% 60% at 50% 50%, rgba(88,44,255,0.35) 0%, transparent 70%)',
          }}
        />
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
          <h2
            className="font-display text-[36px] font-extrabold leading-tight lg:text-[52px]"
            style={{
              background: BRAND_GRADIENT,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {t('final_cta.title')}
          </h2>
          <p className="max-w-xl text-[16px] leading-relaxed text-text-secondary">
            {t('final_cta.subtitle')}
          </p>
          <div className="mt-2 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4">
            <Link to="/login" className="w-full sm:w-auto">
              <Button
                variant="primary"
                iconRight={<ArrowRight className="h-5 w-5" />}
                className="h-14 w-full justify-center px-7 text-[15px] shadow-glow sm:w-auto"
              >
                {t('final_cta.primary')}
              </Button>
            </Link>
            <Button
              variant="ghost"
              icon={<Play className="h-4 w-4" />}
              className="h-14 w-full justify-center px-6 text-[15px] sm:w-auto"
              onClick={() => navigate('/welcome/demo')}
            >
              {t('final_cta.secondary')}
            </Button>
          </div>
        </div>
      </FadeInSection>

      <Footer />
    </div>
  )
}
