// /pricing — public 3-plan comparison + FAQ (Wave-11).
//
// Public route: рендерится и для гостей, и для авторизованных. Не дёргаем
// /profile/me, чтобы не вызывать 401-loop у неавторизованных. Ссылки на
// checkout — наоборот, ведут через /checkout?plan=...&period=..., и уже
// CheckoutPage сам разрулит «нужен логин».
//
// Anti-pattern budget: 0 timer-pressure, 0 «осталось 4 места», 0 dark
// patterns. Premium = warn-gold (per _rules.md), Pro = warn→pink gradient.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, X, ChevronDown } from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { Card } from '../../components/Card'
import { cn } from '../../lib/cn'
import { readAccessToken } from '../../lib/apiClient'
import { PRICE_TABLE, type BillingPeriod, type BillingPlanTier } from '../../lib/queries/billing'

const PERIOD_KEY = 'druz9_pricing_period'

type PlanCardData = {
  tier: BillingPlanTier
  name: string
  tagline: string
  cta: string
  emphasis: 'normal' | 'warn' | 'warn-pink'
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
    tier: 'premium',
    name: 'Premium',
    tagline: 'AI Coach без лимитов + полный атлас навыков',
    cta: 'Подключить Premium',
    emphasis: 'warn',
  },
  {
    tier: 'pro',
    name: 'Pro',
    tagline: 'Для тех, кто готовится плотно: всё Premium + voice mock + приоритет',
    cta: 'Подключить Pro',
    emphasis: 'warn-pink',
  },
]

type FeatureRow = {
  label: string
  values: Record<BillingPlanTier, string | boolean>
}

const FEATURES: FeatureRow[] = [
  {
    label: 'Daily kata',
    values: { free: '1 / день', premium: 'без лимита', pro: 'без лимита' },
  },
  {
    label: 'Arena (PvP-матчи)',
    values: { free: '5 / неделя', premium: 'без лимита', pro: 'без лимита' },
  },
  {
    label: 'AI Coach (премиум-модели)',
    values: { free: false, premium: true, pro: true },
  },
  {
    label: 'Voice mock-interview',
    values: { free: false, premium: false, pro: true },
  },
  {
    label: 'Приоритетная поддержка',
    values: { free: false, premium: false, pro: true },
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
  useEffect(() => writePeriod(period), [period])

  // Public route: гости видят минимальный shell без AppShellV2 (он дёргает
  // /admin/dashboard, что для гостей даст 401 → redirect на /login). Для
  // залогиненных — обычный shell с навигацией.
  const isAuthed = !!readAccessToken()

  const body = (
    <div className="mx-auto flex max-w-7xl flex-col gap-12 px-4 py-10 sm:px-8 lg:px-20 lg:py-16">
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

function Header({ period, setPeriod }: { period: BillingPeriod; setPeriod: (p: BillingPeriod) => void }) {
  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
        тарифы
      </span>
      <h1 className="font-display text-3xl font-bold leading-[1.1] text-text-primary lg:text-[40px]">
        Один план — одна{' '}
        <span className="bg-surface-2 border border-border-strong bg-clip-text text-transparent">
          цель
        </span>
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
          'rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors',
          period === 'monthly' ? 'bg-text-primary text-text-primary' : 'text-text-secondary hover:text-text-primary',
        )}
      >
        Помесячно
      </button>
      <button
        type="button"
        onClick={() => setPeriod('annual')}
        className={cn(
          'flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors',
          period === 'annual' ? 'bg-text-primary text-text-primary' : 'text-text-secondary hover:text-text-primary',
        )}
      >
        Годовая
        <span className="rounded-full bg-success/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-success">
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
  return (
    <Card
      className={cn(
        'flex-col gap-5 p-6',
        emphasis === 'warn' && 'border-warn/40 bg-gradient-to-br from-warn/10 to-transparent',
        emphasis === 'warn-pink' && 'border-warn/50 bg-gradient-to-br from-warn/15 via-pink/5 to-transparent',
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h3 className="font-display text-xl font-bold text-text-primary">{plan.name}</h3>
          <span className="text-[12px] text-text-secondary">{plan.tagline}</span>
        </div>
        {emphasis === 'warn-pink' && (
          <span className="rounded-md bg-text-primary/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-text-secondary">
            популярный
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-display text-5xl font-extrabold leading-none text-text-primary">
          {plan.tier === 'free' ? '0 ₽' : formatRub(price, period)}
        </span>
        {plan.tier !== 'free' && period === 'annual' && (
          <span className="font-mono text-[11px] text-text-muted">
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
            'flex h-10 items-center justify-center rounded-lg px-4 text-[14px] font-semibold transition-colors',
            'bg-text-primary text-text-primary hover:bg-text-primary-hover',
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
                <Check className="h-4 w-4 shrink-0 text-success" strokeWidth={3} />
              )}
              <span className="flex-1">{f.label}</span>
              {typeof v === 'string' && (
                <span className="font-mono text-[11px] text-text-muted">{v}</span>
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
        <div className="grid grid-cols-4 border-b border-border px-6 py-3 text-[12px] font-semibold uppercase tracking-wider text-text-muted">
          <div>Возможность</div>
          <div className="text-center">Free</div>
          <div className="text-center text-warn">Premium</div>
          <div className="text-center text-text-secondary">Pro</div>
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
            {(['free', 'premium', 'pro'] as BillingPlanTier[]).map((t) => {
              const v = row.values[t]
              return (
                <div key={t} className="text-center">
                  {v === false ? (
                    <X className="mx-auto h-4 w-4 text-text-muted" />
                  ) : v === true ? (
                    <Check className="mx-auto h-4 w-4 text-success" strokeWidth={3} />
                  ) : (
                    <span className="font-mono text-[12px] text-text-secondary">{v}</span>
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
                    'h-4 w-4 shrink-0 text-text-muted transition-transform',
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
