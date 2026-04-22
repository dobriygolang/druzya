import { useState } from 'react'
import { Share2, UserPlus, Trophy, Shield, Flame, Star, Zap, Target, Award, Crown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { cn } from '../lib/cn'
import { useProfileQuery } from '../lib/queries/profile'
import { useRatingMeQuery, useLeaderboardQuery } from '../lib/queries/rating'
import { useStreakQuery } from '../lib/queries/daily'

function Hero() {
  const { t } = useTranslation('profile')
  const { data: profile, isError } = useProfileQuery()
  const { data: rating } = useRatingMeQuery()
  const { data: streak } = useStreakQuery()
  const username = profile?.username ?? 'you'
  const display = profile?.display_name ?? '—'
  const initial = (profile?.display_name ?? 'Д').charAt(0).toUpperCase()
  const gps = rating?.global_power_score ?? 0
  const algo = rating?.ratings?.find((r) => r.section === 'algorithms')
  const matches = algo?.matches_count ?? 0
  const streakCur = streak?.current ?? 0
  return (
    <div
      className="relative flex flex-col items-start justify-between gap-5 px-4 py-6 sm:px-8 lg:flex-row lg:items-center lg:gap-0 lg:px-10 lg:py-0"
      style={{
        minHeight: 220,
        background: 'linear-gradient(135deg, #582CFF 0%, #F472B6 50%, #22D3EE 100%)',
      }}
    >
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-6">
        <div
          className="grid shrink-0 place-items-center rounded-full font-display text-4xl font-extrabold text-white ring-4 ring-white"
          style={{
            width: 96,
            height: 96,
            background: 'linear-gradient(135deg, #582CFF 0%, #22D3EE 100%)',
          }}
        >
          {initial}
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-bold leading-none text-white sm:text-4xl lg:text-[38px]">@{username}</h1>
          <p className="text-sm text-white/85">
            {t('since', { display })}
            {isError && ` · ${t('load_failed')}`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-4 lg:gap-6">
            <HeroStat label={t('rank')} value={profile?.title ?? '—'} sub={`Lv ${profile?.level ?? '—'}`} />
            <HeroStat label={t('gps')} value={`${gps}`} sub={t('matches', { count: matches })} />
            <HeroStat label={t('streak')} value={`${streakCur} 🔥`} sub={t('days')} />
            <HeroStat label={t('class')} value={profile?.char_class ?? '—'} sub={profile?.career_stage ?? ''} />
          </div>
        </div>
      </div>
      <div className="flex w-full flex-row gap-2 lg:w-auto lg:flex-col">
        <Button
          variant="ghost"
          icon={<Share2 className="h-4 w-4" />}
          className="border-white/40 bg-white/15 text-white hover:bg-white/25"
        >
          {t('share')}
        </Button>
        <Button
          variant="primary"
          icon={<UserPlus className="h-4 w-4" />}
          className="bg-white text-bg shadow-none hover:bg-white/90 hover:shadow-none"
        >
          {t('add_friend')}
        </Button>
      </div>
    </div>
  )
}

function HeroStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/70">{label}</span>
      <span className="font-display text-base font-bold text-white">{value}</span>
      <span className="font-mono text-[11px] text-white/80">{sub}</span>
    </div>
  )
}

const PROFILE_TABS = ['Overview', 'Matches', 'Achievements', 'Guilds', 'Stats'] as const
type ProfileTab = (typeof PROFILE_TABS)[number]

function ProfileTabBar({ tab, setTab }: { tab: ProfileTab; setTab: (t: ProfileTab) => void }) {
  const { t: tt } = useTranslation('profile')
  const tabKey: Record<ProfileTab, string> = {
    Overview: 'tabs.overview',
    Matches: 'tabs.matches',
    Achievements: 'tabs.achievements',
    Guilds: 'tabs.guilds',
    Stats: 'tabs.stats',
  }
  return (
    <div className="flex h-[56px] items-center gap-1 overflow-x-auto border-b border-border bg-bg px-4 sm:px-8 lg:px-10">
      {PROFILE_TABS.map((tname) => {
        const active = tab === tname
        return (
          <button
            key={tname}
            onClick={() => setTab(tname)}
            className={cn(
              'relative h-full px-4 text-sm font-semibold transition-colors',
              active
                ? 'bg-surface-2 text-text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-accent'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {tt(tabKey[tname])}
          </button>
        )
      })}
    </div>
  )
}

const FALLBACK_SKILLS = [
  { name: 'Algorithms', value: 82, delta: '+12', up: true },
  { name: 'Data Structures', value: 76, delta: '+8', up: true },
  { name: 'Dynamic Programming', value: 48, delta: '+5', up: true },
  { name: 'Graph Theory', value: 64, delta: '+2', up: true },
  { name: 'Concurrency', value: 41, delta: '-3', up: false },
] as const

const SECTION_LABELS: Record<string, string> = {
  algorithms: 'Algorithms',
  sql: 'SQL',
  go: 'Go',
  system_design: 'System Design',
  behavioral: 'Behavioral',
}

function SkillsCard() {
  const { t } = useTranslation('profile')
  const { data: rating } = useRatingMeQuery()
  const skills = rating?.ratings?.length
    ? rating.ratings.map((r) => ({
        name: SECTION_LABELS[r.section] ?? r.section,
        value: Math.min(100, r.percentile),
        delta: r.decaying ? '↓' : `${r.elo}`,
        up: !r.decaying,
      }))
    : FALLBACK_SKILLS
  return (
    <Card className="flex-col gap-4 p-5">
      <h3 className="font-display text-base font-bold text-text-primary">{t('skills')}</h3>
      <div className="flex flex-col gap-3">
        {skills.map((s) => (
          <div key={s.name} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-text-secondary">{s.name}</span>
              <span className={cn('font-mono text-[12px] font-semibold', s.up ? 'text-success' : 'text-danger')}>
                {s.delta}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-black/30">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan to-accent"
                style={{ width: `${s.value}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

const BADGES = [
  { icon: Trophy, gradient: 'from-warn to-pink', label: 'Speed' },
  { icon: Flame, gradient: 'from-pink to-danger', label: 'Streak' },
  { icon: Star, gradient: 'from-cyan to-accent', label: 'Top 5%' },
  { icon: Zap, gradient: 'from-accent to-pink', label: 'Combo' },
  { icon: Target, gradient: 'from-success to-cyan', label: 'Sniper' },
  { icon: Award, gradient: 'from-warn to-accent', label: 'Veteran' },
] as const

function AchievementsCard() {
  const { t } = useTranslation('profile')
  const { data: profile } = useProfileQuery()
  const earned = profile?.achievements?.length ?? 0
  return (
    <Card className="flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-text-primary">{t('achievements_title')}</h3>
        <span className="font-mono text-[11px] text-text-muted">{earned} / 120</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {BADGES.map((b) => {
          const Icon = b.icon
          return (
            <div
              key={b.label}
              className={cn(
                'flex aspect-square flex-col items-center justify-center gap-1 rounded-lg bg-gradient-to-br p-2',
                b.gradient,
              )}
            >
              <Icon className="h-5 w-5 text-white" />
              <span className="font-mono text-[10px] font-semibold text-white">{b.label}</span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function GuildCard() {
  const { t } = useTranslation('profile')
  return (
    <Card className="flex-col gap-0 overflow-hidden p-0" interactive={false}>
      <div className="flex flex-col gap-2 bg-gradient-to-br from-accent via-pink to-cyan p-5">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-white" />
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-white">{t('guild_label')}</span>
        </div>
        <h3 className="font-display text-xl font-extrabold text-white">Ironclad</h3>
        <p className="text-xs text-white/85">{t('guild_top')}</p>
      </div>
      <div className="flex items-center justify-between p-4">
        <div className="flex flex-col">
          <span className="font-mono text-[11px] text-text-muted">{t('rank_in_guild')}</span>
          <span className="font-display text-base font-bold text-text-primary">#3 / 32</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="font-mono text-[11px] text-text-muted">{t('your_contribution')}</span>
          <span className="font-display text-base font-bold text-cyan">{t('points', { n: '2 140' })}</span>
        </div>
      </div>
    </Card>
  )
}

type Scope = 'global' | 'friends' | 'guild' | 'region'
const SCOPES: Scope[] = ['global', 'friends', 'guild', 'region']

const LEADERBOARD_ROWS = [
  { rank: 1, name: '@alexey', tier: 'Grandmaster', lp: '3 420', wl: '510-180', wr: '74%', delta: '+240' },
  { rank: 2, name: '@kirill_dev', tier: 'Grandmaster', lp: '3 180', wl: '470-210', wr: '69%', delta: '+180' },
  { rank: 3, name: '@masha.k', tier: 'Diamond I', lp: '2 980', wl: '410-220', wr: '65%', delta: '+150' },
  { rank: 4, name: '@nastya', tier: 'Diamond I', lp: '2 910', wl: '380-200', wr: '66%', delta: '+90' },
  { rank: 5, name: '@vlad_codes', tier: 'Diamond II', lp: '2 870', wl: '360-220', wr: '62%', delta: '+74' },
  { rank: 6, name: '@oleg.ds', tier: 'Diamond II', lp: '2 860', wl: '340-200', wr: '63%', delta: '+60' },
  { rank: 7, name: '@anna_qa', tier: 'Diamond III', lp: '2 855', wl: '330-210', wr: '61%', delta: '+45' },
  { rank: 8, name: '@max_be', tier: 'Diamond III', lp: '2 850', wl: '300-180', wr: '63%', delta: '+30' },
  { rank: 9, name: '@ira.fe', tier: 'Diamond III', lp: '2 845', wl: '290-180', wr: '62%', delta: '+12' },
  { rank: 284, name: '@you', tier: 'Diamond III', lp: '2 840', wl: '284-176', wr: '62%', delta: '+124', you: true },
  { rank: 285, name: '@petya', tier: 'Diamond III', lp: '2 838', wl: '270-180', wr: '60%', delta: '-8' },
  { rank: 286, name: '@stepan', tier: 'Diamond III', lp: '2 830', wl: '265-185', wr: '59%', delta: '-22' },
] as const

function MedalBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="grid h-7 w-7 place-items-center rounded-full bg-warn font-display text-[13px] font-bold text-bg">
        <Crown className="h-3.5 w-3.5" />
      </span>
    )
  if (rank === 2)
    return (
      <span className="grid h-7 w-7 place-items-center rounded-full bg-[#C0C0C0] font-display text-[13px] font-bold text-bg">
        2
      </span>
    )
  if (rank === 3)
    return (
      <span className="grid h-7 w-7 place-items-center rounded-full bg-[#CD7F32] font-display text-[13px] font-bold text-white">
        3
      </span>
    )
  return (
    <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-1 font-mono text-[12px] font-semibold text-text-secondary">
      {rank}
    </span>
  )
}

function Leaderboard() {
  const { t } = useTranslation('profile')
  const [scope, setScope] = useState<Scope>('global')
  const { data: lb, isError } = useLeaderboardQuery('algorithms')
  const rows = lb?.entries
    ? lb.entries.map((e) => ({
        rank: e.rank,
        name: `@${e.username}`,
        tier: e.title ?? '—',
        lp: `${e.elo}`,
        wl: '—',
        wr: '—',
        delta: '+0',
      }))
    : LEADERBOARD_ROWS
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-surface-2 min-w-0">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h3 className="font-display text-lg font-bold text-text-primary">{t('leaderboard')}</h3>
        <div className="flex items-center gap-1 rounded-md bg-surface-1 p-1">
          {SCOPES.map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={cn(
                'h-7 rounded px-3 text-[12px] font-semibold transition-colors',
                scope === s ? 'bg-accent text-text-primary' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {t(`scopes.${s}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <button className="rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[12px] font-semibold text-text-secondary hover:text-text-primary">
          Сезон 4 ▾
        </button>
        <button className="rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[12px] font-semibold text-text-secondary hover:text-text-primary">
          Diamond+ ▾
        </button>
      </div>
      <div className="grid grid-cols-[50px_1fr_70px_90px_60px_60px] min-w-[640px] items-center gap-3 border-b border-border px-5 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
        <span>{t('table.rank')}</span>
        <span>{t('table.player')}</span>
        <span className="text-right">{t('table.lp')}</span>
        <span className="text-right">{t('table.wl')}</span>
        <span className="text-right">{t('table.wr')}</span>
        <span className="text-right">{t('table.delta')}</span>
      </div>
      <div className="flex-1 overflow-x-auto">
        {isError && (
          <div className="px-5 py-2 text-[12px] text-danger">{t('load_failed')}</div>
        )}
        {rows.map((r) => {
          const isYou = 'you' in r && (r as { you?: boolean }).you
          const positive = r.delta.startsWith('+')
          return (
            <div
              key={r.rank}
              className={cn(
                'grid grid-cols-[50px_1fr_70px_90px_60px_60px] min-w-[640px] items-center gap-3 px-5 py-2.5 text-[13px] transition-colors',
                isYou
                  ? 'sticky bottom-0 z-10 border-y border-accent bg-accent/15'
                  : 'border-b border-border/50 hover:bg-surface-1/40',
              )}
            >
              <MedalBadge rank={r.rank} />
              <div className="flex items-center gap-2.5">
                <Avatar size="sm" gradient="violet-cyan" initials={r.name[1]?.toUpperCase()} />
                <div className="flex flex-col leading-tight">
                  <span className={cn('text-sm font-semibold', isYou ? 'text-text-primary' : 'text-text-primary')}>
                    {r.name}
                  </span>
                  <span className="font-mono text-[10px] text-text-muted">{r.tier}</span>
                </div>
              </div>
              <span className="text-right font-mono text-[13px] font-semibold text-text-primary">{r.lp}</span>
              <span className="text-right font-mono text-[12px] text-text-secondary">{r.wl}</span>
              <span className="text-right font-mono text-[12px] text-cyan">{r.wr}</span>
              <span
                className={cn(
                  'text-right font-mono text-[12px] font-semibold',
                  positive ? 'text-success' : 'text-danger',
                )}
              >
                {r.delta}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ProfilePage() {
  const [tab, setTab] = useState<ProfileTab>('Overview')
  return (
    <AppShellV2>
      <Hero />
      <ProfileTabBar tab={tab} setTab={setTab} />
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:flex-row lg:px-10 lg:py-8">
        <div className="flex w-full flex-col gap-5 lg:w-[380px]">
          <SkillsCard />
          <AchievementsCard />
          <GuildCard />
        </div>
        <Leaderboard />
      </div>
    </AppShellV2>
  )
}
