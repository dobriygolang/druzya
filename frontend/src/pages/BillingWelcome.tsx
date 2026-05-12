// /billing/welcome — Stripe Checkout вернул сюда после успешной оплаты
// (wave 4 / S Stripe enhancements, success_url из BillingTab.tsx).
//
// Flow:
//   1. Stripe редиректит на /billing/welcome?session_id={CHECKOUT_SESSION_ID}.
//   2. useCheckoutSessionQuery() стучится в /subscription/checkout-session/<id>
//      (Redis-cached 60s на бэке). Без session_id → redirect на /today.
//   3. paid=true → instant welcome screen.
//   4. paid=false (webhook latency) → «Confirming...» с polling 3s.
//   5. error / invalid id → «Subscription is processing, refresh in a moment»
//      + retry CTA на /upgrade.
//
// Routing: не за auth-wall (Stripe мог отправить юзера без сохранённой
// session-cookie'и). Backend endpoint owner-binding делает best-effort
// через client_reference_id — sufficient gating для welcome screen'а.
//
// Analytics: emit `checkout.completed` один раз когда paid=true становится
// true (защита от duplicate emit'ов через useRef).
//
// B/W only: единственный red'и accent — 1.5px stripe слева у success-cards
// (signal для Pro plan), без bg/fill/gradient.

import { useEffect, useRef } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Sparkles, Loader, AlertCircle, Mic, Calendar, Download } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { readAccessToken } from '../lib/apiClient'
import { useCheckoutSessionQuery } from '../lib/queries/stripeCheckout'
import { useTierQuery } from '../lib/queries/tier'
import { ANALYTICS_EVENTS, analytics } from '../lib/analytics'

const UNLOCKED: { icon: typeof Check; label: string }[] = [
  { icon: Check, label: 'Безлимит AI-mock pipelines (все 5 стадий, любая компания)' },
  { icon: Check, label: 'Premium Cue personas + 8h live-сессии' },
  { icon: Check, label: 'Google Calendar sync — events в /today + Hone Dock' },
  { icon: Check, label: 'Приоритетный LLM cascade (groq / cerebras / claude)' },
  { icon: Check, label: 'Deep readiness analytics — расширенный radar + drift' },
]

type NextAction = {
  to: string
  icon: typeof Check
  title: string
  body: string
  ctaLabel: string
  // external = render как <a href> вместо <Link>.
  external?: boolean
}

const NEXT_ACTIONS_BASE: NextAction[] = [
  {
    to: '/mock',
    icon: Mic,
    title: 'Запустить mock pipeline',
    body: 'Полный 5-stage прогон по любой компании. Pro открыл безлимит — попробуй системный дизайн.',
    ctaLabel: 'К /mock',
  },
  {
    to: '/profile/settings',
    icon: Calendar,
    title: 'Connect Google Calendar',
    body: 'События дня в /today + auto-block focus-таймеров в Hone. Подключение в Settings → Integrations.',
    ctaLabel: 'Settings → Integrations',
  },
]

// HONE_DMG_URL — placeholder. Когда CI начнёт публиковать билды, заменить
// на актуальную ссылку (или зачитывать из ConfigService).
// TODO: hardcoded URL → читать из BackgroundService / dynamic config.
const HONE_DMG_URL = 'https://druz9.online/download/hone-latest.dmg'

export default function BillingWelcome() {
  const [params] = useSearchParams()
  const sessionId = params.get('session_id')
  // F. Edge: missing session_id → редиректим к /today (если залогинен) или
  // /pricing (если нет токена — welcome без session делать нечего).
  if (!sessionId) {
    const fallback = readAccessToken() ? '/today' : '/pricing'
    return <Navigate to={fallback} replace />
  }

  return <WelcomeBody sessionId={sessionId} />
}

function WelcomeBody({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate()
  const session = useCheckoutSessionQuery(sessionId)
  const tier = useTierQuery()
  const emittedRef = useRef(false)

  // F. Edge: invalid session_id (Stripe 404 / endpoint disabled) → редирект
  // на /upgrade с retry banner после короткого таймаута. Не делаем instant
  // redirect — даём fetch'у шанс восстановиться (1 retry в useQuery).
  useEffect(() => {
    if (!session.isError) return
    const t = setTimeout(() => navigate('/upgrade?retry=true', { replace: true }), 4_000)
    return () => clearTimeout(t)
  }, [session.isError, navigate])

  // G. Analytics — emit один раз когда впервые видим paid=true.
  useEffect(() => {
    if (emittedRef.current) return
    if (!session.data?.paid) return
    emittedRef.current = true
    analytics.track(ANALYTICS_EVENTS.checkout_completed, {
      session_id: sessionId,
      currency: session.data.currency || 'rub',
      tier: session.data.tier || 'pro',
    })
  }, [session.data, sessionId])

  // F. Webhook delay — refetch tier-info периодически пока он не станет pro
  // (paid тиражируется через webhook). useCheckoutSessionQuery уже polls
  // backend endpoint; здесь форсим tier refetch когда payment confirmed.
  useEffect(() => {
    if (!session.data?.paid) return
    if (tier.data?.source === 'pro' || tier.data?.source === 'byok') return
    const id = setInterval(() => void tier.refetch(), 4_000)
    // Защита от infinite spin: остановиться через 30s — UI всё равно
    // покажет welcome, дальше /today flip'нется на natural mount.
    const stop = setTimeout(() => clearInterval(id), 30_000)
    return () => {
      clearInterval(id)
      clearTimeout(stop)
    }
  }, [session.data?.paid, tier])

  // Loading state — initial Stripe fetch ещё идёт.
  if (session.isPending) {
    return (
      <AppShellV2>
        <CenterShell>
          <SpinnerState label="Подтверждаем оплату..." sub="Стучимся в Stripe — несколько секунд." />
        </CenterShell>
      </AppShellV2>
    )
  }

  // F. Edge: error (404 / 503 / network) → soft fallback. После таймаута
  // useEffect выше редиректит на /upgrade?retry=true.
  if (session.isError) {
    return (
      <AppShellV2>
        <CenterShell>
          <ErrorState />
        </CenterShell>
      </AppShellV2>
    )
  }

  const data = session.data
  // F. Edge: paid=false → confirming с polling. Пользователь видит spinner
  // + объяснение, но НЕ ошибку — это normal Stripe latency. refetchInterval
  // в useCheckoutSessionQuery polls раз в 3s пока не paid.
  if (!data?.paid) {
    return (
      <AppShellV2>
        <CenterShell>
          <SpinnerState
            label="Confirming..."
            sub="Stripe подтвердил оплату, осталось дождаться webhook (обычно 1-3 секунды)."
          />
        </CenterShell>
      </AppShellV2>
    )
  }

  return (
    <AppShellV2>
      <div className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-12 sm:px-8 lg:py-16 hone-fadein">
        <Hero email={data.customer_email} />
        <UnlockedCard />
        <NextActionsGrid />
        <Footer email={data.customer_email} />
      </div>
    </AppShellV2>
  )
}

function CenterShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-4 px-4 py-12 text-center sm:px-8">
      {children}
    </div>
  )
}

function SpinnerState({ label, sub }: { label: string; sub: string }) {
  return (
    <>
      <Loader className="h-8 w-8 animate-spin text-text-primary" />
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
        обработка платежа
      </span>
      <h1 className="font-display text-xl font-bold text-text-primary lg:text-2xl">{label}</h1>
      <p className="max-w-[420px] text-[13px] text-text-secondary">{sub}</p>
    </>
  )
}

function ErrorState() {
  return (
    <>
      <AlertCircle className="h-8 w-8" style={{ color: 'var(--red)' }} />
      <span
        className="font-mono text-[11px] uppercase tracking-[0.08em]"
        style={{ color: 'var(--red)' }}
      >
        не удалось получить детали
      </span>
      <h1 className="font-display text-xl font-bold text-text-primary lg:text-2xl">
        Subscription is processing
      </h1>
      <p className="max-w-[440px] text-[13px] text-text-secondary">
        Если деньги списали — Pro будет активен в течение минуты. Обнови страницу через 30 секунд
        или вернись к выбору тарифа.
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Link to="/today">
          <Button variant="ghost" size="md">
            К /today
          </Button>
        </Link>
        <Link to="/upgrade?retry=true">
          <Button variant="primary" size="md">
            Попробовать снова
          </Button>
        </Link>
      </div>
    </>
  )
}

function Hero({ email }: { email?: string }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-text-primary/15 ring-4 ring-text-primary/10">
        <Check className="h-8 w-8 text-text-primary" strokeWidth={3} />
      </div>
      <span
        className="font-mono text-[11px] uppercase tracking-[0.08em]"
        style={{ color: 'rgb(var(--ink))' }}
      >
        подписка активна
      </span>
      <h1 className="font-display text-3xl font-bold leading-[1.05] text-text-primary lg:text-[44px]">
        Welcome to{' '}
        <span className="rounded-md bg-text-primary/15 px-2 py-0.5 font-mono text-[16px] font-bold uppercase tracking-[0.08em] text-text-primary align-middle lg:text-[18px]">
          druz9 Pro
        </span>
      </h1>
      <p className="max-w-[520px] text-sm leading-relaxed text-text-secondary">
        Подписка активна. Pro features unlocked — без лимитов на AI-coach, полный mock-pipeline,
        deep analytics, priority LLM cascade.
      </p>
      {email && (
        <p className="font-mono text-[11px] text-text-muted">
          чек придёт на <span className="text-text-secondary">{email}</span>
        </p>
      )}
    </div>
  )
}

function UnlockedCard() {
  return (
    <Card className="relative flex-col gap-4 p-6 lg:p-8">
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 1.5,
          height: 32,
          background: 'var(--red)',
        }}
      />
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-text-secondary" />
        <h3 className="font-display text-lg font-bold text-text-primary">Что открылось</h3>
      </div>
      <ul className="flex flex-col gap-2.5">
        {UNLOCKED.map(({ icon: Icon, label }) => (
          <li
            key={label}
            className="flex items-start gap-3 text-[13px] leading-relaxed text-text-secondary"
            style={{ minWidth: 0 }}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-primary" strokeWidth={3} />
            <span style={{ minWidth: 0 }}>{label}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function NextActionsGrid() {
  // Hone install detection — best-effort через ?hone-installed query / window
  // global, но обычно мы этого не знаем на web side. Третья карточка
  // (Install Hone) показывается всегда — в худшем случае юзер кликает и
  // видит «у вас уже установлено».
  const honeCard: NextAction = {
    to: HONE_DMG_URL,
    icon: Download,
    title: 'Install Hone',
    body: 'Тихий desktop-кокпит: AI-план дня + фокус + заметки с auto-link. Pro фичи Hone тоже доступны.',
    ctaLabel: 'Скачать DMG',
    external: true,
  }
  const actions: NextAction[] = [...NEXT_ACTIONS_BASE, honeCard]

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-display text-lg font-bold text-text-primary">Куда дальше</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {actions.map((a) => (
          <ActionCard key={a.to} action={a} />
        ))}
      </div>
    </div>
  )
}

function ActionCard({ action }: { action: NextAction }) {
  const Icon = action.icon
  const content = (
    <Card
      interactive
      className="h-full flex-col gap-3 p-5"
      style={{ minWidth: 0 }}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-text-secondary" />
        <span className="font-display text-[15px] font-bold text-text-primary">{action.title}</span>
      </div>
      <p className="text-[13px] leading-relaxed text-text-secondary flex-1" style={{ minWidth: 0 }}>
        {action.body}
      </p>
      <span className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-text-primary">
        {action.ctaLabel} →
      </span>
    </Card>
  )
  if (action.external) {
    return (
      <a
        href={action.to}
        target="_blank"
        rel="noreferrer"
        className="block"
        style={{ minWidth: 0 }}
      >
        {content}
      </a>
    )
  }
  return (
    <Link to={action.to} className="block" style={{ minWidth: 0 }}>
      {content}
    </Link>
  )
}

function Footer({ email }: { email?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 border-t border-border pt-6 text-center">
      <p className="text-[12px] text-text-secondary">
        Invoice will be emailed{email ? ` to ${email}` : ' shortly'}. Stripe receipt — official,
        legal, корректно подходит для отчётности.
      </p>
      <p className="font-mono text-[11px] text-text-muted">
        управление подпиской ·{' '}
        <Link
          to="/profile/settings"
          className="text-text-secondary underline-offset-2 hover:underline"
        >
          /profile/settings
        </Link>{' '}
        · поддержка ·{' '}
        <a
          href="mailto:support@druz9.app"
          className="text-text-secondary underline-offset-2 hover:underline"
        >
          support@druz9.app
        </a>
      </p>
    </div>
  )
}
