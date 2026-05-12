// queries/stripeCheckout.ts — Stream-C Stripe MVP hooks.
//
// Endpoints (REST aliases на subscription Connect-RPC):
//   POST /api/v1/subscription/checkout → { session_id, checkout_url }
//   POST /api/v1/subscription/cancel   → 204
//
// Flow:
//   1. user clicks "Оплатить Pro" → useCreateCheckoutSessionMutation
//   2. mutation creates Stripe Checkout Session на бэке + возвращает url
//   3. фронт делает window.location = checkout_url → Stripe-hosted page
//   4. после оплаты Stripe редиректит на success_url (/checkout/success)
//   5. webhook checkout.session.completed синхронно SetTier(Pro) на бэке
//
// На странице success хук useTierQuery polls /subscription/tier-info и
// показывает «Pro активирован».

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../apiClient'
import { tierQueryKeys } from './tier'

export type CreateCheckoutSessionInput = {
  success_url: string
  cancel_url: string
  // Optional: будущий Max tier override. Пусто = backend STRIPE_PRICE_ID_PRO_MONTHLY.
  price_id?: string
  // 0 (или не задано) = backend применит default (7 дней для first-time
  // subscribers). Передаём explicit для promo-flow'ов в будущем.
  trial_days?: number
}

export type CheckoutSessionResponse = {
  session_id: string
  checkout_url: string
}

// useCreateCheckoutSessionMutation — backend создаёт Stripe Session;
// onSuccess мы редиректим юзера к checkout_url. Если backend вернёт 503
// (env vars пусты на этом окружении) — onError всплывёт; caller покажет
// toast «оплата временно недоступна, попробуй BYOK».
export function useCreateCheckoutSessionMutation() {
  return useMutation({
    mutationFn: (input: CreateCheckoutSessionInput) =>
      api<CheckoutSessionResponse>('/subscription/checkout', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (res) => {
      // Принудительный redirect — Stripe не позволяет open в new tab без
      // gesture-tied window.open, поэтому идём same-tab. Возврат через
      // success_url / cancel_url ниже.
      if (res?.checkout_url && typeof window !== 'undefined') {
        window.location.href = res.checkout_url
      }
    },
  })
}

// useCancelSubscriptionMutation — выставляет cancel_at_period_end=true.
// До period_end юзер сохраняет Pro доступ; после — webhook deleted
// откатит tier. После success — invalidate tier-info так чтобы UI
// показал badge «cancelled, ends 2026-06-12».
export function useCancelSubscriptionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api<void>('/subscription/cancel', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tierQueryKeys.all })
      void qc.invalidateQueries({ queryKey: ['subscription', 'quota'] })
      void qc.invalidateQueries({ queryKey: ['subscription', 'my-tier'] })
    },
  })
}
