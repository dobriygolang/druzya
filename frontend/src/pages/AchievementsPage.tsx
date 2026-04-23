import { useMemo, useState } from 'react'
import { Trophy, Flame, Zap, Shield, Sparkles, Award, Swords, Crown, Lock, Users, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { Card } from '../components/Card'
import {
  useAchievementsQuery,
  summarise,
  isUnlocked,
  progressLabel,
  type Achievement,
  type Tier,
  type Category,
} from '../lib/queries/achievements'

function ErrorChip() {
  const { t } = useTranslation('pages')
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      {t('common.load_failed')}
    </span>
  )
}

const RARITY_BORDER: Record<Tier, string> = {
  common: 'border-border-strong',
  rare: 'border-cyan/50',
  legendary: 'border-warn/60',
}

const RARITY_LABEL: Record<Tier, string> = {
  common: 'COMMON',
  rare: 'RARE',
  legendary: 'LEGENDARY',
}

const RARITY_TEXT: Record<Tier, string> = {
  common: 'text-text-muted',
  rare: 'text-cyan',
  legendary: 'text-warn',
}

// Маппинг category → визуал. Легче поддерживать, чем code-by-code.
const CATEGORY_VISUAL: Record<Category, { icon: JSX.Element; grad: string }> = {
  combat:      { icon: <Swords className="h-10 w-10 text-text-primary" />,    grad: 'from-pink to-accent' },
  consistency: { icon: <Flame className="h-10 w-10 text-text-primary" />,     grad: 'from-warn to-danger' },
  social:      { icon: <Users className="h-10 w-10 text-text-primary" />,     grad: 'from-accent to-cyan' },
  mastery:     { icon: <Sparkles className="h-10 w-10 text-text-primary" />,  grad: 'from-cyan to-accent' },
  secret:      { icon: <Server className="h-10 w-10 text-text-primary" />,    grad: 'from-surface-3 to-bg' },
}

// LEGENDARY top-tier — пара иконок-фоллбеков.
const TIER_ICON_OVERRIDE: Partial<Record<string, JSX.Element>> = {
  champion: <Crown className="h-10 w-10 text-text-primary" />,
  'streak-100': <Zap className="h-10 w-10 text-text-primary" />,
  'arena-master': <Trophy className="h-10 w-10 text-text-primary" />,
  'guardian': <Shield className="h-10 w-10 text-text-primary" />,
  'iron-defender': <Shield className="h-10 w-10 text-text-primary" />,
  'daily-first': <Award className="h-10 w-10 text-text-primary" />,
}

function visualFor(a: Achievement): { icon: JSX.Element; grad: string } {
  const v = CATEGORY_VISUAL[a.category] ?? CATEGORY_VISUAL.combat
  const overrideIcon = TIER_ICON_OVERRIDE[a.code]
  return {
    icon: overrideIcon ?? v.icon,
    grad: isUnlocked(a) ? v.grad : 'from-surface-3 to-bg',
  }
}

function FilterChip({ label, active, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
        active
          ? 'border-accent bg-accent/15 font-semibold text-accent-hover'
          : 'border-border bg-surface-2 text-text-secondary hover:border-border-strong hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  )
}

function Tile({ a, hideName, onClick, selected }: { a: Achievement; hideName: boolean; onClick: () => void; selected: boolean }) {
  const v = visualFor(a)
  const locked = !isUnlocked(a)
  const showAsHidden = locked && a.hidden && hideName
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex h-[200px] flex-col overflow-hidden rounded-[14px] border-2 bg-surface-2 text-left transition-transform hover:-translate-y-0.5 ${RARITY_BORDER[a.tier]} ${
        locked ? 'opacity-60' : ''
      } ${selected ? 'ring-2 ring-accent' : ''}`}
    >
      <div className={`grid h-[100px] place-items-center bg-gradient-to-br ${v.grad}`}>
        {locked ? <Lock className="h-10 w-10 text-text-primary" /> : v.icon}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <span className="font-sans text-[13px] font-bold text-text-primary">
          {showAsHidden ? '???' : a.title}
        </span>
        <span className="font-mono text-[11px] text-text-muted">{showAsHidden ? '— / —' : progressLabel(a)}</span>
        <span className={`mt-auto font-mono text-[10px] font-semibold tracking-[0.08em] ${RARITY_TEXT[a.tier]}`}>
          {RARITY_LABEL[a.tier]}
        </span>
      </div>
    </button>
  )
}

function FeaturedAch({ a }: { a: Achievement | null }) {
  const { t } = useTranslation('pages')
  if (!a) {
    return (
      <Card className="w-full flex-col gap-4 p-6 text-center text-sm text-text-secondary lg:w-[320px]">
        {t('achievements.empty_featured', 'Выбери ачивку слева — здесь появятся подробности.')}
      </Card>
    )
  }
  const v = visualFor(a)
  const locked = !isUnlocked(a)
  return (
    <Card className="w-full flex-col gap-4 p-0 lg:w-[320px]">
      <div className={`grid h-[180px] place-items-center bg-gradient-to-br ${v.grad}`}>
        {locked ? <Lock className="h-16 w-16 text-text-primary" /> : <span className="scale-[1.6]">{v.icon}</span>}
      </div>
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl font-bold text-text-primary">{locked && a.hidden ? '???' : a.title}</h3>
          <span className={`font-mono text-[11px] font-semibold ${RARITY_TEXT[a.tier]}`}>{RARITY_LABEL[a.tier]}</span>
        </div>
        <p className="text-xs text-text-secondary">{a.description}</p>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">{t('achievements.requirements')}</span>
          <p className="text-[12px] text-text-secondary whitespace-pre-line">{a.requirements}</p>
        </div>
        {!!a.reward && (
          <div className="rounded-lg border border-warn/30 bg-warn/10 p-3">
            <span className="font-mono text-[11px] font-semibold text-warn">{t('achievements.reward')}</span>
            <p className="mt-1 text-sm font-bold text-text-primary">{a.reward}</p>
          </div>
        )}
        {!locked && a.unlocked_at && (
          <span className="text-[11px] text-text-muted">
            {t('achievements.unlocked_on', 'Получено')} · {new Date(a.unlocked_at).toLocaleDateString()}
          </span>
        )}
      </div>
    </Card>
  )
}

type StatusFilter = 'all' | 'unlocked' | 'hidden'
type TierFilter = 'all' | Tier

function applyFilters(items: Achievement[], status: StatusFilter, tier: TierFilter): Achievement[] {
  return items.filter((a) => {
    if (status === 'unlocked' && !isUnlocked(a)) return false
    if (status === 'hidden' && !a.hidden) return false
    if (tier !== 'all' && a.tier !== tier) return false
    return true
  })
}

function Skeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="h-[200px] animate-pulse rounded-[14px] bg-surface-2" />
      ))}
    </div>
  )
}

export default function AchievementsPage() {
  const { t } = useTranslation('pages')
  const { data, isError, isLoading } = useAchievementsQuery()
  const [status, setStatus] = useState<StatusFilter>('all')
  const [tier, setTier] = useState<TierFilter>('all')
  const [selectedCode, setSelectedCode] = useState<string | null>(null)

  // Stabilise the items reference: `data ?? []` would create a fresh empty
  // array on every render and invalidate downstream useMemo hooks.
  const items = useMemo(() => data ?? [], [data])
  const summary = useMemo(() => summarise(items), [items])
  const filtered = useMemo(() => applyFilters(items, status, tier), [items, status, tier])

  const featured = useMemo(() => {
    if (selectedCode) {
      const found = items.find((a) => a.code === selectedCode)
      if (found) return found
    }
    // если ничего не выбрано — самая редкая разблокированная.
    const unlockedItems = items.filter(isUnlocked)
    if (unlockedItems.length === 0) return null
    const rank: Record<Tier, number> = { legendary: 3, rare: 2, common: 1 }
    return unlockedItems.slice().sort((a, b) => rank[b.tier] - rank[a.tier])[0]
  }, [items, selectedCode])

  return (
    <AppShellV2>
      <div className="flex flex-col gap-5 px-4 pb-6 pt-6 sm:px-8 lg:px-20 lg:pb-7 lg:pt-7">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary">{t('achievements.title')}</h1>
          <p className="text-sm text-text-secondary">
            {t('achievements.summary', { unlocked: summary.unlocked, total: summary.total, rare: summary.rareUnlocked })}
          </p>
          {isError && <ErrorChip />}
        </div>

        <div className="flex flex-wrap gap-2">
          <FilterChip label={`${t('achievements.all')} · ${summary.total}`} active={status === 'all'} onClick={() => setStatus('all')} />
          <FilterChip label={`${t('achievements.unlocked')} · ${summary.unlocked}`} active={status === 'unlocked'} onClick={() => setStatus('unlocked')} />
          <FilterChip label={`${t('achievements.hidden')} · ${summary.hiddenLocked}`} active={status === 'hidden'} onClick={() => setStatus('hidden')} />
          <span className="mx-1 self-center text-text-muted">·</span>
          <FilterChip label={`${t('achievements.common')} · ${summary.byTier.common}`} active={tier === 'common'} onClick={() => setTier(tier === 'common' ? 'all' : 'common')} />
          <FilterChip label={`${t('achievements.rare')} · ${summary.byTier.rare}`} active={tier === 'rare'} onClick={() => setTier(tier === 'rare' ? 'all' : 'rare')} />
          <FilterChip label={`${t('achievements.legendary')} · ${summary.byTier.legendary}`} active={tier === 'legendary'} onClick={() => setTier(tier === 'legendary' ? 'all' : 'legendary')} />
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <div className="flex-1">
            {isLoading ? (
              <Skeleton />
            ) : filtered.length === 0 ? (
              <Card className="flex-col items-center gap-2 p-8 text-center text-sm text-text-secondary">
                {t('achievements.empty_list', 'Пока ничего не разблокировано — сыграй матч!')}
              </Card>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {filtered.map((a) => (
                  <Tile
                    key={a.code}
                    a={a}
                    hideName={status !== 'hidden'}
                    selected={selectedCode === a.code}
                    onClick={() => setSelectedCode(a.code)}
                  />
                ))}
              </div>
            )}
          </div>
          <FeaturedAch a={featured ?? null} />
        </div>
      </div>
    </AppShellV2>
  )
}
