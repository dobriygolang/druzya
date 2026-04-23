import { useState } from 'react'
import { Share2, UserPlus, Trophy, Shield, Crown } from 'lucide-react'
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
import { useAchievementsQuery, isUnlocked } from '../lib/queries/achievements'
import { useArenaHistoryQuery } from '../lib/queries/matches'
import { useMyGuildQuery } from '../lib/queries/guild'
import { useMyBookingsQuery, useCancelSlot, type MyBookingItem } from '../lib/queries/slot'
import { ApiError } from '../lib/apiClient'
import { humanizeDifficulty, humanizeSection } from '../lib/labels'

// Date helpers — anti-fallback policy: never render "Invalid Date" or
// "1 января 1970". Backend returns ISO timestamps, but a fresh user has
// no finished matches / unlocked achievements yet, in which case the
// server may emit an empty string or a zero-Timestamp. Show an em-dash.
function fmtDateTime(iso?: string | null): string {
  if (!iso || iso.startsWith('1970-')) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t) || t === 0) return '—'
  return new Date(t).toLocaleString('ru-RU')
}
function fmtDate(iso?: string | null): string {
  if (!iso || iso.startsWith('1970-')) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t) || t === 0) return '—'
  return new Date(t).toLocaleDateString('ru-RU')
}

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

const PROFILE_TABS_OWN = ['Overview', 'Matches', 'Achievements', 'Guilds', 'Stats', 'Bookings'] as const
const PROFILE_TABS_PUBLIC = ['Overview', 'Matches', 'Achievements', 'Guilds', 'Stats'] as const
type ProfileTab = (typeof PROFILE_TABS_OWN)[number]

function ProfileTabBar({ tab, setTab, isOwn }: { tab: ProfileTab; setTab: (t: ProfileTab) => void; isOwn: boolean }) {
  const { t: tt } = useTranslation('profile')
  const tabKey: Record<ProfileTab, string> = {
    Overview: 'tabs.overview',
    Matches: 'tabs.matches',
    Achievements: 'tabs.achievements',
    Guilds: 'tabs.guilds',
    Stats: 'tabs.stats',
    Bookings: 'tabs.bookings',
  }
  const tabs = isOwn ? PROFILE_TABS_OWN : PROFILE_TABS_PUBLIC
  return (
    <div className="flex h-[56px] items-center gap-1 overflow-x-auto border-b border-border bg-bg px-4 sm:px-8 lg:px-10">
      {tabs.map((tname) => {
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
        <div className="font-mono text-[12px] text-text-muted">{t('skills_empty')}</div>
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

// AchievementsCard renders ONLY achievements the user has actually unlocked.
// Previously this was a hardcoded badge grid that mislead users into thinking
// they had achievements they hadn't earned (production complaint #18).
function AchievementsCard() {
  const { t } = useTranslation('profile')
  const { data, isLoading, isError } = useAchievementsQuery()
  const unlocked = (data ?? []).filter(isUnlocked)
  return (
    <Card className="flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-text-primary">{t('achievements_title')}</h3>
        <span className="font-mono text-[11px] text-text-muted">
          {unlocked.length} / {data?.length ?? 0}
        </span>
      </div>
      {isLoading && <p className="font-mono text-[12px] text-text-muted">…</p>}
      {isError && <p className="text-[12px] text-danger">Не удалось загрузить ачивки.</p>}
      {!isLoading && !isError && unlocked.length === 0 && (
        <p className="text-[12px] text-text-muted">
          Пока ничего не разблокировано. Сыграй матч, реши задачу — первая ачивка близко.
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        {unlocked.slice(0, 6).map((a) => (
          <div
            key={a.code}
            title={a.title}
            className={cn(
              'flex aspect-square flex-col items-center justify-center gap-1 rounded-lg p-2',
              a.tier === 'legendary'
                ? 'bg-gradient-to-br from-warn to-pink'
                : a.tier === 'rare'
                  ? 'bg-gradient-to-br from-cyan to-accent'
                  : 'bg-gradient-to-br from-surface-3 to-surface-2',
            )}
          >
            <Trophy className="h-5 w-5 text-white" />
            <span className="line-clamp-1 font-mono text-[10px] font-semibold text-white">{a.title}</span>
          </div>
        ))}
      </div>
      {unlocked.length > 6 && (
        <Link to="/achievements" className="font-mono text-[11px] text-cyan hover:underline">
          Все ачивки ›
        </Link>
      )}
    </Card>
  )
}

// GuildCard now reads useMyGuildQuery — shows real membership or empty state.
function GuildCard() {
  const { t } = useTranslation('profile')
  const { data: guild, isLoading } = useMyGuildQuery()
  if (isLoading) {
    return (
      <Card className="flex-col gap-2 p-5">
        <div className="h-4 w-1/3 animate-pulse rounded bg-surface-3" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-surface-3" />
      </Card>
    )
  }
  if (!guild) {
    return (
      <Card className="flex-col gap-0 overflow-hidden p-0" interactive={false}>
        <div className="flex flex-col gap-2 bg-gradient-to-br from-accent via-pink to-cyan p-5">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-white" />
            <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-white">{t('guild_label')}</span>
          </div>
          <h3 className="font-display text-xl font-extrabold text-white">Без гильдии</h3>
          <p className="text-xs text-white/85">Найди команду — рейтинги, войны, общие награды.</p>
        </div>
        <div className="flex items-center justify-between p-4">
          <Link to="/guild" className="font-mono text-[12px] font-semibold text-cyan hover:underline">
            Найти гильдию ›
          </Link>
        </div>
      </Card>
    )
  }
  return (
    <Card className="flex-col gap-0 overflow-hidden p-0" interactive={false}>
      <div className="flex flex-col gap-2 bg-gradient-to-br from-accent via-pink to-cyan p-5">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-white" />
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-white">{t('guild_label')}</span>
        </div>
        <h3 className="font-display text-xl font-extrabold text-white">{guild.name}</h3>
        <p className="text-xs text-white/85">
          {(guild.members?.length ?? 0)} участников · ELO {guild.guild_elo}
        </p>
      </div>
      <div className="flex items-center justify-between p-4">
        <Link to="/guild" className="font-mono text-[12px] font-semibold text-cyan hover:underline">
          Открыть гильдию ›
        </Link>
      </div>
    </Card>
  )
}

// Leaderboard scopes — only "global" is implemented end-to-end. The other
// scopes (friends/guild/region) were previously rendered as fake tabs that
// returned the same hardcoded data; per production feedback we now expose
// only what we can actually back with real data.
type Scope = 'global'
const SCOPES: Scope[] = ['global']

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
  const [scope] = useState<Scope>('global')
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
            <span
              key={s}
              className={cn(
                'h-7 rounded px-3 text-[12px] font-semibold leading-7 transition-colors',
                scope === s ? 'bg-accent text-text-primary' : 'text-text-secondary',
              )}
            >
              {t(`scopes.${s}`)}
            </span>
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
              {t('retry')}
            </button>
          </div>
        )}
        {!isLoading && !isError && rows.length === 0 && (
          <div className="px-5 py-3 text-[12px] text-text-muted">
            {t('leaderboard_empty')}
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
          {t('error_title')}
        </h2>
        <p className="max-w-md text-center text-sm text-text-secondary">{t('load_failed')}</p>
        <Button variant="primary" onClick={onRetry}>
          {t('retry')}
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
          {t('not_found_title')}
        </h2>
        <p className="max-w-md text-center text-sm text-text-secondary">@{username}</p>
        <Link to="/sanctum">
          <Button variant="primary">{t('back_to_sanctum')}</Button>
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
      <ProfileTabBar tab={tab} setTab={setTab} isOwn={isOwn} />
      <div className="px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
        {tab === 'Overview' && (
          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="flex w-full shrink-0 flex-col gap-5 lg:w-[380px]">
              <SkillsCard />
              {isOwn && <AchievementsCard />}
              <GuildCard />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <Leaderboard />
            </div>
          </div>
        )}
        {tab === 'Matches' && <MatchesPanel />}
        {tab === 'Achievements' && <AchievementsPanel />}
        {tab === 'Guilds' && <GuildsPanel />}
        {tab === 'Stats' && <StatsPanel ownProfile={isOwn ? (ownQuery.data as Profile | undefined) : undefined} />}
        {tab === 'Bookings' && isOwn && <BookingsPanel />}
      </div>
    </AppShellV2>
  )
}

// ── tab panels ─────────────────────────────────────────────────────────────

function MatchesPanel() {
  const { data, isLoading, isError, refetch } = useArenaHistoryQuery({ limit: 10 })
  const items = data?.items ?? []
  if (isLoading) {
    return (
      <Card className="flex-col gap-2 p-5" interactive={false}>
        <div className="h-4 w-1/3 animate-pulse rounded bg-surface-3" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-surface-3" />
      </Card>
    )
  }
  if (isError) {
    return (
      <Card className="flex-col items-start gap-3 p-5" interactive={false}>
        <p className="text-sm text-danger">Не удалось загрузить историю матчей.</p>
        <Button size="sm" onClick={() => refetch()}>Повторить</Button>
      </Card>
    )
  }
  if (items.length === 0) {
    return (
      <Card className="flex-col gap-2 p-5" interactive={false}>
        <p className="text-sm text-text-secondary">Ещё нет завершённых матчей. Сыграй на /arena.</p>
      </Card>
    )
  }
  return (
    <Card className="flex-col gap-0 overflow-hidden p-0" interactive={false}>
      <div className="border-b border-border p-5">
        <h3 className="font-display text-base font-bold text-text-primary">Последние 10 матчей</h3>
      </div>
      <div className="divide-y divide-border">
        {items.map((m) => {
          const positive = m.lp_change > 0
          const resultColor =
            m.result === 'win' ? 'text-success' : m.result === 'loss' ? 'text-danger' : 'text-text-muted'
          return (
            <div key={m.match_id} className="grid grid-cols-[1fr_120px_80px_60px] items-center gap-3 px-5 py-3 text-[13px]">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar size="sm" gradient="violet-cyan" initials={(m.opponent_username || '?').charAt(0).toUpperCase()} />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold text-text-primary">@{m.opponent_username || 'unknown'}</span>
                  <span className="font-mono text-[11px] text-text-muted">
                    {humanizeSection(m.section)} · {m.mode}
                  </span>
                </div>
              </div>
              <span className="font-mono text-[11px] text-text-muted">
                {fmtDateTime(m.finished_at)}
              </span>
              <span className={cn('font-mono text-[12px] font-bold uppercase', resultColor)}>{m.result}</span>
              <span className={cn('text-right font-mono text-[12px] font-semibold', positive ? 'text-success' : 'text-danger')}>
                {positive ? '+' : ''}{m.lp_change}
              </span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function AchievementsPanel() {
  const { data, isLoading, isError, refetch } = useAchievementsQuery()
  const unlocked = (data ?? []).filter(isUnlocked)
  if (isLoading) {
    return (
      <Card className="flex-col gap-2 p-5" interactive={false}>
        <div className="h-4 w-1/3 animate-pulse rounded bg-surface-3" />
      </Card>
    )
  }
  if (isError) {
    return (
      <Card className="flex-col items-start gap-3 p-5" interactive={false}>
        <p className="text-sm text-danger">Не удалось загрузить ачивки.</p>
        <Button size="sm" onClick={() => refetch()}>Повторить</Button>
      </Card>
    )
  }
  if (unlocked.length === 0) {
    return (
      <Card className="flex-col gap-2 p-5" interactive={false}>
        <p className="text-sm text-text-secondary">
          Ещё ничего не разблокировано. Открой <Link className="text-cyan hover:underline" to="/achievements">все ачивки</Link>, чтобы увидеть условия получения.
        </p>
      </Card>
    )
  }
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-text-primary">Разблокированные ачивки</h3>
        <Link to="/achievements" className="font-mono text-[11px] text-cyan hover:underline">Все ›</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {unlocked.map((a) => (
          <div
            key={a.code}
            className={cn(
              'flex flex-col gap-2 rounded-lg p-3',
              a.tier === 'legendary'
                ? 'bg-gradient-to-br from-warn to-pink'
                : a.tier === 'rare'
                  ? 'bg-gradient-to-br from-cyan to-accent'
                  : 'bg-surface-2',
            )}
          >
            <Trophy className="h-5 w-5 text-white" />
            <span className="font-display text-[13px] font-bold text-white">{a.title}</span>
            <span className="line-clamp-2 font-mono text-[10px] text-white/80">{a.description}</span>
            {a.unlocked_at && (
              <span className="font-mono text-[10px] text-white/60">
                {fmtDate(a.unlocked_at)}
              </span>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

function GuildsPanel() {
  const { data: guild, isLoading, isError, refetch } = useMyGuildQuery()
  if (isLoading) {
    return (
      <Card className="flex-col gap-2 p-5" interactive={false}>
        <div className="h-4 w-1/3 animate-pulse rounded bg-surface-3" />
      </Card>
    )
  }
  if (isError) {
    return (
      <Card className="flex-col items-start gap-3 p-5" interactive={false}>
        <p className="text-sm text-danger">Не удалось загрузить гильдию.</p>
        <Button size="sm" onClick={() => refetch()}>Повторить</Button>
      </Card>
    )
  }
  if (!guild) {
    return (
      <Card className="flex-col items-start gap-3 p-5" interactive={false}>
        <p className="text-sm text-text-secondary">Ты пока без гильдии.</p>
        <Link to="/guild"><Button size="sm">Найти гильдию</Button></Link>
      </Card>
    )
  }
  return (
    <Card className="flex-col gap-3 p-5" interactive={false}>
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-cyan" />
        <div className="flex flex-col">
          <h3 className="font-display text-lg font-bold text-text-primary">{guild.name}</h3>
          <span className="font-mono text-[11px] text-text-muted">
            {(guild.members?.length ?? 0)} участников · ELO {guild.guild_elo}
          </span>
        </div>
      </div>
      <Link to="/guild" className="font-mono text-[12px] text-cyan hover:underline">
        Открыть страницу гильдии ›
      </Link>
    </Card>
  )
}

function StatsPanel({ ownProfile }: { ownProfile?: Profile }) {
  const { data: rating, isLoading } = useRatingMeQuery()
  if (isLoading) {
    return (
      <Card className="flex-col gap-2 p-5" interactive={false}>
        <div className="h-4 w-1/3 animate-pulse rounded bg-surface-3" />
      </Card>
    )
  }
  const ratings = rating?.ratings ?? []
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex-col gap-3 p-5" interactive={false}>
        <h3 className="font-display text-base font-bold text-text-primary">Сводка</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCell label="Global Score" value={String(rating?.global_power_score ?? 0)} />
          <StatCell label="Уровень" value={String(ownProfile?.level ?? 0)} />
          <StatCell label="XP" value={String(ownProfile?.xp ?? 0)} />
          <StatCell label="AI кредиты" value={String(ownProfile?.ai_credits ?? 0)} />
        </div>
      </Card>
      <Card className="flex-col gap-3 p-5" interactive={false}>
        <h3 className="font-display text-base font-bold text-text-primary">Рейтинг по секциям</h3>
        {ratings.length === 0 ? (
          <p className="text-[12px] text-text-muted">Ещё не сыграл ни одного матча.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {ratings.map((r) => (
              <div key={r.section} className="flex flex-col gap-1 rounded-lg bg-surface-2 p-3">
                <span className="font-mono text-[10px] uppercase text-text-muted">{humanizeSection(r.section)}</span>
                <span className="font-display text-lg font-bold text-text-primary">{r.elo}</span>
                <span className="font-mono text-[11px] text-text-muted">{r.matches_count} матчей</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-2 p-3">
      <span className="font-mono text-[10px] uppercase text-text-muted">{label}</span>
      <span className="font-display text-xl font-bold text-text-primary">{value}</span>
    </div>
  )
}

// ── Bookings panel ─────────────────────────────────────────────────────────
//
// Renders the list returned by useMyBookingsQuery (chi-direct
// GET /api/v1/slot/my/bookings). Each card reflects a (booking, slot) pair —
// derived UI state combines booking.status + slot.status + starts_at:
//   - cancelled: booking was cancelled (terminal)
//   - completed: slot status === 'completed' or 'no_show'
//   - active:    starts in the next 30 минут OR already started but
//                duration window not over
//   - upcoming:  starts later than now
// The "Подключиться" CTA is shown only for active/upcoming с meet_url.
// "Отменить" — only for upcoming (active = слишком поздно).

const SECTION_RU: Record<string, string> = {
  algorithms: 'Алгоритмы',
  sql: 'SQL',
  go: 'Go',
  system_design: 'System Design',
  behavioral: 'Behavioral',
}

type BookingState = 'upcoming' | 'active' | 'completed' | 'cancelled'

function deriveBookingState(b: MyBookingItem, now: Date = new Date()): BookingState {
  if (b.status === 'cancelled' || b.slot_status === 'cancelled') return 'cancelled'
  if (b.slot_status === 'completed' || b.slot_status === 'no_show') return 'completed'
  const startMs = new Date(b.starts_at).getTime()
  if (Number.isNaN(startMs)) return 'upcoming'
  const endMs = startMs + b.duration_min * 60_000
  const nowMs = now.getTime()
  if (nowMs >= startMs && nowMs <= endMs) return 'active'
  if (nowMs > endMs) return 'completed'
  // активный, если до старта меньше 30 минут
  if (startMs - nowMs <= 30 * 60_000) return 'active'
  return 'upcoming'
}

function bookingStateLabel(s: BookingState): string {
  switch (s) {
    case 'upcoming': return 'Скоро'
    case 'active': return 'Сейчас'
    case 'completed': return 'Завершено'
    case 'cancelled': return 'Отменено'
  }
}

function bookingStateColor(s: BookingState): string {
  switch (s) {
    case 'upcoming': return 'bg-cyan/15 text-cyan'
    case 'active': return 'bg-success/20 text-success'
    case 'completed': return 'bg-surface-3 text-text-muted'
    case 'cancelled': return 'bg-danger/15 text-danger'
  }
}

function BookingCard({ b }: { b: MyBookingItem }) {
  const cancel = useCancelSlot()
  const state = deriveBookingState(b)
  const sectionLabel = SECTION_RU[b.section] ?? b.section
  const startsDate = new Date(b.starts_at)
  const dateStr = isNaN(startsDate.getTime()) ? b.starts_at : startsDate.toLocaleString('ru-RU', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
  const canJoin = (state === 'upcoming' || state === 'active') && !!b.meet_url
  const canCancel = state === 'upcoming'
  const onCancel = () => {
    if (!confirm('Отменить бронь? Слот вернётся в каталог.')) return
    cancel.mutate(b.slot_id)
  }
  return (
    <Card className="flex-col gap-3 p-4" interactive={false}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-display text-sm font-bold text-text-primary">
            Mock · {sectionLabel}
          </span>
          <span className="font-mono text-[11px] text-text-muted">
            {dateStr} · {b.duration_min} мин
          </span>
        </div>
        <span className={cn('rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase', bookingStateColor(state))}>
          {bookingStateLabel(state)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[12px] text-text-secondary">
        <span>Роль: <span className="text-text-primary">кандидат</span></span>
        {b.difficulty && <span>· Уровень: {humanizeDifficulty(b.difficulty)}</span>}
        <span>· {b.language}</span>
        <span>· {b.price_rub}₽</span>
      </div>
      {(canJoin || canCancel) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {canJoin && b.meet_url && (
            <a
              href={b.meet_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-2 rounded-md bg-accent px-3 text-[12px] font-semibold text-text-primary shadow-glow hover:bg-accent/90"
            >
              Подключиться
            </a>
          )}
          {canCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={cancel.isPending}
            >
              {cancel.isPending ? 'Отменяю…' : 'Отменить'}
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}

function BookingsPanel() {
  const { data, isLoading, isError, refetch } = useMyBookingsQuery()
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-20 animate-pulse rounded-xl bg-surface-2" />
        <div className="h-20 animate-pulse rounded-xl bg-surface-2" />
      </div>
    )
  }
  if (isError) {
    return (
      <Card className="flex-col items-start gap-3 p-5" interactive={false}>
        <p className="text-sm text-danger">Не удалось загрузить брони.</p>
        <Button size="sm" onClick={() => refetch()}>Повторить</Button>
      </Card>
    )
  }
  const items = data ?? []
  if (items.length === 0) {
    return (
      <Card className="flex-col items-start gap-3 p-5" interactive={false}>
        <p className="text-sm text-text-secondary">
          Нет броней. Запиши слот через{' '}
          <Link to="/slots" className="text-cyan hover:underline">/slots →</Link>
        </p>
      </Card>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {items.map((b) => <BookingCard key={b.id} b={b} />)}
    </div>
  )
}
