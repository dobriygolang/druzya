import {
  ArrowRight,
  Check,
  Lock,
  Plus,
  Sparkles,
  Swords,
  Users,
  Video,
  Zap,
  Lock as LockIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import type { ReactNode } from 'react'
import { useRatingMeQuery, useLeaderboardQuery } from '../lib/queries/rating'

function HeaderRow() {
  const { t } = useTranslation('arena')
  const { data: rating, isError } = useRatingMeQuery()
  const totalMatches = rating?.ratings?.reduce((acc, r) => acc + r.matches_count, 0) ?? 0
  return (
    <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[32px]">
          {t('title')}
        </h1>
        <p className="text-sm text-text-secondary">
          {isError
            ? t('subtitle_error')
            : t('subtitle_played', { count: totalMatches })}
        </p>
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 px-4 py-2.5">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-muted">
          {t('party')}
        </span>
        <div className="h-4 w-px bg-border" />
        <Avatar size="sm" gradient="violet-cyan" initials="Д" />
        <Button variant="ghost" size="sm" className="px-3">
          {t('solo')}
        </Button>
      </div>
    </div>
  )
}

function HeroQueue() {
  const { t } = useTranslation('arena')
  return (
    <div className="flex w-full flex-col items-start justify-between gap-4 rounded-xl border border-border-strong bg-gradient-to-br from-surface-2 to-surface-3 p-5 shadow-card sm:p-7 lg:h-[180px] lg:flex-row lg:items-center lg:gap-0">
      <div className="flex flex-col gap-2">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-accent-hover">
          <Swords className="h-3 w-3" /> {t('ranked_1v1_tag')}
        </span>
        <h2 className="font-display text-[28px] font-bold text-text-primary">
          {t('ready_for_match')}
        </h2>
        <p className="font-mono text-xs text-text-muted">
          {t('estimate')}
        </p>
      </div>
      <Button
        variant="primary"
        icon={<Swords className="h-[18px] w-[18px]" />}
        iconRight={<ArrowRight className="h-4 w-4" />}
        className="px-6 py-3.5 text-sm shadow-glow"
      >
        {t('find_opponent')}
      </Button>
    </div>
  )
}

type ModelCard = {
  name: string
  tier: string
  free: boolean
  price?: string
}

const MODELS: ModelCard[] = [
  { name: 'GPT-4o', tier: 'OpenAI', free: true },
  { name: 'Sonnet 4.5', tier: 'Anthropic', free: true },
  { name: 'GPT-5', tier: 'OpenAI', free: false, price: '₽490/мес' },
  { name: 'Opus 4.5', tier: 'Anthropic', free: false, price: '₽790/мес' },
  { name: 'Custom', tier: 'Свой ключ', free: false, price: '₽290/мес' },
]

function ModelTile({ m }: { m: ModelCard }) {
  return (
    <div
      className={[
        'flex h-[140px] flex-1 flex-col justify-between rounded-lg border p-3.5',
        m.free
          ? 'border-border bg-surface-1'
          : 'border-border bg-surface-1 opacity-70',
      ].join(' ')}
    >
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="font-display text-sm font-bold text-text-primary">
            {m.name}
          </span>
          <span className="font-mono text-[10px] text-text-muted">{m.tier}</span>
        </div>
        {m.free ? (
          <span className="grid h-6 w-6 place-items-center rounded-full bg-success/20">
            <Check className="h-3.5 w-3.5 text-success" />
          </span>
        ) : (
          <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-3">
            <Lock className="h-3.5 w-3.5 text-text-muted" />
          </span>
        )}
      </div>
      <div className="flex items-center justify-between">
        {m.free ? (
          <span className="rounded-full bg-success/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-success">
            FREE
          </span>
        ) : (
          <span className="rounded-full bg-warn/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-warn">
            PRO
          </span>
        )}
        {!m.free && m.price && (
          <span className="font-mono text-[10px] text-text-muted">{m.price}</span>
        )}
      </div>
    </div>
  )
}

function AiPanel() {
  const { t } = useTranslation('arena')
  return (
    <Card className="flex-col gap-4 p-5 lg:h-[220px]" interactive={false}>
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h3 className="flex items-center gap-2 font-display text-lg font-bold text-text-primary">
            <Sparkles className="h-4 w-4 text-pink" />
            {t('ai_helper_title')}
          </h3>
          <p className="text-xs text-text-secondary">
            {t('ai_helper_desc')}
          </p>
        </div>
        <span className="font-mono text-[11px] text-text-muted">{t('models_count')}</span>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:flex">
        {MODELS.map((m) => (
          <ModelTile key={m.name} m={m} />
        ))}
      </div>
    </Card>
  )
}

type Mode = {
  name: string
  desc: string
  count: number
  time: string
  icon: ReactNode
  gradient: string
}

const MODES: Mode[] = [
  {
    name: 'Ranked 1v1',
    desc: 'Классика. Алгоритмы, рейтинг, LP.',
    count: 412,
    time: '~12с',
    icon: <Swords className="h-7 w-7 text-text-primary" />,
    gradient: 'from-accent to-pink',
  },
  {
    name: 'Casual 1v1',
    desc: 'Без рейтинга, для практики.',
    count: 286,
    time: '~8с',
    icon: <Zap className="h-7 w-7 text-text-primary" />,
    gradient: 'from-cyan to-accent',
  },
  {
    name: 'Ranked 2v2',
    desc: 'Командный режим, парный код.',
    count: 168,
    time: '~24с',
    icon: <Users className="h-7 w-7 text-text-primary" />,
    gradient: 'from-pink to-warn',
  },
  {
    name: 'Mock Interview',
    desc: 'Симуляция собеса с таймером.',
    count: 94,
    time: '~45с',
    icon: <Video className="h-7 w-7 text-text-primary" />,
    gradient: 'from-success to-cyan',
  },
  {
    name: 'AI-allowed Interview',
    desc: 'Собес с разрешённым AI.',
    count: 132,
    time: '~30с',
    icon: <Sparkles className="h-7 w-7 text-text-primary" />,
    gradient: 'from-warn to-danger',
  },
  {
    name: 'Custom Lobby',
    desc: 'Свои правила, лобби с кодом.',
    count: 48,
    time: '~60с',
    icon: <LockIcon className="h-7 w-7 text-text-primary" />,
    gradient: 'from-surface-3 to-accent',
  },
]

function ModeCard({ m }: { m: Mode }) {
  const { t } = useTranslation('arena')
  return (
    <Card className="flex-1 flex-col gap-4 p-5" interactive>
      <div
        className={`grid h-16 w-16 place-items-center rounded-xl bg-gradient-to-br ${m.gradient} shadow-card`}
      >
        {m.icon}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-lg font-bold text-text-primary">{m.name}</h3>
        <p className="text-xs text-text-secondary">{m.desc}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
        <span className="font-mono text-[11px] text-text-muted">
          {t('in_queue', { count: m.count, time: m.time })}
        </span>
      </div>
      <Button variant="ghost" size="sm" className="mt-auto w-full">
        {t('enter')}
      </Button>
    </Card>
  )
}

function FriendsStrip() {
  const { t } = useTranslation('arena')
  const { data: lb } = useLeaderboardQuery('algorithms')
  const gradients = ['violet-cyan', 'pink-violet', 'cyan-violet', 'success-cyan'] as const
  const top = lb?.entries?.slice(0, 4) ?? []
  const friends =
    top.length > 0
      ? top.map((e, i) => ({
          initials: e.username.charAt(0).toUpperCase(),
          username: `@${e.username}`,
          gradient: gradients[i % gradients.length],
        }))
      : [
          { initials: 'А', username: '@alexey', gradient: gradients[0] },
          { initials: 'К', username: '@kirill_dev', gradient: gradients[1] },
          { initials: 'Н', username: '@nastya', gradient: gradients[2] },
          { initials: 'М', username: '@misha', gradient: gradients[3] },
        ]
  return (
    <Card className="flex-col items-start justify-between gap-4 p-4 lg:flex-row lg:items-center" interactive={false}>
      <div className="flex flex-wrap items-center gap-4">
        <span className="font-display text-sm font-bold text-text-primary">
          {t('friends_online', { count: friends.length })}
        </span>
        <div className="flex -space-x-2">
          {friends.map((f, i) => (
            <Avatar key={i} size="md" gradient={f.gradient} initials={f.initials} status="online" />
          ))}
        </div>
        <span className="font-mono text-[11px] text-text-muted">
          {friends.map((f) => f.username).join(' · ')}
        </span>
      </div>
      <button className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-2 font-sans text-[13px] font-semibold text-accent-hover hover:bg-accent/20">
        <Plus className="h-3.5 w-3.5" />
        {t('create_party')}
      </button>
    </Card>
  )
}

export default function ArenaPage() {
  const { t } = useTranslation('arena')
  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <HeaderRow />
        <HeroQueue />
        <AiPanel />
        <div className="flex flex-col gap-4">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-xl font-bold text-text-primary">{t('all_modes')}</h2>
            <span className="font-mono text-[11px] text-text-muted">{t('modes_available')}</span>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {MODES.map((m) => (
              <ModeCard key={m.name} m={m} />
            ))}
          </div>
        </div>
        <FriendsStrip />
      </div>
    </AppShellV2>
  )
}
