import { useState } from 'react'
import { Share2, UserPlus, Trophy, Shield, Flame, Star, Zap, Target, Award, Crown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useParams, Link } from 'react-router-dom'
import { AppShellV2 } from '../components/AppShell'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { cn } from '../lib/cn'
import {
  useProfileQuery,
  usePublicProfileQuery,
  type Profile,
  type PublicProfile,
} from '../lib/queries/profile'
import { useRatingMeQuery, useLeaderboardQuery } from '../lib/queries/rating'
import { useStreakQuery } from '../lib/queries/daily'
import { ApiError } from '../lib/apiClient'

// ProfileViewModel is the union of /profile/me and /profile/{username}
// rendered fields. Public-only routes get a partial — the UI degrades
// gracefully when private fields (xp, ai_credits, etc.) are absent.
type ProfileViewModel = {
  isOwn: boolean
  username: string
  display: string
  initial: string
  title: string
  level: number
  charClass: string
  careerStage: string
  globalPowerScore: number
}

function toViewModel(args: {
  isOwn: boolean
  own?: Profile
  pub?: PublicProfile
  fallbackScore?: number
}): ProfileViewModel | null {
  const { isOwn, own, pub, fallbackScore } = args
  if (isOwn) {
    if (!own) return null
    return {
      isOwn: true,
      username: own.username,
      display: own.display_name || own.username,
      initial: (own.display_name || own.username || 'D').charAt(0).toUpperCase(),
      title: own.title || '—',
      level: own.level ?? 0,
      charClass: own.char_class || '—',
      careerStage: own.career_stage || '',
      globalPowerScore: own.global_power_score ?? fallbackScore ?? 0,
    }
  }
  if (!pub) return null
  return {
    isOwn: false,
    username: pub.username,
    display: pub.display_name || pub.username,
    initial: (pub.display_name || pub.username || 'D').charAt(0).toUpperCase(),
    title: pub.title || '—',
    level: pub.level ?? 0,
    charClass: pub.char_class || '—',
    careerStage: pub.career_stage || '',
    globalPowerScore: pub.global_power_score ?? 0,
  }
}

function Hero({ vm }: { vm: ProfileViewModel }) {
  const { t } = useTranslation('profile')
  const { data: rating } = useRatingMeQuery()
  const { data: streak } = useStreakQuery()
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
          aria-label="avatar"
        >
          {vm.initial}
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-bold leading-none text-white sm:text-4xl lg:text-[38px]">@{vm.username}</h1>
          <p className="text-sm text-white/85">{t('since', { display: vm.display })}</p>
          <div className="mt-2 flex flex-wrap items-center gap-4 lg:gap-6">
            <HeroStat label={t('rank')} value={vm.title} sub={`Lv ${vm.level}`} />
            <HeroStat label={t('gps')} value={`${vm.globalPowerScore}`} sub={t('matches', { count: matches })} />
            {vm.isOwn && <HeroStat label={t('streak')} value={`${streakCur} 🔥`} sub={t('days')} />}
            <HeroStat label={t('class')} value={vm.charClass} sub={vm.careerStage} />
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
        {!vm.isOwn && (
          <Button
            variant="primary"
            icon={<UserPlus className="h-4 w-4" />}
            className="bg-white text-bg shadow-none hover:bg-white/90 hover:shadow-none"
          >
            {t('add_friend')}
          </Button>
        )}
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

const SECTION_LABELS: Record<string, string> = {
  algorithms: 'Algorithms',
  sql: 'SQL',
  go: 'Go',
  system_design: 'System Design',
  behavioral: 'Behavioral',
}

// SkillsCard renders the live section ratings only — no synthetic fallback.
// When there are no ratings yet (new user) the card explicitly says so;
// previously we filled it with mock skills which gave a misleading impression
// of accomplishment.
function SkillsCard() {
  const { t } = useTranslation('profile')
  const { data: rating, isLoading } = useRatingMeQuery()
  const skills = (rating?.ratings ?? []).map((r) => ({
    name: SECTION_LABELS[r.section] ?? r.section,
    value: Math.min(100, r.percentile),
    delta: r.decaying ? '↓' : `${r.elo}`,
    up: !r.decaying,
  }))
  return (
    <Card className="flex-col gap-4 p-5">
      <h3 className="font-display text-base font-bold text-text-primary">{t('skills')}</h3>
      {isLoading && <div className="font-mono text-[12px] text-text-muted">…</div>}
      {!isLoading && skills.length === 0 && (
        <div className="font-mono text-[12px] text-text-muted">{t('skills_empty', { defaultValue: 'No matches yet' })}</div>
      )}
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

function AchievementsCard({ profile }: { profile?: Profile }) {
  const { t } = useTranslation('profile')
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

// GuildCard remains a stub for Phase 1 — guild membership has its own domain
// (services/guild) and dedicated cache concerns. Pending Phase 2: switch to
// useGuildQuery() once the GET /guilds/me endpoint stabilises.
function GuildCard() {
  const { t } = useTranslation('profile')
  return (
    <Card className="flex-col gap-0 overflow-hidden p-0" interactive={false}>
      <div className="flex flex-col gap-2 bg-gradient-to-br from-accent via-pink to-cyan p-5">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-white" />
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-white">{t('guild_label')}</span>
        </div>
        <h3 className="font-display text-xl font-extrabold text-white">—</h3>
        <p className="text-xs text-white/85">{t('guild_top', { defaultValue: 'Join a guild to climb together' })}</p>
      </div>
      <div className="flex items-center justify-between p-4">
        <Link to="/guild" className="font-mono text-[12px] font-semibold text-cyan hover:underline">
          {t('open_guild', { defaultValue: 'Open guild ›' })}
        </Link>
      </div>
    </Card>
  )
}

type Scope = 'global' | 'friends' | 'guild' | 'region'
const SCOPES: Scope[] = ['global', 'friends', 'guild', 'region']

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

// Leaderboard renders only real entries from the rating service. No fallback
// roster is rendered — when the leaderboard is empty (or the network is
// down) the user sees an explicit empty/error state instead of synthetic data.
function Leaderboard() {
  const { t } = useTranslation('profile')
  const [scope, setScope] = useState<Scope>('global')
  const { data: lb, isError, isLoading, refetch } = useLeaderboardQuery('algorithms')
  const rows = (lb?.entries ?? []).map((e) => ({
    rank: e.rank,
    name: `@${e.username}`,
    tier: e.title ?? '—',
    lp: `${e.elo}`,
    wl: '—',
    wr: '—',
    delta: '+0',
  }))
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
      <div className="grid grid-cols-[50px_1fr_70px_90px_60px_60px] min-w-[640px] items-center gap-3 border-b border-border px-5 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
        <span>{t('table.rank')}</span>
        <span>{t('table.player')}</span>
        <span className="text-right">{t('table.lp')}</span>
        <span className="text-right">{t('table.wl')}</span>
        <span className="text-right">{t('table.wr')}</span>
        <span className="text-right">{t('table.delta')}</span>
      </div>
      <div className="flex-1 overflow-x-auto">
        {isLoading && <div className="px-5 py-3 text-[12px] text-text-muted">…</div>}
        {isError && (
          <div className="flex items-center justify-between px-5 py-3 text-[12px] text-danger">
            <span>{t('load_failed')}</span>
            <button onClick={() => refetch()} className="font-mono text-[12px] text-accent hover:underline">
              {t('retry', { defaultValue: 'Retry' })}
            </button>
          </div>
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <div className="px-5 py-3 text-[12px] text-text-muted">
            {t('leaderboard_empty', { defaultValue: 'No entries yet' })}
          </div>
        )}
        {rows.map((r) => {
          const positive = r.delta.startsWith('+')
          return (
            <div
              key={r.rank}
              className="grid grid-cols-[50px_1fr_70px_90px_60px_60px] min-w-[640px] items-center gap-3 px-5 py-2.5 text-[13px] transition-colors border-b border-border/50 hover:bg-surface-1/40"
            >
              <MedalBadge rank={r.rank} />
              <div className="flex items-center gap-2.5">
                <Avatar size="sm" gradient="violet-cyan" initials={r.name[1]?.toUpperCase()} />
                <div className="flex flex-col leading-tight">
                  <span className="text-sm font-semibold text-text-primary">{r.name}</span>
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

// ── states ─────────────────────────────────────────────────────────────────

function ProfileSkeleton() {
  return (
    <AppShellV2>
      <div
        className="px-4 py-6 sm:px-8 lg:px-10"
        style={{ minHeight: 220, background: 'linear-gradient(135deg, #582CFF 0%, #F472B6 50%, #22D3EE 100%)' }}
        aria-busy="true"
        aria-label="loading profile"
      >
        <div className="h-24 w-24 animate-pulse rounded-full bg-white/20" />
        <div className="mt-4 h-6 w-40 animate-pulse rounded bg-white/20" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-white/15" />
      </div>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:flex-row lg:px-10 lg:py-8">
        <div className="h-72 w-full animate-pulse rounded-xl bg-surface-2 lg:w-[380px]" />
        <div className="h-72 flex-1 animate-pulse rounded-xl bg-surface-2" />
      </div>
    </AppShellV2>
  )
}

function ProfileError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('profile')
  return (
    <AppShellV2>
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8">
        <h2 className="font-display text-xl font-bold text-text-primary">
          {t('error_title', { defaultValue: 'Could not load profile' })}
        </h2>
        <p className="max-w-md text-center text-sm text-text-secondary">{t('load_failed')}</p>
        <Button variant="primary" onClick={onRetry}>
          {t('retry', { defaultValue: 'Retry' })}
        </Button>
      </div>
    </AppShellV2>
  )
}

function ProfileNotFound({ username }: { username: string }) {
  const { t } = useTranslation('profile')
  return (
    <AppShellV2>
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8">
        <h2 className="font-display text-xl font-bold text-text-primary">
          {t('not_found_title', { defaultValue: 'Profile not found' })}
        </h2>
        <p className="max-w-md text-center text-sm text-text-secondary">@{username}</p>
        <Link to="/sanctum">
          <Button variant="primary">{t('back_to_sanctum', { defaultValue: 'Back to Sanctum' })}</Button>
        </Link>
      </div>
    </AppShellV2>
  )
}

// ── page ───────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const params = useParams<{ username?: string }>()
  const isOwn = !params.username
  const [tab, setTab] = useState<ProfileTab>('Overview')

  const ownQuery = useProfileQuery()
  const publicQuery = usePublicProfileQuery(isOwn ? undefined : params.username)
  const { data: rating } = useRatingMeQuery()

  const active = isOwn ? ownQuery : publicQuery

  if (active.isLoading) return <ProfileSkeleton />
  if (active.isError) {
    const status = (active.error as ApiError | null)?.status
    if (!isOwn && status === 404) {
      return <ProfileNotFound username={params.username ?? ''} />
    }
    return <ProfileError onRetry={() => active.refetch()} />
  }

  const vm = toViewModel({
    isOwn,
    own: isOwn ? (ownQuery.data as Profile | undefined) : undefined,
    pub: !isOwn ? (publicQuery.data as PublicProfile | undefined) : undefined,
    fallbackScore: rating?.global_power_score,
  })
  if (!vm) return <ProfileSkeleton />

  return (
    <AppShellV2>
      <Hero vm={vm} />
      <ProfileTabBar tab={tab} setTab={setTab} />
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:flex-row lg:px-10 lg:py-8">
        <div className="flex w-full shrink-0 flex-col gap-5 lg:w-[380px]">
          <SkillsCard />
          {isOwn && <AchievementsCard profile={ownQuery.data} />}
          <GuildCard />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <Leaderboard />
        </div>
      </div>
    </AppShellV2>
  )
}
