// TODO i18n
import { Gift, ChevronDown, Lock } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Avatar, type AvatarGradient } from '../components/Avatar'
import { useHeroCardsQuery } from '../lib/queries/herocards'

function ErrorChip() {
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      Не удалось загрузить
    </span>
  )
}

type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'locked'

type Card = {
  name: string
  tier: string
  tag: string
  rarity: Rarity
  power: number
  dup?: boolean
  initials: string
  gradient: AvatarGradient
}

const CARDS: Card[] = [
  { name: '@alexey', tier: 'Grandmaster', tag: 'Algorithms', rarity: 'mythic', power: 987, initials: 'A', gradient: 'gold' },
  { name: '@kirill_dev', tier: 'Diamond I', tag: 'Strings', rarity: 'epic', power: 842, initials: 'K', gradient: 'pink-violet' },
  { name: '@you', tier: 'Diamond III', tag: 'DP', rarity: 'legendary', power: 768, initials: 'Y', gradient: 'gold' },
  { name: '@nastya', tier: 'Platinum I', tag: 'Graph', rarity: 'rare', power: 612, dup: true, initials: 'N', gradient: 'cyan-violet' },
  { name: '@vasya', tier: 'Gold II', tag: 'Trees', rarity: 'common', power: 421, initials: 'V', gradient: 'violet-cyan' },
  { name: '@anton', tier: 'Diamond II', tag: 'Algorithms', rarity: 'epic', power: 798, initials: 'A', gradient: 'pink-violet' },
  { name: '@lera', tier: 'Platinum III', tag: 'SQL', rarity: 'rare', power: 588, dup: true, initials: 'L', gradient: 'cyan-violet' },
  { name: '@misha', tier: 'Diamond IV', tag: 'System', rarity: 'legendary', power: 712, initials: 'M', gradient: 'gold' },
  { name: '@denis', tier: 'Gold I', tag: 'Math', rarity: 'common', power: 388, initials: 'D', gradient: 'violet-cyan' },
  { name: '???', tier: 'Locked', tag: '—', rarity: 'locked', power: 0, initials: '?', gradient: 'violet-cyan' },
  { name: '@yulia', tier: 'Platinum II', tag: 'Hash', rarity: 'rare', power: 561, initials: 'Y', gradient: 'cyan-violet' },
  { name: '???', tier: 'Locked', tag: '—', rarity: 'locked', power: 0, initials: '?', gradient: 'violet-cyan' },
  { name: '@oleg', tier: 'Diamond III', tag: 'Greedy', rarity: 'epic', power: 803, dup: true, initials: 'O', gradient: 'pink-violet' },
  { name: '@tanya_eng', tier: 'Gold III', tag: 'Strings', rarity: 'common', power: 359, initials: 'T', gradient: 'violet-cyan' },
  { name: '???', tier: 'Locked', tag: '—', rarity: 'locked', power: 0, initials: '?', gradient: 'violet-cyan' },
]

const RARITY_BORDER: Record<Rarity, string> = {
  common: 'border-text-muted',
  rare: 'border-cyan',
  epic: 'border-pink',
  legendary: 'border-warn',
  mythic: 'border-warn',
  locked: 'border-border',
}

const RARITY_LABEL: Record<Rarity, string> = {
  common: 'COMMON',
  rare: 'RARE',
  epic: 'EPIC',
  legendary: 'LEGENDARY',
  mythic: 'MYTHIC',
  locked: 'LOCKED',
}

const RARITY_TEXT: Record<Rarity, string> = {
  common: 'text-text-muted',
  rare: 'text-cyan',
  epic: 'text-pink',
  legendary: 'text-warn',
  mythic: 'text-warn',
  locked: 'text-text-muted',
}

const RARITY_BG: Record<Rarity, string> = {
  common: 'bg-gradient-to-br from-surface-3 to-surface-1',
  rare: 'bg-gradient-to-br from-cyan/30 to-surface-1',
  epic: 'bg-gradient-to-br from-pink/30 to-surface-1',
  legendary: 'bg-gradient-to-br from-warn/30 to-surface-1',
  mythic: 'bg-gradient-to-br from-warn/40 via-pink/30 to-accent/30',
  locked: 'bg-surface-1',
}

function HeaderRow({ unlocked, total, dups, showcase, showcaseMax, packPrice, isError }: { unlocked: number; total: number; dups: number; showcase: number; showcaseMax: number; packPrice: number; isError: boolean }) {
  return (
    <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl lg:text-[32px] font-extrabold leading-[1.1] text-text-primary">Hero Cards</h1>
        <p className="text-sm text-text-secondary">Коллекция карточек игроков · открыто {unlocked} / {total} · {dups} дубликатов</p>
        {isError && <ErrorChip />}
      </div>
      <div className="flex items-center gap-3">
        <span className="rounded-full border border-accent bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent-hover">
          Шоукейс: {showcase} / {showcaseMax}
        </span>
        <Button variant="primary" icon={<Gift className="h-4 w-4" />} className="bg-warn text-bg shadow-glow-warn hover:bg-warn/90">
          Открыть пак <span className="ml-1 font-mono">{packPrice} 💎</span>
        </Button>
      </div>
    </div>
  )
}

const RARITIES = [
  { label: 'Все', cls: 'border-accent bg-accent/15 text-accent-hover' },
  { label: 'Common', cls: 'border-border bg-surface-2 text-text-muted' },
  { label: 'Rare', cls: 'border-cyan/40 bg-cyan/10 text-cyan' },
  { label: 'Epic', cls: 'border-pink/40 bg-pink/10 text-pink' },
  { label: 'Legendary', cls: 'border-warn/40 bg-warn/10 text-warn' },
  { label: 'Mythic', cls: 'border-warn/40 bg-gradient-to-r from-warn/20 to-pink/20 text-warn' },
]

function FilterStrip() {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-center gap-2 overflow-x-auto">
        {RARITIES.map((r) => (
          <button key={r.label} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${r.cls}`}>{r.label}</button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-secondary">
          По силе <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-secondary">
          🔁 Дубликаты
        </button>
      </div>
    </div>
  )
}

function HeroCard({ card }: { card: Card }) {
  const locked = card.rarity === 'locked'
  return (
    <div
      className={`relative flex h-[280px] flex-col overflow-hidden rounded-[14px] border-2 ${RARITY_BORDER[card.rarity]} ${locked ? 'opacity-50' : ''}`}
    >
      <div className={`relative grid h-[160px] place-items-center ${RARITY_BG[card.rarity]}`}>
        {locked ? (
          <Lock className="h-12 w-12 text-text-muted" />
        ) : (
          <Avatar size="xl" gradient={card.gradient} initials={card.initials} className="!h-20 !w-20" />
        )}
        {/* holographic shimmer */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-white/0" />
        {card.dup && (
          <span className="absolute right-2 top-2 rounded-md bg-warn px-1.5 py-0.5 font-mono text-[10px] font-bold text-bg">x2</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 bg-surface-1 p-3">
        <span className="font-sans text-[14px] font-bold text-text-primary">{card.name}</span>
        <span className="font-mono text-[10px] text-text-muted">{card.tier}</span>
        {!locked && (
          <span className="inline-flex w-fit rounded-full bg-cyan/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-cyan">{card.tag}</span>
        )}
        <div className="mt-auto flex items-end justify-between">
          <span className={`font-mono text-[10px] font-bold ${RARITY_TEXT[card.rarity]}`}>{RARITY_LABEL[card.rarity]}</span>
          {!locked && <span className="font-display text-sm font-bold text-accent-hover">{card.power}</span>}
        </div>
      </div>
    </div>
  )
}

function CardsGrid() {
  return (
    <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {CARDS.map((c, i) => (
        <HeroCard key={i} card={c} />
      ))}
    </div>
  )
}

function SelectedDetail() {
  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl border-2 border-warn bg-surface-2"
      style={{ boxShadow: '0 0 40px rgba(251,191,36,0.4)' }}
    >
      <div className="relative grid h-[280px] place-items-center bg-gradient-to-br from-warn to-danger">
        <Avatar size="xl" gradient="gold" initials="A" className="!h-[140px] !w-[140px]" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-white/0" />
      </div>
      <div className="flex flex-col gap-3 p-[18px]">
        <div className="flex flex-col">
          <span className="font-display text-2xl font-extrabold text-text-primary">@alexey</span>
          <span className="font-mono text-xs text-text-muted">Grandmaster · #1 global</span>
        </div>
        <p className="text-xs text-text-secondary">Легенда сезонов 1-4. Решил 4 200+ задач, чемпион EU финалов.</p>
        <div className="flex gap-3 border-y border-border py-3">
          <div className="flex flex-1 flex-col items-center"><span className="font-display text-base font-bold text-danger">987</span><span className="text-[10px] text-text-muted">ATK</span></div>
          <div className="flex flex-1 flex-col items-center"><span className="font-display text-base font-bold text-cyan">642</span><span className="text-[10px] text-text-muted">DEF</span></div>
          <div className="flex flex-1 flex-col items-center"><span className="font-display text-base font-bold text-warn">823</span><span className="text-[10px] text-text-muted">SPD</span></div>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" className="flex-1">В шоукейс +</Button>
          <Button variant="ghost" size="sm" className="flex-1">Обменять</Button>
        </div>
      </div>
    </div>
  )
}

function PackPreview() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-gradient-to-br from-accent to-pink p-5">
      <h3 className="font-display text-lg font-bold text-text-primary">Mythic Pack</h3>
      <p className="text-xs text-white/80">Гарантирован Epic+ · 5 карт</p>
      <div className="flex h-20 items-center justify-center gap-2">
        {[-3, 0, 3].map((rot, i) => (
          <div
            key={i}
            className="h-16 w-12 bg-text-primary/20"
            style={{
              clipPath: 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)',
              transform: `rotate(${rot}deg)`,
            }}
          />
        ))}
      </div>
      <Button variant="primary" className="bg-text-primary text-bg shadow-none hover:bg-white/90">
        Открыть · 1500 💎
      </Button>
    </div>
  )
}

function TradeHub() {
  const trades = [
    { from: '@vasya', want: 'Epic+', delta: '~600 💎' },
    { from: '@lera', want: 'Rare swap', delta: '0' },
    { from: '@oleg', want: 'Legendary', delta: '+200 💎' },
  ]
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-5">
      <h3 className="font-display text-base font-bold text-text-primary">Активные обмены</h3>
      {trades.map((t, i) => (
        <div key={i} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-text-primary">{t.from}</span>
            <span className="font-mono text-[10px] text-text-muted">хочет {t.want}</span>
          </div>
          <span className="font-mono text-xs text-cyan">{t.delta}</span>
        </div>
      ))}
    </div>
  )
}

export default function HeroCardsPage() {
  const { data, isError } = useHeroCardsQuery()
  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <HeaderRow
          unlocked={data?.unlocked ?? 23}
          total={data?.total ?? 47}
          dups={data?.duplicates ?? 6}
          showcase={data?.showcase ?? 5}
          showcaseMax={data?.showcase_max ?? 5}
          packPrice={data?.pack_price ?? 1500}
          isError={isError}
        />
        <FilterStrip />
        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <CardsGrid />
          <div className="flex w-full flex-col gap-5 lg:w-[360px]">
            <SelectedDetail />
            <PackPreview />
            <TradeHub />
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
