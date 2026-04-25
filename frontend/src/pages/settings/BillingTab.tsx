// /settings/billing — реальная вкладка биллинга подключённая к бэку:
//   - GET  /api/v1/subscription/quota         — текущий tier + лимиты + usage
//   - POST /api/v1/subscription/boosty/link   — привязать Boosty username
//   - POST /api/v1/admin/subscriptions/set-tier — dev-shortcut (admin only)
//
// Phase 1 simplification: убрали stub'ы CancelModal / Invoices, потому что
// для Boosty-flow эти UI не имеют backend'а — оплата идёт через Boosty,
// а инвойсы там же. Когда появится свой биллинг — добавим обратно.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Sparkles } from 'lucide-react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { useProfileQuery } from '../../lib/queries/profile'
import {
  useDevSetTierMutation,
  useLinkBoostyMutation,
  useSubscriptionQuotaQuery,
  type QuotaSnapshot,
  type SubscriptionTier,
} from '../../lib/queries/billing'

const TIER_LABEL: Record<SubscriptionTier, string> = {
  free: 'Free',
  seeker: 'Seeker',
  ascendant: 'Ascendant',
}

const TIER_BLURB: Record<SubscriptionTier, string> = {
  free: 'Базовый доступ. Заметки синкаются ограниченно, AI-фичи квотируются.',
  seeker: 'Расширенные лимиты, full Skill Atlas, приоритет в очереди AI.',
  ascendant: 'Без лимитов. Всё что есть на платформе.',
}

export function BillingTab() {
  const profile = useProfileQuery()
  const isAdmin = profile.data?.role === 'admin'
  return (
    <div className="flex flex-col gap-5">
      <CurrentTierCard />
      <QuotaUsageCard />
      <BoostyLinkCard />
      {isAdmin && <DevTierSwitchCard />}
    </div>
  )
}

function CurrentTierCard() {
  const q = useSubscriptionQuotaQuery()
  const tier = q.data?.tier ?? 'free'
  const isFree = tier === 'free'
  return (
    <Card className="flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-text-primary">Текущий тариф</h3>
        <span
          className={[
            'rounded-md px-2 py-0.5 font-mono text-[11px] font-bold uppercase',
            isFree ? 'bg-surface-2 text-text-secondary' : 'bg-text-primary/15 text-text-primary',
          ].join(' ')}
        >
          {TIER_LABEL[tier]}
        </span>
      </div>
      <p className="text-[13px] text-text-secondary">{TIER_BLURB[tier]}</p>
      {isFree && (
        <Link to="/pricing">
          <Button variant="primary" size="md" icon={<Sparkles className="h-4 w-4" />}>
            Посмотреть тарифы
          </Button>
        </Link>
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
          className="h-full bg-text-primary transition-[width]"
          style={{ width: unlimited ? '8%' : `${pct}%` }}
        />
      </div>
    </div>
  )
}

function BoostyLinkCard() {
  const mut = useLinkBoostyMutation()
  const [username, setUsername] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setFeedback(null)
    if (!username.trim()) return
    try {
      await mut.mutateAsync(username.trim())
      setFeedback('Привязка сохранена. Sync подхватит подписку в течение 30 минут.')
      setUsername('')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Не удалось привязать.')
    }
  }
  return (
    <Card className="flex-col gap-3 p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-text-primary">Boosty</h3>
        <a
          href="https://boosty.to"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[11px] text-text-muted hover:text-text-primary"
        >
          boosty.to <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <p className="text-[13px] text-text-secondary">
        Подписка идёт через Boosty. Привяжи свой никнейм там, чтобы система
        матчила платную подписку с твоим аккаунтом — sync проходит каждые 30 минут.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="boosty username"
          className="flex-1 rounded-lg border border-border bg-surface-1 px-3 py-2 text-[14px] text-text-primary placeholder:text-text-muted/60"
        />
        <Button type="submit" variant="primary" size="md" loading={mut.isPending} disabled={!username.trim()}>
          Привязать
        </Button>
      </form>
      {feedback && (
        <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px] text-text-secondary">
          {feedback}
        </p>
      )}
    </Card>
  )
}

function DevTierSwitchCard() {
  const q = useSubscriptionQuotaQuery()
  const mut = useDevSetTierMutation()
  const current = q.data?.tier ?? 'free'
  const tiers: SubscriptionTier[] = ['free', 'seeker', 'ascendant']
  return (
    <Card className="flex-col gap-3 border-border-strong p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-lg font-bold text-text-primary">Dev tier switch</h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
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
            className={[
              'rounded-md border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors',
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
