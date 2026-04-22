import { Trophy, Flame, Zap, Shield, Sparkles, Award, Swords, Crown, Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { Card } from '../components/Card'
import { useAchievementsQuery, type Achievement as ApiAchievement } from '../lib/queries/achievements'

function ErrorChip() {
  const { t } = useTranslation('pages')
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      {t('common.load_failed')}
    </span>
  )
}

type Rarity = 'common' | 'rare' | 'legendary'

type Achievement = {
  name: string
  progress: string
  rarity: Rarity
  icon: React.ReactNode
  grad: string
  locked?: boolean
}

const RARITY_BORDER: Record<Rarity, string> = {
  common: 'border-border-strong',
  rare: 'border-cyan/50',
  legendary: 'border-warn/60',
}

const RARITY_LABEL: Record<Rarity, string> = {
  common: 'COMMON',
  rare: 'RARE',
  legendary: 'LEGENDARY',
}

const RARITY_TEXT: Record<Rarity, string> = {
  common: 'text-text-muted',
  rare: 'text-cyan',
  legendary: 'text-warn',
}

const ICON_MAP: Record<string, { icon: React.ReactNode; grad: string }> = {
  'speed-demon': { icon: <Flame className="h-10 w-10 text-text-primary" />, grad: 'from-warn to-danger' },
  'first-blood': { icon: <Swords className="h-10 w-10 text-text-primary" />, grad: 'from-pink to-accent' },
  'streak-master': { icon: <Zap className="h-10 w-10 text-text-primary" />, grad: 'from-cyan to-accent' },
  'iron-defender': { icon: <Shield className="h-10 w-10 text-text-primary" />, grad: 'from-success to-cyan' },
  'algo-sage': { icon: <Sparkles className="h-10 w-10 text-text-primary" />, grad: 'from-accent to-pink' },
  'trophy-hunter': { icon: <Trophy className="h-10 w-10 text-text-primary" />, grad: 'from-warn to-pink' },
  'champion': { icon: <Crown className="h-10 w-10 text-text-primary" />, grad: 'from-warn to-accent' },
  'daily-hero': { icon: <Award className="h-10 w-10 text-text-primary" />, grad: 'from-cyan to-success' },
  'code-warrior': { icon: <Swords className="h-10 w-10 text-text-primary" />, grad: 'from-accent to-cyan' },
  'spark-caster': { icon: <Sparkles className="h-10 w-10 text-text-primary" />, grad: 'from-pink to-warn' },
  'guardian': { icon: <Shield className="h-10 w-10 text-text-primary" />, grad: 'from-cyan to-accent' },
  'inferno': { icon: <Flame className="h-10 w-10 text-text-primary" />, grad: 'from-danger to-warn' },
}

function toUiAch(a: ApiAchievement): Achievement {
  const map = ICON_MAP[a.id] ?? { icon: <Trophy className="h-10 w-10 text-text-primary" />, grad: 'from-surface-3 to-bg' }
  return {
    name: a.name,
    progress: a.progress,
    rarity: a.rarity,
    icon: map.icon,
    grad: a.locked ? 'from-surface-3 to-bg' : map.grad,
    locked: a.locked,
  }
}

const ACHS: Achievement[] = [
  { name: 'Speed Demon', progress: '10 / 10', rarity: 'legendary', icon: <Flame className="h-10 w-10 text-text-primary" />, grad: 'from-warn to-danger' },
  { name: 'First Blood', progress: '1 / 1', rarity: 'common', icon: <Swords className="h-10 w-10 text-text-primary" />, grad: 'from-pink to-accent' },
  { name: 'Streak Master', progress: '12 / 30', rarity: 'rare', icon: <Zap className="h-10 w-10 text-text-primary" />, grad: 'from-cyan to-accent' },
  { name: 'Iron Defender', progress: '5 / 10', rarity: 'rare', icon: <Shield className="h-10 w-10 text-text-primary" />, grad: 'from-success to-cyan' },
  { name: 'Algorithm Sage', progress: '50 / 50', rarity: 'legendary', icon: <Sparkles className="h-10 w-10 text-text-primary" />, grad: 'from-accent to-pink' },
  { name: 'Trophy Hunter', progress: '23 / 47', rarity: 'rare', icon: <Trophy className="h-10 w-10 text-text-primary" />, grad: 'from-warn to-pink' },
  { name: 'Champion', progress: '1 / 1', rarity: 'legendary', icon: <Crown className="h-10 w-10 text-text-primary" />, grad: 'from-warn to-accent' },
  { name: 'Daily Hero', progress: '30 / 30', rarity: 'common', icon: <Award className="h-10 w-10 text-text-primary" />, grad: 'from-cyan to-success' },
  { name: 'Code Warrior', progress: '100 / 100', rarity: 'rare', icon: <Swords className="h-10 w-10 text-text-primary" />, grad: 'from-accent to-cyan' },
  { name: 'Spark Caster', progress: '7 / 20', rarity: 'common', icon: <Sparkles className="h-10 w-10 text-text-primary" />, grad: 'from-pink to-warn' },
  { name: 'Guardian', progress: '15 / 25', rarity: 'rare', icon: <Shield className="h-10 w-10 text-text-primary" />, grad: 'from-cyan to-accent' },
  { name: 'Inferno', progress: '40 / 50', rarity: 'legendary', icon: <Flame className="h-10 w-10 text-text-primary" />, grad: 'from-danger to-warn' },
  { name: '???', progress: '— / —', rarity: 'common', icon: <Trophy className="h-10 w-10 text-text-primary" />, grad: 'from-surface-3 to-bg', locked: true },
  { name: '???', progress: '— / —', rarity: 'rare', icon: <Zap className="h-10 w-10 text-text-primary" />, grad: 'from-surface-3 to-bg', locked: true },
  { name: '???', progress: '— / —', rarity: 'legendary', icon: <Crown className="h-10 w-10 text-text-primary" />, grad: 'from-surface-3 to-bg', locked: true },
  { name: '???', progress: '— / —', rarity: 'common', icon: <Award className="h-10 w-10 text-text-primary" />, grad: 'from-surface-3 to-bg', locked: true },
]

function FilterChip({ label, active }: { label: string; active?: boolean }) {
  return (
    <button
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

function Tile({ a }: { a: Achievement }) {
  return (
    <div
      className={`relative flex h-[200px] flex-col overflow-hidden rounded-[14px] border-2 bg-surface-2 ${RARITY_BORDER[a.rarity]} ${
        a.locked ? 'opacity-40' : ''
      }`}
    >
      <div className={`grid h-[100px] place-items-center bg-gradient-to-br ${a.grad}`}>
        {a.locked ? <Lock className="h-10 w-10 text-text-primary" /> : a.icon}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <span className="font-sans text-[13px] font-bold text-text-primary">{a.name}</span>
        <span className="font-mono text-[11px] text-text-muted">{a.progress}</span>
        <span className={`mt-auto font-mono text-[10px] font-semibold tracking-[0.08em] ${RARITY_TEXT[a.rarity]}`}>
          {RARITY_LABEL[a.rarity]}
        </span>
      </div>
    </div>
  )
}

function FeaturedAch({ name, rarity, description, reward }: { name: string; rarity: Rarity; description: string; reward: string }) {
  const { t } = useTranslation('pages')
  return (
    <Card className="w-full flex-col gap-4 p-0 lg:w-[320px]">
      <div className="grid h-[180px] place-items-center bg-gradient-to-br from-warn to-danger">
        <Flame className="h-16 w-16 text-text-primary" />
      </div>
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl font-bold text-text-primary">{name}</h3>
          <span className={`font-mono text-[11px] font-semibold ${RARITY_TEXT[rarity]}`}>{RARITY_LABEL[rarity]}</span>
        </div>
        <p className="text-xs text-text-secondary">
          {description}
        </p>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">{t('achievements.requirements')}</span>
          <ul className="flex flex-col gap-1.5 text-[12px] text-text-secondary">
            <li>· 10 решений Medium</li>
            <li>· каждое менее 5:00</li>
            <li>· без подсказок и AI</li>
          </ul>
        </div>
        <div className="rounded-lg border border-warn/30 bg-warn/10 p-3">
          <span className="font-mono text-[11px] font-semibold text-warn">{t('achievements.reward')}</span>
          <p className="mt-1 text-sm font-bold text-text-primary">{reward}</p>
        </div>
      </div>
    </Card>
  )
}

export default function AchievementsPage() {
  const { t } = useTranslation('pages')
  const { data, isError } = useAchievementsQuery()
  const total = data?.total ?? 47
  const unlocked = data?.unlocked ?? 23
  const rare = data?.rare_count ?? 6
  const counts = data?.counts ?? { common: 30, rare: 12, legendary: 5, hidden: 12 }
  const items = data?.items ? data.items.map(toUiAch) : ACHS
  const featured = data?.items?.find((a) => a.id === data.featured_id)
  const featuredName = featured?.name ?? 'Speed Demon'
  const featuredRarity = (featured?.rarity ?? 'legendary') as Rarity
  const featuredDesc = featured?.description ?? 'Решить 10 Medium-задач подряд за время менее 5 минут каждая. Только для самых быстрых.'
  const featuredReward = featured?.reward ?? '+500 XP · +Title "Speed Demon"'
  return (
    <AppShellV2>
      <div className="flex flex-col gap-5 px-4 pb-6 pt-6 sm:px-8 lg:px-20 lg:pb-7 lg:pt-7">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-2xl lg:text-[32px] font-bold leading-[1.1] text-text-primary">{t('achievements.title')}</h1>
          <p className="text-sm text-text-secondary">{t('achievements.summary', { unlocked, total, rare })}</p>
          {isError && <ErrorChip />}
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip label={`${t('achievements.all')} · ${total}`} active />
          <FilterChip label={`${t('achievements.unlocked')} · ${unlocked}`} />
          <FilterChip label={`${t('achievements.hidden')} · ${counts.hidden}`} />
          <FilterChip label={`${t('achievements.common')} · ${counts.common}`} />
          <FilterChip label={`${t('achievements.rare')} · ${counts.rare}`} />
          <FilterChip label={`${t('achievements.legendary')} · ${counts.legendary}`} />
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((a, i) => (
              <Tile key={i} a={a} />
            ))}
          </div>
          <FeaturedAch name={featuredName} rarity={featuredRarity} description={featuredDesc} reward={featuredReward} />
        </div>
      </div>
    </AppShellV2>
  )
}
