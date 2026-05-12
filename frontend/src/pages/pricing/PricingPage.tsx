// /pricing — public 3-plan comparison + FAQ (Wave-11).
//
// Public route: рендерится и для гостей, и для авторизованных. Не дёргаем
// /profile/me, чтобы не вызывать 401-loop у неавторизованных. Ссылки на
// checkout — наоборот, ведут через /checkout?plan=...&period=..., и уже
// CheckoutPage сам разрулит «нужен логин».
//
// Anti-pattern budget: 0 timer-pressure, 0 «осталось 4 места», 0 dark
// patterns.
//
// 2026-05-12: v2 visual language — hairline plan cards (no warn/pink
// gradient tint, no success bg), opacity stratification for emphasis,
// red signal stripe on emphasised plan (Pro), letter-spacing 0.08em
// canonical, motion-tokens for transitions.

import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, X, ChevronDown, Info } from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { Card } from '../../components/Card'
import { cn } from '../../lib/cn'
import { readAccessToken } from '../../lib/apiClient'
import { PRICE_TABLE, type BillingPeriod, type BillingPlanTier } from '../../lib/queries/billing'
import { ANALYTICS_EVENTS, analytics } from '../../lib/analytics'

const PERIOD_KEY = 'druz9_pricing_period'

type PlanCardData = {
  tier: BillingPlanTier
  name: string
  tagline: string
  cta: string
  /** Emphasis stratifies via opacity + signal stripe, NOT hue. */
  emphasis: 'normal' | 'emphasised' | 'top'
}

const PLANS: PlanCardData[] = [
  {
    tier: 'free',
    name: 'Free',
    tagline: 'Начни без оплаты — посмотри, как это работает',
    cta: 'Сейчас на этом тарифе',
    emphasis: 'normal',
  },
  {
    tier: 'pro',
    name: 'Pro',
    tagline: 'AI Coach без лимитов + полный атлас навыков',
    cta: 'Подключить Pro',
    emphasis: 'emphasised',
  },
  {
    tier: 'max',
    name: 'Max',
    tagline: 'Для тех, кто готовится плотно: всё Pro + voice mock + приоритет',
    cta: 'Подключить Max',
    emphasis: 'top',
  },
]

type FeatureRow = {
  label: string
  values: Record<BillingPlanTier, string | boolean>
}

const FEATURES: FeatureRow[] = [
  {
    label: 'Daily kata',
    values: { free: '1 / день', pro: 'без лимита', max: 'без лимита' },
  },
  {
    label: 'Arena (PvP-матчи)',
    values: { free: '5 / неделя', pro: 'без лимита', max: 'без лимита' },
  },
  {
    label: 'AI Coach (премиум-модели)',
    values: { free: false, pro: true, max: true },
  },
  {
    label: 'Voice mock-interview',
    values: { free: false, pro: false, max: true },
  },
  {
    label: 'Приоритетная поддержка',
    values: { free: false, pro: false, max: true },
  },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Можно ли отменить подписку в любой момент?',
    a: 'Да. Доступ сохраняется до конца уже оплаченного периода — никаких удержаний и автоматических списаний после отмены.',
  },
  {
    q: 'Что произойдёт с моим прогрессом, если я перестану платить?',
    a: 'Ничего. Атлас, ачивки, история матчей — твои навсегда. Premium-фичи (AI Coach на больших моделях, voice mock) выключатся, но базовый функционал остаётся.',
  },
  {
    q: 'Есть ли пробный период?',
    a: 'Нет. Мы решили честно показать цену сразу, без trial-ловушки. Free-тариф полностью функционален — пробуй сколько нужно.',
  },
  {
    q: 'Какие способы оплаты доступны?',
    a: 'Карта (Visa / MC / МИР), Apple Pay, Google Pay, СБП и Tinkoff. Чек придёт на email, можно скачать PDF из /settings/billing.',
  },
  {
    q: 'А если я учусь / без работы?',
    a: 'Напиши на support — выдаём 50% скидку студентам и людям между работами. Это не публичный купон, потому что мы предпочитаем разговор, а не дисконт-фарм.',
  },
]

function readPeriod(): BillingPeriod {
  try {
    const raw = localStorage.getItem(PERIOD_KEY)
    if (raw === 'annual' || raw === 'monthly') return raw
  } catch {
    /* noop */
  }
  return 'monthly'
}

function writePeriod(p: BillingPeriod) {
  try {
    localStorage.setItem(PERIOD_KEY, p)
  } catch {
    /* noop */
  }
}

function formatRub(amount: number, period: BillingPeriod): string {
  if (amount === 0) return '0 ₽'
  if (period === 'annual') {
    const monthly = Math.round(amount / 12)
    return `${monthly} ₽/мес`
  }
  return `${amount} ₽/мес`
}

export default function PricingPage() {
  const [period, setPeriod] = useState<BillingPeriod>(readPeriod())
  const [params] = useSearchParams()
  // Wave 5 (2026-05-12) — Stripe cancel_url полирован. ?retry=true →
  // показываем subtle banner. Не auto-restart'аем checkout — юзер сам
  // решит, попробует другую карту или передумает.
  const retry = params.get('retry') === 'true'

  useEffect(() => writePeriod(period), [period])
  // Emit cancel analytics один раз на mount если ?retry=true. dedup'и
  // дальше делает sessionStorage flag — F5 страницы не плодит дубликаты.
  useEffect(() => {
    if (!retry) return
    try {
      const fired = window.sessionStorage.getItem('druz9:checkout-cancel-emitted')
      if (fired === '1') return
      window.sessionStorage.setItem('druz9:checkout-cancel-emitted', '1')
    } catch {
      /* private mode — emit anyway */
    }
    analytics.track(ANALYTICS_EVENTS.checkout_cancelled, { source: 'stripe_cancel_url' })
  }, [retry])

  // Public route: гости видят минимальный shell без AppShellV2 (он дёргает
  // /admin/dashboard, что для гостей даст 401 → redirect на /login). Для
  // залогиненных — обычный shell с навигацией.
  const isAuthed = !!readAccessToken()

  const body = (
    <div className="mx-auto flex max-w-7xl flex-col gap-12 px-4 py-10 sm:px-8 lg:px-20 lg:py-16">
      {retry && <RetryBanner />}
      <Header period={period} setPeriod={setPeriod} />
      <PlanGrid period={period} />
      <ComparisonTable />
      <FaqSection />
    </div>
  )

  if (isAuthed) return <AppShellV2>{body}</AppShellV2>
  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <header className="sticky top-0 z-40 flex h-[64px] items-center border-b border-border bg-bg px-4 sm:px-6 lg:h-[72px] lg:px-8">
        <Link to="/welcome" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-2 border border-border-strong font-display text-lg font-extrabold text-text-primary">
            9
          </span>
          <span className="font-display text-lg font-bold text-text-primary">druz9</span>
        </Link>
        <Link
          to="/login"
          className="ml-auto rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[13px] font-semibold text-text-primary hover:border-border-strong"
        >
          Войти
        </Link>
      </header>
      {body}
    </div>
  )
}

// RetryBanner — subtle информер для Stripe-cancel'нувшегося юзера.
// Не auto-restart'ит checkout: дать юзеру выбор (другая карта, BYOK, ничего).
// B/W only: одна 1.5px красная полоска слева как signal stripe.
function RetryBanner() {
  return (
    <div
      role="status"
      className="relative flex flex-col items-start gap-2 rounded-md border border-border-strong bg-surface-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      style={{ minWidth: 0 }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 1.5,
          height: 24,
          background: 'var(--red)',
        }}
      />
      <div className="flex items-start gap-3" style={{ minWidth: 0 }}>
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" />
        <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-primary">
            checkout cancelled
          </span>
          <span className="text-[12.5px] leading-relaxed text-text-secondary">
            Оплата не была завершена. Можно попробовать снова — или подключить свой LLM-ключ (BYOK)
            и получить Pro без подписки.
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 self-stretch sm:self-auto">
        <Link
          to="/profile/settings"
          className="rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-primary transition-colors hover:border-border-strong"
          style={{
            transition: 'border-color var(--motion-dur-small) var(--motion-ease-standard)',
          }}
        >
          BYOK alternative
        </Link>
        <a
          href="mailto:support@druz9.app?subject=Не%20прошла%20оплата"
          className="rounded-md border border-border bg-bg px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-text-primary transition-colors hover:border-border-strong"
          style={{
            transition: 'border-color var(--motion-dur-small) var(--motion-ease-standard)',
          }}
        >
          Связаться с поддержкой
        </a>
      </div>
    </div>
  )
}

function Header({ period, setPeriod }: { period: BillingPeriod; setPeriod: (p: BillingPeriod) => void }) {
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
        тарифы
      </span>
      <h1 className="font-display text-3xl font-bold leading-[1.1] text-text-primary lg:text-[40px]">
        Один план — одна цель
      </h1>
      <p className="max-w-[560px] text-sm text-text-secondary">
        Никаких скрытых лимитов, trial-ловушек и навязчивых уведомлений. Free хватит, чтобы попробовать.
        Premium — если хочется AI без ограничений.
      </p>
      <PeriodToggle period={period} setPeriod={setPeriod} />
    </div>
  )
}

function PeriodToggle({
  period,
  setPeriod,
}: {
  period: BillingPeriod
  setPeriod: (p: BillingPeriod) => void
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-1 p-1">
      <button
        type="button"
        onClick={() => setPeriod('monthly')}
        className={cn(
          'rounded-full px-4 py-1.5 text-[13px] font-semibold',
          'transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)]',
          period === 'monthly' ? 'bg-text-primary text-bg' : 'text-text-secondary hover:text-text-primary',
        )}
      >
        Помесячно
      </button>
      <button
        type="button"
        onClick={() => setPeriod('annual')}
        className={cn(
          'flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-semibold',
          'transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)]',
          period === 'annual' ? 'bg-text-primary text-bg' : 'text-text-secondary hover:text-text-primary',
        )}
      >
        Годовая
        <span className="rounded-full border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.08em] text-text-primary">
          −20%
        </span>
      </button>
    </div>
  )
}

function PlanGrid({ period }: { period: BillingPeriod }) {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {PLANS.map((plan) => (
        <PlanCard key={plan.tier} plan={plan} period={period} />
      ))}
    </div>
  )
}

function PlanCard({ plan, period }: { plan: PlanCardData; period: BillingPeriod }) {
  const price = PRICE_TABLE[plan.tier][period]
  const emphasis = plan.emphasis
  const stratified = emphasis !== 'normal'
  return (
    <Card
      className={cn(
        'relative flex-col gap-5 p-6',
        stratified && 'border-border-strong',
      )}
    >
      {emphasis === 'top' && (
        <span
          aria-hidden="true"
          className="absolute top-6 right-6 inline-block"
          style={{ width: 24, height: 1.5, background: 'var(--red)' }}
        />
      )}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-xl font-bold text-text-primary">{plan.name}</h3>
          <span className="text-[12px] text-text-secondary">{plan.tagline}</span>
        </div>
        {emphasis === 'top' && (
          <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-text-primary">
            популярный
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-display text-5xl font-extrabold leading-none text-text-primary">
          {plan.tier === 'free' ? '0 ₽' : formatRub(price, period)}
        </span>
        {plan.tier !== 'free' && period === 'annual' && (
          <span className="font-mono text-[11px] tracking-[0.08em] text-text-muted">
            {price} ₽ в год
          </span>
        )}
      </div>

      {plan.tier === 'free' ? (
        <button
          type="button"
          disabled
          className="h-10 rounded-lg border border-border bg-surface-2 px-4 text-[14px] font-semibold text-text-muted"
        >
          {plan.cta}
        </button>
      ) : (
        <Link
          to={`/checkout?plan=${plan.tier}&period=${period}`}
          className={cn(
            'flex h-10 items-center justify-center rounded-lg px-4 text-[14px] font-semibold',
            'transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)]',
            'bg-text-primary text-bg hover:bg-text-primary-hover',
          )}
        >
          {plan.cta}
        </Link>
      )}

      <ul className="flex flex-col gap-2 text-[13px] text-text-secondary">
        {FEATURES.map((f) => {
          const v = f.values[plan.tier]
          return (
            <li key={f.label} className="flex items-center gap-2">
              {v === false ? (
                <X className="h-4 w-4 shrink-0 text-text-muted" />
              ) : (
                <Check className="h-4 w-4 shrink-0 text-text-primary" strokeWidth={3} />
              )}
              <span className="flex-1">{f.label}</span>
              {typeof v === 'string' && (
                <span className="font-mono text-[11px] tracking-[0.08em] text-text-muted">{v}</span>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function ComparisonTable() {
  return (
    <div className="flex flex-col gap-5">
      <h2 className="font-display text-2xl font-bold text-text-primary">Что входит в каждый тариф</h2>
      <Card className="flex-col gap-0 p-0">
        <div className="grid grid-cols-4 border-b border-border px-6 py-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          <div>Возможность</div>
          <div className="text-center">Free</div>
          <div className="text-center text-text-primary">Pro</div>
          <div className="text-center text-text-secondary">Max</div>
        </div>
        {FEATURES.map((row, i) => (
          <div
            key={row.label}
            className={cn(
              'grid grid-cols-4 items-center px-6 py-3.5',
              i < FEATURES.length - 1 && 'border-b border-border',
            )}
          >
            <div className="text-[13px] font-semibold text-text-primary">{row.label}</div>
            {(['free', 'pro', 'max'] as BillingPlanTier[]).map((t) => {
              const v = row.values[t]
              return (
                <div key={t} className="text-center">
                  {v === false ? (
                    <X className="mx-auto h-4 w-4 text-text-muted" />
                  ) : v === true ? (
                    <Check className="mx-auto h-4 w-4 text-text-primary" strokeWidth={3} />
                  ) : (
                    <span className="font-mono text-[12px] tracking-[0.08em] text-text-secondary">{v}</span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </Card>
    </div>
  )
}

function FaqSection() {
  const [open, setOpen] = useState<number>(0)
  return (
    <div className="flex flex-col gap-5">
      <h2 className="font-display text-2xl font-bold text-text-primary">Частые вопросы</h2>
      <div className="flex flex-col gap-2.5">
        {FAQ.map((item, i) => {
          const isOpen = open === i
          return (
            <Card key={item.q} className="flex-col gap-0 p-0">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? -1 : i)}
                className="flex items-center justify-between gap-4 px-5 py-4 text-left"
                aria-expanded={isOpen}
              >
                <span className="text-[14px] font-semibold text-text-primary">{item.q}</span>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 shrink-0 text-text-muted',
                    'transition-transform duration-[var(--motion-dur-small)] ease-[var(--motion-ease-standard)]',
                    isOpen && 'rotate-180',
                  )}
                />
              </button>
              {isOpen && (
                <div className="border-t border-border px-5 py-4 text-[13px] leading-relaxed text-text-secondary">
                  {item.a}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
