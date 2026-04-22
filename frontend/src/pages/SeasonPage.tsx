// TODO i18n
import { Check, Lock, Crown, Snowflake, Gem, Palette, Frame, Sparkles } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { useSeasonQuery } from '../lib/queries/season'

function Hero() {
  const { data: season, isError } = useSeasonQuery()
  const tier = season?.current_tier ?? 23
  const sp = season?.current_sp ?? 1240
  const tierMax = season?.tier_max ?? 40
  const codename = season?.codename?.toUpperCase() ?? 'DRAGONFIRE'
  const title = season?.title ?? 'Path of the Algorithm'
  const daysLeft = season?.ends_at
    ? Math.max(0, Math.ceil((new Date(season.ends_at).getTime() - Date.now()) / 86_400_000))
    : 18
  const rewardCount = season?.checkpoints?.length ?? 42
  const tierGoal = (tier + 1) * 200
  const pct = Math.min(100, Math.round(((sp % tierGoal) / tierGoal) * 100))
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
          {isError ? 'Не удалось загрузить' : `До конца сезона: ${daysLeft} дней · ${rewardCount} наград`}
        </p>
        <div className="mt-2 flex items-center gap-4">
          <span className="font-display text-base font-bold text-text-primary">Tier {tier}</span>
          <div className="h-2.5 w-[160px] sm:w-[220px] overflow-hidden rounded-full bg-black/30">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan to-warn" style={{ width: `${pct}%` }} />
          </div>
          <span className="font-mono text-[12px] text-text-secondary">{sp} / {tierMax} XP</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <Button className="bg-warn text-bg shadow-glow-warn hover:bg-warn hover:brightness-110">
          Купить Premium · 590₽
        </Button>
        <span className="max-w-[260px] text-right text-xs text-text-secondary">
          Анлок всех Premium-наград + 25% XP
        </span>
      </div>
    </div>
  )
}

type CellState = 'collected' | 'current' | 'locked'
type Cell = { tier: number; name: string; state: CellState; premium?: boolean }

const FREE: Cell[] = [
  { tier: 20, name: '300 XP', state: 'collected' },
  { tier: 21, name: 'Бейдж Iron', state: 'collected' },
  { tier: 22, name: '500 XP', state: 'collected' },
  { tier: 23, name: 'Эмодзи Pack', state: 'current' },
  { tier: 24, name: '700 XP', state: 'locked' },
  { tier: 25, name: 'Code Theme', state: 'locked' },
]

const PREMIUM: Cell[] = [
  { tier: 20, name: 'Hero Card', state: 'locked', premium: true },
  { tier: 21, name: '500 gems', state: 'locked', premium: true },
  { tier: 22, name: 'Custom AI Avatar', state: 'locked', premium: true },
  { tier: 23, name: 'Animated Frame', state: 'locked', premium: true },
  { tier: 24, name: '1000 gems', state: 'locked', premium: true },
  { tier: 25, name: 'Hero Card', state: 'locked', premium: true },
]

function FreeCell({ c }: { c: Cell }) {
  const isCurrent = c.state === 'current'
  const isCollected = c.state === 'collected'
  return (
    <div
      className={`relative flex h-[120px] flex-col items-center justify-center gap-2 rounded-lg border bg-surface-2 p-3 ${
        isCurrent ? 'border-accent shadow-glow' : 'border-border'
      } ${c.state === 'locked' ? 'opacity-60' : ''}`}
    >
      <span className="absolute left-2 top-2 font-mono text-[10px] text-text-muted">T{c.tier}</span>
      {isCurrent && (
        <span className="absolute right-2 top-2 rounded-full bg-accent px-1.5 py-0.5 font-mono text-[9px] font-bold text-text-primary">
          СЕЙЧАС
        </span>
      )}
      <div className="grid h-12 w-12 place-items-center rounded-md bg-gradient-to-br from-surface-3 to-accent/40">
        {c.state === 'locked' ? (
          <Lock className="h-5 w-5 text-text-muted" />
        ) : isCollected ? (
          <Check className="h-5 w-5 text-success" />
        ) : (
          <Sparkles className="h-5 w-5 text-cyan" />
        )}
      </div>
      <span className="text-center text-[11px] font-semibold text-text-primary">{c.name}</span>
    </div>
  )
}

function PremiumCell({ c }: { c: Cell }) {
  return (
    <div className="relative flex h-[120px] flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-warn/40 bg-gradient-to-br from-warn/20 to-pink/20 p-3">
      <span className="absolute left-2 top-2 font-mono text-[10px] text-warn">T{c.tier}</span>
      <div className="grid h-12 w-12 place-items-center rounded-md bg-gradient-to-br from-warn to-pink">
        <Crown className="h-5 w-5 text-bg" />
      </div>
      <span className="text-center text-[11px] font-semibold text-text-primary">{c.name}</span>
      <div className="absolute inset-0 flex items-center justify-center bg-bg/70 opacity-0 transition-opacity hover:opacity-100">
        <span className="font-mono text-[11px] font-semibold text-warn">Купи Premium</span>
      </div>
      <Lock className="absolute bottom-2 right-2 h-3 w-3 text-warn" />
    </div>
  )
}

function ScopeBtn({ label, active }: { label: string; active?: boolean }) {
  return (
    <button
      className={`rounded-md px-3.5 py-2 text-sm transition-colors ${
        active ? 'bg-surface-2 font-semibold text-text-primary' : 'font-medium text-text-secondary hover:bg-surface-2'
      }`}
    >
      {label}
    </button>
  )
}

function BattlePass() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="font-display text-2xl font-bold text-text-primary">Боевой пропуск</h2>
        <div className="flex items-center gap-1 overflow-x-auto">
          <ScopeBtn label="Tier 19" />
          <ScopeBtn label="Tier 20–25" active />
          <ScopeBtn label="Tier 25–30" />
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-2xl bg-surface-1 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <div className="font-mono text-[12px] font-semibold tracking-[0.08em] text-text-secondary lg:w-32">FREE</div>
          <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {FREE.map((c) => (
              <FreeCell key={c.tier} c={c} />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <div className="font-mono text-[12px] font-semibold tracking-[0.08em] text-warn lg:w-32">👑 PREMIUM</div>
          <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {PREMIUM.map((c) => (
              <PremiumCell key={c.tier} c={c} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function GemsCard() {
  const packs = [
    { gems: '500', price: '99₽' },
    { gems: '1 200', price: '229₽', badge: 'POP' },
    { gems: '3 000', price: '499₽' },
    { gems: '6 500', price: '999₽', badge: 'BEST' },
  ]
  return (
    <Card className="flex-1 flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <Gem className="h-4 w-4 text-cyan" />
        <h3 className="font-display text-base font-bold text-text-primary">Gems пакеты</h3>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {packs.map((p) => (
          <div key={p.gems} className="relative flex flex-col items-center gap-2 rounded-lg border border-border bg-surface-2 p-3">
            {p.badge && (
              <span className="absolute -top-2 right-2 rounded-full bg-warn px-1.5 py-0.5 font-mono text-[9px] font-bold text-bg">
                {p.badge}
              </span>
            )}
            <Gem className="h-6 w-6 text-cyan" />
            <span className="font-display text-sm font-bold text-text-primary">{p.gems} 💎</span>
            <span className="font-mono text-[11px] text-text-muted">{p.price}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function ThemesCard() {
  const themes = [
    { name: 'Cyberpunk', grad: 'from-pink to-accent' },
    { name: 'Forest', grad: 'from-success to-cyan' },
    { name: 'Sunset', grad: 'from-warn to-pink' },
  ]
  return (
    <Card className="flex-1 flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <Palette className="h-4 w-4 text-pink" />
        <h3 className="font-display text-base font-bold text-text-primary">Темы редактора</h3>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {themes.map((t) => (
          <div key={t.name} className="flex flex-col gap-2">
            <div className={`h-20 rounded-lg bg-gradient-to-br ${t.grad}`} />
            <span className="text-center text-[11px] font-semibold text-text-primary">{t.name}</span>
            <span className="text-center font-mono text-[10px] text-text-muted">800 💎</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function FramesCard() {
  const frames = ['Neon', 'Gold', 'Pixel', 'Royal']
  return (
    <Card className="flex-1 flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <Frame className="h-4 w-4 text-warn" />
        <h3 className="font-display text-base font-bold text-text-primary">Рамки аватара</h3>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {frames.map((f) => (
          <div key={f} className="flex flex-col items-center gap-2">
            <div className="grid h-16 w-16 place-items-center rounded-full ring-2 ring-warn ring-offset-2 ring-offset-bg">
              <div className="h-12 w-12 rounded-full bg-gradient-to-br from-accent to-cyan" />
            </div>
            <span className="text-[11px] font-semibold text-text-primary">{f}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function HeroPack() {
  return (
    <div className="flex flex-1 flex-col gap-4 rounded-xl bg-gradient-to-br from-pink to-accent p-5 shadow-glow-pink">
      <h3 className="font-display text-base font-bold text-text-primary">Hero Cards · pack</h3>
      <div className="flex justify-center gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-20 w-16 rotate-[-6deg] rounded-md bg-gradient-to-br from-bg/60 to-accent/40 ring-1 ring-white/30"
            style={{ transform: `rotate(${(i - 1) * 8}deg)` }}
          />
        ))}
      </div>
      <button className="mt-auto inline-flex items-center justify-center rounded-md bg-white/20 px-3.5 py-2 text-xs font-semibold text-text-primary hover:bg-white/30">
        Открыть пак · 1 500 💎
      </button>
    </div>
  )
}

function StreakFreeze() {
  return (
    <Card className="flex-1 flex-col items-center gap-3 border-warn/40 p-5">
      <Snowflake className="h-10 w-10 text-cyan" />
      <h3 className="font-display text-base font-bold text-text-primary">Streak Freeze</h3>
      <p className="text-center text-xs text-text-secondary">Защити серию на 1 день</p>
      <Button className="mt-auto bg-warn text-bg shadow-glow-warn hover:bg-warn hover:brightness-110">100 💎</Button>
    </Card>
  )
}

export default function SeasonPage() {
  return (
    <AppShellV2>
      <Hero />
      <div className="flex flex-col gap-8 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <BattlePass />
        <div className="flex flex-col gap-5">
          <h2 className="font-display text-2xl font-bold text-text-primary">Магазин</h2>
          <div className="flex flex-col gap-4 lg:flex-row lg:gap-5">
            <GemsCard />
            <ThemesCard />
          </div>
          <div className="flex flex-col gap-4 lg:flex-row lg:gap-5">
            <FramesCard />
            <HeroPack />
            <StreakFreeze />
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
