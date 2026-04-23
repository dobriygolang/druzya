// queries/billing.ts — TanStack hooks for the premium subscription flow
// (Wave-11 /pricing /checkout /settings/billing).
//
// IMPORTANT: backend для /billing/* ещё не реализован. Все мутации возвращают
// синтетический success после 2-секундной паузы. Все query — синтетические
// данные / EmptyState. Когда AIADMIN landed настоящие endpoints, заменить
// stub'ы на честный api(...) call. Каждое место помечено TODO(api).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export type BillingPlanTier = 'free' | 'premium' | 'pro'
export type BillingPeriod = 'monthly' | 'annual'
export type PaymentMethodKind = 'card' | 'apple-pay' | 'google-pay' | 'sbp' | 'tinkoff'

export type CurrentPlan = {
  tier: BillingPlanTier
  period: BillingPeriod
  // ISO-8601. Для FREE — пустая строка (фронт показывает «—» или скрывает).
  next_charge_at: string
  // Сумма следующего списания, в рублях; 0 для FREE.
  next_charge_amount: number
  payment_method?: {
    kind: PaymentMethodKind
    // last4 для card. Для остальных — short label, e.g. "СБП · +7 ··· 12-34".
    label: string
  }
}

export type Invoice = {
  id: string
  paid_at: string // ISO-8601
  amount: number // в рублях
  status: 'paid' | 'failed' | 'refunded'
  pdf_url: string
}

export type CheckoutInput = {
  plan: BillingPlanTier
  period: BillingPeriod
  payment_method: PaymentMethodKind
  promo_code?: string
}

export type CheckoutResult = {
  status: 'success' | 'failure'
  reason?: string // for failure
  subscription?: {
    tier: BillingPlanTier
    period: BillingPeriod
    next_charge_at: string
    next_charge_amount: number
  }
}

export type CancelInput = {
  reason: string
  feedback?: string
}

export const billingQueryKeys = {
  all: ['billing'] as const,
  currentPlan: () => ['billing', 'current'] as const,
  invoices: () => ['billing', 'invoices'] as const,
}

// Synthetic helper — pretend the network round-trip happens.
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// useCurrentPlanQuery — TODO(api): GET /billing/current.
// Текущая реализация читает druz9_user_tier (тот же ключ, что DevTierCard в
// SettingsPage уже использует для симуляции тарифа). Это чтобы /settings/billing
// и /pricing честно отражали состояние, выбранное в DEV-переключателе, а не
// захардкоженный free.
export function useCurrentPlanQuery() {
  return useQuery({
    queryKey: billingQueryKeys.currentPlan(),
    queryFn: async (): Promise<CurrentPlan> => {
      await sleep(150)
      let tier: BillingPlanTier = 'free'
      try {
        const raw = (typeof window !== 'undefined' && localStorage.getItem('druz9_user_tier')) || 'free'
        if (raw === 'premium' || raw === 'pro') tier = raw
      } catch {
        /* noop */
      }
      if (tier === 'free') {
        return {
          tier,
          period: 'monthly',
          next_charge_at: '',
          next_charge_amount: 0,
        }
      }
      // 30 days from now — synthetic anchor.
      const next = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      return {
        tier,
        period: 'monthly',
        next_charge_at: next,
        next_charge_amount: tier === 'pro' ? 890 : 390,
        payment_method: { kind: 'card', label: '•••• 4242' },
      }
    },
    staleTime: 60_000,
  })
}

// useCheckoutMutation — TODO(api): POST /billing/checkout.
// Сейчас всегда возвращает success. Чтобы продемонстрировать failure-flow,
// CheckoutPage напрямую может задиспатчить navigate('/checkout/failure?reason=...')
// до вызова мутации (например при отказе на validate-on-blur промокода).
export function useCheckoutMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CheckoutInput): Promise<CheckoutResult> => {
      await sleep(2000)
      // TODO(api): здесь будет real fetch. Пока — синтетика.
      const amount = input.plan === 'pro' ? 890 : input.plan === 'premium' ? 390 : 0
      const annualMul = input.period === 'annual' ? 12 * 0.8 : 1
      return {
        status: 'success',
        subscription: {
          tier: input.plan,
          period: input.period,
          next_charge_at: new Date(
            Date.now() +
              (input.period === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000,
          ).toISOString(),
          next_charge_amount: Math.round(amount * annualMul),
        },
      }
    },
    onSuccess: (res) => {
      if (res.status === 'success') {
        // Локально проставим тир, чтобы success-страница и /settings/billing
        // сразу отразили новое состояние без перезагрузки.
        if (res.subscription?.tier) {
          try {
            localStorage.setItem('druz9_user_tier', res.subscription.tier)
          } catch {
            /* noop */
          }
        }
        void qc.invalidateQueries({ queryKey: billingQueryKeys.all })
      }
    },
  })
}

// useCancelSubscriptionMutation — TODO(api): POST /billing/cancel.
// Возвращает {ok: true} после паузы. После cancel сбрасываем тир обратно
// в free локально.
export function useCancelSubscriptionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (_input: CancelInput): Promise<{ ok: true }> => {
      await sleep(800)
      return { ok: true }
    },
    onSuccess: () => {
      try {
        localStorage.setItem('druz9_user_tier', 'free')
      } catch {
        /* noop */
      }
      void qc.invalidateQueries({ queryKey: billingQueryKeys.all })
    },
  })
}

// useInvoicesQuery — TODO(api): GET /billing/invoices.
// Синтетика: для premium/pro — 3 строки истории; для free — пустой массив
// (UI рендерит EmptyState variant="no-data").
export function useInvoicesQuery() {
  return useQuery({
    queryKey: billingQueryKeys.invoices(),
    queryFn: async (): Promise<Invoice[]> => {
      await sleep(150)
      let tier: BillingPlanTier = 'free'
      try {
        const raw = (typeof window !== 'undefined' && localStorage.getItem('druz9_user_tier')) || 'free'
        if (raw === 'premium' || raw === 'pro') tier = raw
      } catch {
        /* noop */
      }
      if (tier === 'free') return []
      const amount = tier === 'pro' ? 890 : 390
      const now = Date.now()
      const month = 30 * 24 * 60 * 60 * 1000
      return [0, 1, 2].map((i) => ({
        id: `inv-${1000 + i}`,
        paid_at: new Date(now - i * month).toISOString(),
        amount,
        status: 'paid' as const,
        pdf_url: '#',
      }))
    },
    staleTime: 60_000,
  })
}

// useUpdatePaymentMethodMutation — TODO(api): POST /billing/payment-method.
// Заглушка — просто возвращает выбранный метод после паузы.
export function useUpdatePaymentMethodMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (kind: PaymentMethodKind): Promise<{ kind: PaymentMethodKind }> => {
      await sleep(600)
      return { kind }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingQueryKeys.currentPlan() })
    },
  })
}

// PRICE_TABLE — единый source of truth для цен на /pricing и /checkout.
// Если бэкенд начнёт отдавать prices через /billing/plans — заменить.
export const PRICE_TABLE: Record<BillingPlanTier, { monthly: number; annual: number }> = {
  free: { monthly: 0, annual: 0 },
  premium: { monthly: 390, annual: Math.round(390 * 12 * 0.8) },
  pro: { monthly: 890, annual: Math.round(890 * 12 * 0.8) },
}
