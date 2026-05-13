// /settings/billing — вкладка биллинга. Stream-C (2026-05-12): добавлен
// BYOK flow + source-aware tier projection.
//
// Endpoints:
//   GET    /api/v1/subscription/tier-info  → tier + source + byok_provider
//   GET    /api/v1/subscription/quota      → policy + usage (legacy)
//   POST   /api/v1/subscription/byok       → подключить ключ
//   DELETE /api/v1/subscription/byok       → снять ключ
//   POST   /api/v1/admin/subscriptions/set-tier (admin-only dev switch)

import { useState } from 'react'
import { Sparkles, Key, Check, Trash2, XCircle } from 'lucide-react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { useProfileQuery } from '../../lib/queries/profile'
import {
  useDevSetTierMutation,
  useSubscriptionQuotaQuery,
  type QuotaSnapshot,
  type SubscriptionTier,
} from '../../lib/queries/billing'
import {
  useRemoveBYOKKeyMutation,
  useSetBYOKKeyMutation,
  useTierQuery,
  type BYOKProvider,
} from '../../lib/queries/tier'
import {
  CURRENCY_DISPLAY,
  detectCurrency,
  useCancelSubscriptionMutation,
  useCreateCheckoutSessionMutation,
  type SupportedCurrency,
} from '../../lib/queries/stripeCheckout'

const TIER_LABEL: Record<SubscriptionTier, string> = {
  free: 'Free',
  pro: 'Pro',
  max: 'Max',
}

// SOURCE_BLURB — короткое объяснение «откуда у тебя этот tier». Free
// показывает value-prop, Pro/BYOK/Tutor — статус.
const SOURCE_BLURB: Record<string, string> = {
  free: 'Базовый доступ: AI-coach, atlas, codex, Hone basic, Cue basic (20 LLM/day). AI-mock без полного pipeline.',
  pro: 'Pro: безлимит AI-mock pipelines, deep readiness analytics, premium Cue, Google Calendar sync.',
  byok: 'Pro через свой LLM-ключ. Все Pro-фичи открыты бесплатно — pay-as-you-go идёт через твой ключ.',
  tutor: 'Tutor mode: ты ведёшь студентов. Tutor toolkit + общий доступ к материалам — без paywall.',
}

const BYOK_PROVIDERS: { value: BYOKProvider; label: string; hint: string }[] = [
  { value: 'openrouter', label: 'OpenRouter', hint: 'универсальный gateway, разные модели' },
  { value: 'groq', label: 'Groq', hint: 'free tier 14k req/day, llama 3.1' },
  { value: 'cerebras', label: 'Cerebras', hint: 'free tier, llama3.1-8b' },
  { value: 'anthropic', label: 'Anthropic', hint: 'Claude Haiku/Sonnet' },
  { value: 'openai', label: 'OpenAI', hint: 'GPT-4o-mini' },
]

export function BillingTab() {
  const profile = useProfileQuery()
  const isAdmin = profile.data?.role === 'admin'
  return (
    <div className="flex flex-col gap-5">
      <CurrentTierCard />
      <BYOKCard />
      <StripeCard />
      <QuotaUsageCard />
      {isAdmin && <DevTierSwitchCard />}
    </div>
  )
}

function CurrentTierCard() {
  const tier = useTierQuery()
  const source = tier.data?.source ?? 'free'
  const isPro = source === 'pro' || source === 'byok'
  const label = source === 'byok' ? 'PRO · BYOK' : (tier.data?.tier ?? 'free').toUpperCase()
  return (
    <Card className="relative flex-col gap-4 p-6">
      {isPro && (
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
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-display text-lg font-bold text-text-primary">Текущий тариф</h3>
        <span
          className={[
            'rounded-md px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em]',
            source === 'byok' ? 'border-l-[1.5px] border-l-text-primary' : '',
            isPro ? 'bg-text-primary/15 text-text-primary' : 'bg-surface-2 text-text-secondary',
          ].join(' ')}
        >
          {label}
        </span>
      </div>
      <p className="text-[13px] text-text-secondary">{SOURCE_BLURB[source] ?? SOURCE_BLURB.free}</p>
      {tier.data?.expires_at && (
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          Renews · {new Date(tier.data.expires_at).toLocaleDateString()}
        </p>
      )}
    </Card>
  )
}

// StripeCard — Pro tier checkout flow. В paid состоянии показываем
// «Cancel subscription» + period_end. BYOK-юзеры видят default form
// (но кнопка disabled, потому что им не нужно платить — BYOK уже даёт Pro).
function StripeCard() {
  const tier = useTierQuery()
  const source = tier.data?.source ?? 'free'
  const isPaidPro = source === 'pro'
  const isByokPro = source === 'byok'
  const checkout = useCreateCheckoutSessionMutation()
  const cancel = useCancelSubscriptionMutation()
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [currency, setCurrency] = useState<SupportedCurrency>(detectCurrency())

  // Когда юзер уже paid Pro — показываем «active subscription» панель
  // с period_end + cancel button.
  if (isPaidPro) {
    const expires = tier.data?.expires_at
    return (
      <Card className="flex-col gap-4 p-6">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h3 className="font-display text-lg font-bold text-text-primary">Pro подписка</h3>
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-primary">
            ACTIVE
          </span>
        </div>
        {expires && (
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
            Следующее списание · {new Date(expires).toLocaleDateString('ru')}
          </p>
        )}
        <p className="text-[13px] text-text-secondary">
          Pro-фичи активны до периода. Отмена остановит автопродление — текущий период
          доработает.
        </p>
        {confirmCancel ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border-strong bg-surface-2 p-3">
            <p className="text-[12px] text-text-secondary">
              Подтвердить отмену? До конца периода Pro останется. Передумать можно потом —
              просто оплати снова.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                icon={<XCircle className="h-3.5 w-3.5" />}
                loading={cancel.isPending}
                onClick={() => {
                  cancel.mutate(undefined, {
                    onSuccess: () => setConfirmCancel(false),
                  })
                }}
              >
                Подтвердить отмену
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmCancel(false)}
                disabled={cancel.isPending}
              >
                Назад
              </Button>
            </div>
            {cancel.isError && (
              <span className="font-mono text-[11px]" style={{ color: 'var(--red)' }}>
                Не удалось отменить. Попробуй позже или напиши в поддержку.
              </span>
            )}
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            icon={<XCircle className="h-3.5 w-3.5" />}
            onClick={() => setConfirmCancel(true)}
          >
            Отменить автопродление
          </Button>
        )}
      </Card>
    )
  }

  // Free / BYOK состояние — показываем checkout CTA. First-time subscribers
  // получают 7-дневный trial автоматически (backend gating); UI отражает это.
  // expires_at !== undefined значит юзер когда-либо уже подписывался; в этом
  // случае trial-баннер скрываем.
  const eligibleForTrial = !isByokPro && !tier.data?.expires_at
  const trialStart = new Date()
  const trialEnd = new Date(trialStart.getTime() + 7 * 24 * 60 * 60 * 1000)
  const trialEndStr = trialEnd.toLocaleDateString('ru', { day: 'numeric', month: 'long' })

  // Currency picker — auto-detect by locale at mount, user can override.
  // Default не sticky'ится между сессиями — каждый раз решается из navigator.
  const priceDisplay = CURRENCY_DISPLAY[currency].price

  return (
    <Card className="flex-col gap-3 p-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="font-display text-lg font-bold text-text-primary">Pro · {priceDisplay}/мес</h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          Stripe
        </span>
      </div>
      <p className="text-[13px] text-text-secondary">
        Безлимит AI-mock pipelines · deep readiness analytics · premium Cue · Google Calendar sync ·
        advanced goal analytics.
      </p>

      {/* Currency picker — 3 button segmented. B/W mode: selected = ink bg, unselected = surface. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          Валюта
        </span>
        {(['RUB', 'USD', 'EUR'] as SupportedCurrency[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCurrency(c)}
            disabled={checkout.isPending || isByokPro}
            style={{
              transition:
                'border-color var(--motion-dur-small) var(--motion-ease-standard), background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
            }}
            className={[
              'rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em]',
              currency === c
                ? 'border-text-primary bg-text-primary text-bg'
                : 'border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary',
              checkout.isPending || isByokPro ? 'opacity-60' : '',
            ].join(' ')}
          >
            {c} · {CURRENCY_DISPLAY[c].price}
          </button>
        ))}
      </div>

      {eligibleForTrial && (
        <div
          className="flex flex-col gap-1 rounded-md border border-border-strong bg-surface-2 px-3 py-2"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-primary">
            7 дней trial
          </span>
          <span className="text-[12px] text-text-secondary">
            Списание начнётся {trialEndStr}. Отмена в любой момент до этой даты — без списания.
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="md"
          icon={<Sparkles className="h-4 w-4" />}
          loading={checkout.isPending}
          disabled={checkout.isPending || isByokPro}
          onClick={() => {
            const origin = typeof window !== 'undefined' ? window.location.origin : ''
            checkout.mutate({
              success_url: `${origin}/billing/welcome`,
              cancel_url: `${origin}/upgrade?retry=true`,
              currency,
            })
          }}
        >
          {isByokPro
            ? 'Pro через BYOK активен'
            : eligibleForTrial
              ? 'Начать 7 дней trial'
              : `Оплатить Pro · ${priceDisplay}`}
        </Button>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted self-center">
          BYOK ниже — бесплатная альтернатива
        </span>
      </div>
      {checkout.isError && (
        <span className="font-mono text-[11px]" style={{ color: 'var(--red)' }}>
          Не удалось создать сессию. Stripe может быть не сконфигурирован — попробуй BYOK.
        </span>
      )}
    </Card>
  )
}

// BYOKCard — форма подключения своего LLM-ключа. После validate'а Pro
// фичи открываются бесплатно. Не показываем уже attached provider в
// dropdown — а отдельной "ваш ключ подключён" секцией.
function BYOKCard() {
  const tier = useTierQuery()
  const setMut = useSetBYOKKeyMutation()
  const removeMut = useRemoveBYOKKeyMutation()
  const [provider, setProvider] = useState<BYOKProvider>('openrouter')
  const [apiKey, setApiKey] = useState('')

  const attached = tier.data?.source === 'byok'
  const attachedProvider = tier.data?.byok_provider ?? ''

  return (
    <Card className="flex-col gap-4 p-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="font-display text-lg font-bold text-text-primary">
          Bring Your Own Key (BYOK)
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          Free Pro unlock
        </span>
      </div>
      <p className="text-[13px] text-text-secondary">
        Принеси свой API-ключ — мы провалидируем его минимальным запросом и откроем
        Pro-фичи без оплаты с нашей стороны. Pay-as-you-go идёт через твоего провайдера.
      </p>

      {attached ? (
        <div
          className="relative flex flex-col gap-3 rounded-lg border border-border-strong bg-surface-2 p-4"
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
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-text-primary" />
            <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-text-primary">
              Подключён: {attachedProvider || 'unknown'}
            </span>
          </div>
          <p className="text-[12px] text-text-secondary">
            Pro-фичи открыты. Снять — повторно вернёшься на Free (или paid Pro если он был).
          </p>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            loading={removeMut.isPending}
            onClick={() => removeMut.mutate()}
          >
            Снять ключ
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!apiKey.trim()) return
            setMut.mutate(
              { provider, api_key: apiKey.trim() },
              {
                onSuccess: () => setApiKey(''),
              },
            )
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              Провайдер
            </span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as BYOKProvider)}
              style={{
                border: 'none',
                borderBottom: '1px solid var(--hair-2)',
                background: 'transparent',
                transition:
                  'border-bottom-color var(--motion-dur-small) var(--motion-ease-standard), border-bottom-width var(--motion-dur-small) var(--motion-ease-standard)',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderBottomColor = 'rgb(var(--ink))'
                e.currentTarget.style.borderBottomWidth = '1.5px'
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderBottomColor = 'var(--hair-2)'
                e.currentTarget.style.borderBottomWidth = '1px'
              }}
              className="px-1 py-2 text-[13px] text-text-primary focus:outline-none"
            >
              {BYOK_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label} — {p.hint}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
              API key
            </span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              style={{
                border: 'none',
                borderBottom: '1px solid var(--hair-2)',
                background: 'transparent',
                transition:
                  'border-bottom-color var(--motion-dur-small) var(--motion-ease-standard), border-bottom-width var(--motion-dur-small) var(--motion-ease-standard)',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderBottomColor = 'rgb(var(--ink))'
                e.currentTarget.style.borderBottomWidth = '1.5px'
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderBottomColor = 'var(--hair-2)'
                e.currentTarget.style.borderBottomWidth = '1px'
              }}
              className="px-1 py-2 font-mono text-[12px] text-text-primary placeholder-text-muted focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              variant="primary"
              size="md"
              icon={<Key className="h-4 w-4" />}
              loading={setMut.isPending}
              disabled={!apiKey.trim() || setMut.isPending}
            >
              Validate &amp; enable Pro
            </Button>
            {setMut.isError && (
              <span
                className="font-mono text-[11px]"
                style={{ color: 'var(--red)' }}
              >
                Ключ не принят. Проверь, что он валидный и не rate-limit'нут.
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-muted">
            Ключ шифруется AES-256-GCM и хранится только на сервере. Plain key никогда
            не пишется в лог.
          </p>
        </form>
      )}
    </Card>
  )
}

function QuotaUsageCard() {
  const q = useSubscriptionQuotaQuery()
  if (q.isLoading) {
    return (
      <Card className="flex-col gap-3 p-6">
        <h3 className="font-display text-lg font-bold text-text-primary">Лимиты</h3>
        <p className="font-mono text-[11px] text-text-muted">loading…</p>
      </Card>
    )
  }
  if (!q.data) return null
  const data = q.data
  return (
    <Card className="flex-col gap-3 p-6">
      <h3 className="font-display text-lg font-bold text-text-primary">Лимиты</h3>
      <div className="flex flex-col gap-2.5">
        <UsageRow
          label="Synced notes"
          used={data.usage.synced_notes}
          quota={data.policy.synced_notes}
        />
        <UsageRow
          label="Shared whiteboards"
          used={data.usage.active_shared_boards}
          quota={data.policy.active_shared_boards}
        />
        <UsageRow
          label="Shared editor rooms"
          used={data.usage.active_shared_rooms}
          quota={data.policy.active_shared_rooms}
        />
        <UsageRow
          label="AI запросов в месяц"
          used={data.usage.ai_this_month}
          quota={data.policy.ai_monthly}
        />
      </div>
    </Card>
  )
}

function UsageRow({ label, used, quota }: { label: string; used: number; quota: number }) {
  // 0 / negative в policy ⇢ unlimited.
  const unlimited = quota <= 0
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / quota) * 100))
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="text-text-secondary">{label}</span>
        <span className="font-mono text-text-primary">
          {used}{unlimited ? '' : ` / ${quota}`}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full bg-text-primary"
          style={{
            width: unlimited ? '8%' : `${pct}%`,
            transition: 'width var(--motion-dur-medium) var(--motion-ease-standard)',
          }}
        />
      </div>
    </div>
  )
}

function DevTierSwitchCard() {
  const q = useSubscriptionQuotaQuery()
  const mut = useDevSetTierMutation()
  const current = q.data?.tier ?? 'free'
  const tiers: SubscriptionTier[] = ['free', 'pro', 'max']
  return (
    <Card className="flex-col gap-3 border-border-strong p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-lg font-bold text-text-primary">Dev tier switch</h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
          admin only
        </span>
      </div>
      <p className="text-[13px] text-text-secondary">
        Принудительная смена своего тарифа без прохождения Boosty. Используется для
        отладки gating-логики и проверки UI разных уровней.
      </p>
      <div className="flex flex-wrap gap-2">
        {tiers.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => mut.mutate({ tier: t })}
            disabled={mut.isPending || current === t}
            style={{
              transition: 'border-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), background-color var(--motion-dur-small) var(--motion-ease-standard)',
            }}
            className={[
              'rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em]',
              current === t
                ? 'border-text-primary bg-text-primary text-bg'
                : 'border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text-primary',
              mut.isPending ? 'opacity-60' : '',
            ].join(' ')}
          >
            {TIER_LABEL[t]}
          </button>
        ))}
      </div>
      {mut.isError && (
        <p className="text-[12px] text-text-secondary">
          Не удалось переключить — проверь, что у тебя есть admin-роль на бэке.
        </p>
      )}
    </Card>
  )
}

// QuotaSnapshot is re-exported only so future iterations of /settings can
// use it without a deep relative import.
export type { QuotaSnapshot }
