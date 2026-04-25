// /checkout — оплата выбранного тарифа (Wave-11).
//
// Параметры из query-string: ?plan=premium|pro&period=monthly|annual.
// Если plan невалиден — редирект на /pricing.
//
// Backend на /billing/checkout пока не реализован — useCheckoutMutation
// возвращает синтетический success после 2с (см. queries/billing.ts).
// Сюда же добавлен debug shortcut: при подключении промокода `FAIL` — мы
// явно навигируем на /checkout/failure?reason=card-declined, чтобы вручную
// проверить failure-ветку без бэкенда.

import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import {
  CreditCard,
  Apple,
  Smartphone,
  Wallet,
  Building2,
  ArrowLeft,
} from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { cn } from '../../lib/cn'
import {
  PRICE_TABLE,
  useCheckoutMutation,
  type BillingPeriod,
  type BillingPlanTier,
  type PaymentMethodKind,
} from '../../lib/queries/billing'

type PaymentTile = {
  kind: PaymentMethodKind
  label: string
  Icon: typeof CreditCard
}

const METHODS: PaymentTile[] = [
  { kind: 'card', label: 'Карта', Icon: CreditCard },
  { kind: 'apple-pay', label: 'Apple Pay', Icon: Apple },
  { kind: 'google-pay', label: 'Google Pay', Icon: Smartphone },
  { kind: 'sbp', label: 'СБП', Icon: Wallet },
  { kind: 'tinkoff', label: 'Tinkoff', Icon: Building2 },
]

function isPlanTier(v: string | null): v is Exclude<BillingPlanTier, 'free'> {
  return v === 'premium' || v === 'pro'
}

function isPeriod(v: string | null): v is BillingPeriod {
  return v === 'monthly' || v === 'annual'
}

export default function CheckoutPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const planParam = params.get('plan')
  const periodParam = params.get('period')

  // Hooks MUST be called before any early return — react-hooks/rules-of-hooks
  // forbids conditional hook ordering. Compute the plan/price up front using
  // safe defaults; the JSX redirects out of an invalid plan AFTER all hooks
  // have run.
  const plan: Exclude<BillingPlanTier, 'free'> = isPlanTier(planParam) ? planParam : 'premium'
  const period: BillingPeriod = isPeriod(periodParam) ? periodParam : 'monthly'
  const price = PRICE_TABLE[plan][period]

  const [method, setMethod] = useState<PaymentMethodKind>('card')
  const [promo, setPromo] = useState('')
  const [promoStatus, setPromoStatus] = useState<'idle' | 'invalid' | 'valid'>('idle')
  const [agreed, setAgreed] = useState(false)
  const checkout = useCheckoutMutation()

  // Last hook in the function — must run BEFORE any early return so React
  // sees the same hook ordering on every render (rules-of-hooks).
  const totalLabel = useMemo(() => {
    let base = price
    if (promoStatus === 'valid') base = Math.round(base * 0.5)
    return base
  }, [price, promoStatus])

  // Now safe to early-return — no hooks below this line.
  if (!isPlanTier(planParam)) {
    return <Navigate to="/pricing" replace />
  }

  const onPromoBlur = () => {
    const code = promo.trim().toUpperCase()
    if (!code) {
      setPromoStatus('idle')
      return
    }
    // Заглушка validate-on-blur. TODO(api): POST /billing/promo/validate.
    // Honest UX: либо «применили», либо «такого кода нет» — без false hope.
    if (code === 'STUDENT50' || code === 'EARLY') {
      setPromoStatus('valid')
    } else {
      setPromoStatus('invalid')
    }
  }

  const onSubmit = () => {
    if (!agreed || checkout.isPending) return
    // Debug shortcut: промокод FAIL → имитируем failure-ветку.
    if (promo.trim().toUpperCase() === 'FAIL') {
      navigate('/checkout/failure?reason=card-declined', { replace: true })
      return
    }
    checkout.mutate(
      { plan, period, payment_method: method, promo_code: promo.trim() || undefined },
      {
        onSuccess: (res) => {
          if (res.status === 'success') {
            navigate('/checkout/success', { replace: true })
          } else {
            navigate(`/checkout/failure?reason=${encodeURIComponent(res.reason ?? 'unknown')}`, {
              replace: true,
            })
          }
        },
        onError: () => {
          navigate('/checkout/failure?reason=network', { replace: true })
        },
      },
    )
  }

  return (
    <AppShellV2>
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 sm:px-8 lg:px-20 lg:py-12">
        <div className="flex items-center gap-3">
          <Link
            to="/pricing"
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-text-muted hover:text-text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            К тарифам
          </Link>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
            оформление
          </span>
          <h1 className="font-display text-3xl font-bold leading-[1.1] text-text-primary lg:text-[40px]">
            Подключение{' '}
            <span className="text-text-primary">
              {plan === 'pro' ? 'Pro' : 'Premium'}
            </span>
          </h1>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="flex flex-col gap-5">
            <Card className="flex-col gap-4 p-6">
              <h3 className="font-display text-lg font-bold text-text-primary">Способ оплаты</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {METHODS.map((m) => {
                  const active = method === m.kind
                  const Icon = m.Icon
                  return (
                    <button
                      key={m.kind}
                      type="button"
                      onClick={() => setMethod(m.kind)}
                      className={cn(
                        'flex h-20 flex-col items-center justify-center gap-1.5 rounded-lg border p-3 transition-colors',
                        active
                          ? 'border-text-primary bg-text-primary/10'
                          : 'border-border bg-surface-1 hover:border-border-strong',
                      )}
                      aria-pressed={active}
                    >
                      <Icon className={cn('h-5 w-5', active ? 'text-text-primary' : 'text-text-secondary')} />
                      <span className="text-[12px] font-semibold text-text-primary">{m.label}</span>
                    </button>
                  )
                })}
              </div>
            </Card>

            <Card className="flex-col gap-4 p-6">
              <h3 className="font-display text-lg font-bold text-text-primary">Промокод</h3>
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  value={promo}
                  onChange={(e) => {
                    setPromo(e.target.value)
                    if (promoStatus !== 'idle') setPromoStatus('idle')
                  }}
                  onBlur={onPromoBlur}
                  placeholder="STUDENT50"
                  className={cn(
                    'h-10 rounded-lg border bg-surface-1 px-3 font-mono text-[13px] uppercase text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-text-primary/40',
                    promoStatus === 'invalid' && 'border-danger',
                    promoStatus === 'valid' && 'border-success',
                    promoStatus === 'idle' && 'border-border',
                  )}
                />
                {promoStatus === 'invalid' && (
                  <span className="font-mono text-[11px] text-danger">
                    Такого кода не существует
                  </span>
                )}
                {promoStatus === 'valid' && (
                  <span className="font-mono text-[11px] text-success">
                    Применён · −50%
                  </span>
                )}
              </div>
            </Card>

            <Card className="flex-col gap-4 p-6">
              <label className="flex items-start gap-3 text-[13px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-surface-1 accent-accent"
                />
                <span>
                  Согласен с{' '}
                  <a href="/legal/offer" className="text-text-primary underline">
                    офертой
                  </a>{' '}
                  и{' '}
                  <a href="/legal/privacy" className="text-text-primary underline">
                    политикой конфиденциальности
                  </a>
                  . Подписка продлевается автоматически — отменить можно в любой момент в /settings/billing.
                </span>
              </label>
            </Card>
          </div>

          <SidebarSummary
            plan={plan}
            period={period}
            total={totalLabel}
            method={method}
            agreed={agreed}
            onSubmit={onSubmit}
            isPending={checkout.isPending}
          />
        </div>
      </div>
    </AppShellV2>
  )
}

function SidebarSummary({
  plan,
  period,
  total,
  method,
  agreed,
  onSubmit,
  isPending,
}: {
  plan: Exclude<BillingPlanTier, 'free'>
  period: BillingPeriod
  total: number
  method: PaymentMethodKind
  agreed: boolean
  onSubmit: () => void
  isPending: boolean
}) {
  const next = new Date(
    Date.now() + (period === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000,
  ).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })

  const planName = plan === 'pro' ? 'Pro' : 'Premium'
  const periodLabel = period === 'annual' ? 'годовая' : 'помесячно'

  return (
    <div className="lg:sticky lg:top-6 lg:self-start">
      <Card
        className={cn(
          'flex-col gap-4 p-6',
          'border-warn/40 bg-gradient-to-br from-warn/10 to-transparent',
        )}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-text-primary">К оплате сегодня</h3>
          <span className="rounded-md bg-warn/20 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-warn">
            {planName}
          </span>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="font-display text-4xl font-extrabold text-text-primary">{total} ₽</span>
          <span className="font-mono text-[11px] text-text-muted">/ {periodLabel}</span>
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-3 text-[12px]">
          <Row label="Тариф" value={`${planName} (${periodLabel})`} />
          <Row label="Способ" value={methodLabel(method)} />
          <Row label="Следующее списание" value={next} />
        </div>

        <Button
          variant="primary"
          size="lg"
          onClick={onSubmit}
          disabled={!agreed}
          loading={isPending}
          className="w-full"
        >
          {isPending ? 'Обработка…' : `Оплатить ${total} ₽`}
        </Button>

        <p className="text-[11px] leading-relaxed text-text-muted">
          Сегодня спишется {total} ₽. Доступ откроется сразу после успешной оплаты.
          Без скрытых комиссий.
        </p>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-muted">{label}</span>
      <span className="text-right font-semibold text-text-primary">{value}</span>
    </div>
  )
}

function methodLabel(m: PaymentMethodKind): string {
  switch (m) {
    case 'card':
      return 'Карта'
    case 'apple-pay':
      return 'Apple Pay'
    case 'google-pay':
      return 'Google Pay'
    case 'sbp':
      return 'СБП'
    case 'tinkoff':
      return 'Tinkoff'
  }
}

