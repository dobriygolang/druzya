// SeasonPage renders the Season Pass surface — the Free + Premium reward
// ladders, the user's tier/progress, and weekly challenges.
//
// All data is loaded from /api/v1/season/current (Connect-RPC SeasonService /
// proto/druz9/v1/season.proto). When the backend returns 404 (no active
// season) we render a polite empty state — never the demo numbers.
import { useMemo } from 'react'
import { Check, Lock, Crown, Snowflake, Sparkles } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { ComingSoon } from '../components/ComingSoon'
import {
  useClaimReward,
  useSeasonQuery,
  type SeasonProgress,
  type SeasonTier,
} from '../lib/queries/season'

function ErrorChip({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      {label}
    </span>
  )
}

function Hero({ data, isError, isLoading }: { data?: SeasonProgress; isError: boolean; isLoading: boolean }) {
  const tier = data?.tier ?? 0
  const sp = data?.my_points ?? 0
  const codename = data?.season?.slug?.toUpperCase() ?? '—'
  const title = data?.season?.name ?? 'Season Pass'

  // Free track is the canonical ladder for the next-tier target.
  const sortedFree = useMemo(
    () => {
      const freeTrack = data?.tracks?.find((t) => t.kind === 'free')?.tiers ?? []
      return [...freeTrack].sort((a, b) => a.required_points - b.required_points)
    },
    [data],
  )
  const nextTier = sortedFree.find((row) => row.required_points > sp)
  const target = nextTier?.required_points ?? sp
  const pct = target > sp ? Math.min(100, Math.round((sp / target) * 100)) : 100
  const rewardCount = (data?.tracks?.[0]?.tiers?.length ?? 0) + (data?.tracks?.[1]?.tiers?.length ?? 0)
  const endsAt = data?.season?.ends_at
  const daysLeft = endsAt
    ? Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000))
    : null

  return (
    <div
      className="flex h-auto flex-col items-start justify-between gap-4 px-4 py-6 sm:px-8 lg:h-[240px] lg:flex-row lg:items-center lg:gap-0 lg:px-20 lg:py-0"
      style={{ background: 'linear-gradient(135deg, #2D1B4D 0%, #582CFF 100%)' }}
    >
      <div className="flex flex-col gap-3">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warn/20 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn">
          СЕЗОН · {codename}
        </span>
        <h1 className="font-display text-3xl sm:text-4xl lg:text-[38px] font-extrabold leading-[1.05] text-text-primary">{title}</h1>
        <p className="text-sm text-text-secondary">
          {isError
            ? 'Не удалось загрузить'
            : isLoading
              ? 'Загружаем сезон…'
              : daysLeft !== null
                ? `До конца сезона: ${daysLeft} дней · ${rewardCount} наград`
                : `${rewardCount} наград`}
        </p>
        <div className="mt-2 flex items-center gap-4">
          <span className="font-display text-base font-bold text-text-primary">Tier {tier}</span>
          <div className="h-2.5 w-[160px] sm:w-[220px] overflow-hidden rounded-full bg-black/30">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan to-warn" style={{ width: `${pct}%` }} />
          </div>
          <span className="font-mono text-[12px] text-text-secondary">
            {sp}{nextTier ? ` / ${target}` : ''} SP
          </span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <Button
          disabled={data?.is_premium ?? false}
          className="bg-warn text-bg shadow-glow-warn hover:bg-warn hover:brightness-110 disabled:opacity-50"
        >
          {data?.is_premium ? 'Premium активен' : 'Купить Premium'}
        </Button>
        <span className="max-w-[260px] text-right text-xs text-text-secondary">
          Анлок всех Premium-наград
        </span>
      </div>
    </div>
  )
}

type CellState = 'collected' | 'current' | 'locked'

function tierState(tier: SeasonTier, currentTier: number): CellState {
  if (tier.claimed) return 'collected'
  if (tier.tier === currentTier + 1) return 'current'
  return 'locked'
}

function FreeCell({
  tier,
  state,
  onClaim,
  claiming,
}: {
  tier: SeasonTier
  state: CellState
  onClaim: () => void
  claiming: boolean
}) {
  const isCurrent = state === 'current'
  const isCollected = state === 'collected'
  const canClaim = !isCollected && !isCurrent && false // claim eligibility is owned by the API; UI shows current cell only.
  return (
    <div
      className={`relative flex h-[120px] flex-col items-center justify-center gap-2 rounded-lg border bg-surface-2 p-3 ${
        isCurrent ? 'border-accent shadow-glow' : 'border-border'
      } ${state === 'locked' ? 'opacity-60' : ''}`}
    >
      <span className="absolute left-2 top-2 font-mono text-[10px] text-text-muted">T{tier.tier}</span>
      {isCurrent && (
        <span className="absolute right-2 top-2 rounded-full bg-accent px-1.5 py-0.5 font-mono text-[9px] font-bold text-text-primary">
          СЕЙЧАС
        </span>
      )}
      <div className="grid h-12 w-12 place-items-center rounded-md bg-gradient-to-br from-surface-3 to-accent/40">
        {state === 'locked' ? (
          <Lock className="h-5 w-5 text-text-muted" />
        ) : isCollected ? (
          <Check className="h-5 w-5 text-success" />
        ) : (
          <Sparkles className="h-5 w-5 text-cyan" />
        )}
      </div>
      <span className="text-center text-[11px] font-semibold text-text-primary">{tier.reward_key}</span>
      {canClaim && (
        <button
          type="button"
          onClick={onClaim}
          disabled={claiming}
          className="rounded bg-success/20 px-1.5 py-0.5 text-[9px] font-bold text-success disabled:opacity-50"
        >
          Забрать
        </button>
      )}
    </div>
  )
}

function PremiumCell({
  tier,
  isPremium,
  state,
  onClaim,
  claiming,
}: {
  tier: SeasonTier
  isPremium: boolean
  state: CellState
  onClaim: () => void
  claiming: boolean
}) {
  const claimable = isPremium && state === 'collected' === false && state !== 'locked'
  return (
    <div className="relative flex h-[120px] flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-warn/40 bg-gradient-to-br from-warn/20 to-pink/20 p-3">
      <span className="absolute left-2 top-2 font-mono text-[10px] text-warn">T{tier.tier}</span>
      <div className="grid h-12 w-12 place-items-center rounded-md bg-gradient-to-br from-warn to-pink">
        <Crown className="h-5 w-5 text-bg" />
      </div>
      <span className="text-center text-[11px] font-semibold text-text-primary">{tier.reward_key}</span>
      {!isPremium && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg/70 opacity-0 transition-opacity hover:opacity-100">
          <span className="font-mono text-[11px] font-semibold text-warn">Купи Premium</span>
        </div>
      )}
      {claimable && (
        <button
          type="button"
          onClick={onClaim}
          disabled={claiming}
          className="rounded bg-warn/30 px-1.5 py-0.5 text-[9px] font-bold text-warn disabled:opacity-50"
        >
          Забрать
        </button>
      )}
      <Lock className="absolute bottom-2 right-2 h-3 w-3 text-warn" />
    </div>
  )
}

function BattlePass({ data }: { data: SeasonProgress }) {
  const claim = useClaimReward()
  const free = useMemo(
    () => [...(data.tracks.find((t) => t.kind === 'free')?.tiers ?? [])].sort((a, b) => a.tier - b.tier),
    [data.tracks],
  )
  const premium = useMemo(
    () => [...(data.tracks.find((t) => t.kind === 'premium')?.tiers ?? [])].sort((a, b) => a.tier - b.tier),
    [data.tracks],
  )

  if (free.length === 0 && premium.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface-1 p-8 text-center">
        <p className="text-sm text-text-secondary">Награды этого сезона ещё не настроены администраторами.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="font-display text-2xl font-bold text-text-primary">Боевой пропуск</h2>
        <span className="font-mono text-[11px] text-text-muted">
          Tier {data.tier} · {data.my_points} SP
        </span>
      </div>
      <div className="flex flex-col gap-3 rounded-2xl bg-surface-1 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <div className="font-mono text-[12px] font-semibold tracking-[0.08em] text-text-secondary lg:w-32">FREE</div>
          <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {free.slice(0, 6).map((t) => (
              <FreeCell
                key={t.tier}
                tier={t}
                state={tierState(t, data.tier)}
                onClaim={() => claim.mutate({ tier: t.tier, kind: 'free' })}
                claiming={claim.isPending}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <div className="font-mono text-[12px] font-semibold tracking-[0.08em] text-warn lg:w-32">👑 PREMIUM</div>
          <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {premium.slice(0, 6).map((t) => (
              <PremiumCell
                key={t.tier}
                tier={t}
                isPremium={data.is_premium}
                state={tierState(t, data.tier)}
                onClaim={() => claim.mutate({ tier: t.tier, kind: 'premium' })}
                claiming={claim.isPending}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function WeeklyChallenges({ data }: { data: SeasonProgress }) {
  if (!data.weekly_challenges || data.weekly_challenges.length === 0) return null
  return (
    <Card className="flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-text-primary">Челленджи недели</h3>
      </div>
      <div className="flex flex-col gap-2">
        {data.weekly_challenges.map((c) => {
          const pct = c.target > 0 ? Math.min(100, Math.round((c.progress / c.target) * 100)) : 0
          return (
            <div key={c.key} className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-text-primary">{c.title}</span>
                <span className="font-mono text-[11px] text-warn">+{c.points_reward} SP</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-black/30">
                <div className="h-full rounded-full bg-cyan" style={{ width: `${pct}%` }} />
              </div>
              <span className="font-mono text-[10px] text-text-muted">{c.progress} / {c.target}</span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function StreakFreeze() {
  return (
    <Card className="flex-1 flex-col items-center gap-3 border-warn/40 p-5">
      <Snowflake className="h-10 w-10 text-cyan" />
      <h3 className="font-display text-base font-bold text-text-primary">Streak Freeze</h3>
      <p className="text-center text-xs text-text-secondary">Защити серию на 1 день</p>
      <Button className="mt-auto bg-warn text-bg shadow-glow-warn hover:bg-warn hover:brightness-110">Скоро</Button>
    </Card>
  )
}

export default function SeasonPage() {
  const { data, isError, isLoading, error } = useSeasonQuery()

  // 404 (No current season) → render an honest empty state.
  const errStatus = (error as { status?: number } | null)?.status
  if (errStatus === 404) {
    return (
      <AppShellV2>
        <ComingSoon
          title="Активного сезона нет"
          description="Следующий сезон стартует, когда администраторы откроют его. Загляни позже — мы пришлём пуш на старте."
        />
      </AppShellV2>
    )
  }

  return (
    <AppShellV2>
      <Hero data={data} isError={isError && errStatus !== 404} isLoading={isLoading} />
      <div className="flex flex-col gap-8 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        {isError && errStatus !== 404 && <ErrorChip label="Не удалось загрузить" />}
        {data && <BattlePass data={data} />}
        {data && (
          <div className="flex flex-col gap-5">
            <h2 className="font-display text-2xl font-bold text-text-primary">Прогресс</h2>
            <div className="flex flex-col gap-4 lg:flex-row lg:gap-5">
              <WeeklyChallenges data={data} />
              <StreakFreeze />
            </div>
          </div>
        )}
      </div>
    </AppShellV2>
  )
}
