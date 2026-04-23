import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Flame, Play, Sparkles, Shield, Swords, RefreshCw, Search } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AppShellV2 } from '../components/AppShell'
import { SanctumTour } from './onboarding/SanctumTour'
import { staggerContainer, staggerItem } from '../lib/motion'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { EmptyState } from '../components/EmptyState'
import { useDailyKataQuery, useStreakQuery } from '../lib/queries/daily'
import { useSeasonQuery } from '../lib/queries/season'
import { useRatingMeQuery, useLeaderboardQuery } from '../lib/queries/rating'
import { useProfileQuery } from '../lib/queries/profile'
import { useArenaHistoryQuery } from '../lib/queries/matches'
import { useMyGuildQuery, useGuildWarQuery } from '../lib/queries/guild'
import { useWeeklyReportQuery } from '../lib/queries/weekly'
import { cn } from '../lib/cn'
import { humanizeDifficulty, humanizeSection } from '../lib/labels'

function ErrorChip() {
  const { t } = useTranslation('errors')
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      {t('load_failed')}
    </span>
  )
}

// ── Pull-to-refresh ────────────────────────────────────────────────────────
//
// Native-feel rubber-band gesture (sm-app.jsx · F · PTR spec). Active only
// when the document is scrolled to the very top and the user touches with one
// finger. Pull dy is divided by `resistance` so the indicator drags at half
// finger speed (rubber band). At ≥ threshold release fires onRefresh, the
// indicator locks at 42px and a spinner runs until the promise settles.
function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const startY = useRef<number | null>(null)
  const [offset, setOffset] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [armed, setArmed] = useState(false)
  const RESIST = 0.5
  const THRESHOLD = 80
  const LOCK = 42

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (refreshing) return
    if (window.scrollY > 0) return
    startY.current = e.touches[0].clientY
  }, [refreshing])

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (startY.current === null || refreshing) return
    const dy = e.touches[0].clientY - startY.current
    if (dy <= 0) {
      setOffset(0)
      setArmed(false)
      return
    }
    const eased = dy * RESIST
    setOffset(Math.min(eased, 120))
    setArmed(eased >= THRESHOLD)
  }, [refreshing])

  const onTouchEnd = useCallback(() => {
    if (startY.current === null) return
    const wasArmed = armed
    startY.current = null
    setArmed(false)
    if (wasArmed && !refreshing) {
      setRefreshing(true)
      setOffset(LOCK)
      onRefresh()
        .catch(() => {/* surfaced via parent error state */})
        .finally(() => {
          setRefreshing(false)
          setOffset(0)
        })
    } else {
      setOffset(0)
    }
  }, [armed, refreshing, onRefresh])

  useEffect(() => {
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [onTouchStart, onTouchMove, onTouchEnd])

  return { offset, refreshing, armed }
}

function PtrIndicator({ offset, refreshing, armed }: { offset: number; refreshing: boolean; armed: boolean }) {
  if (offset <= 0 && !refreshing) return null
  const label = refreshing ? 'обновляю…' : armed ? 'отпусти' : 'тяни'
  return (
    <div
      className="pointer-events-none flex items-center justify-center overflow-hidden text-cyan transition-[height] duration-150 ease-out sm:hidden"
      style={{ height: offset }}
    >
      <div className="flex items-center gap-2 pt-2 font-mono text-[10px] uppercase tracking-[0.14em]">
        <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
        <span>{label}</span>
      </div>
    </div>
  )
}

// ── Mobile sub-header (sm-app.jsx · MobileTopBar) ─────────────────────────
// Lives below the AppShell TopNav; on phones the AppShell already collapses
// the nav links, so this strip just gives the page its own «Sanctum» H1 +
// search-icon + avatar pair the designer asked for. Hidden ≥sm.
function MobileSubHeader() {
  const { data: profile } = useProfileQuery()
  const initials = (profile?.display_name ?? profile?.username ?? '?').slice(0, 2).toUpperCase()
  return (
    <div className="sticky top-[64px] z-30 flex items-center justify-between border-b border-border/60 bg-bg/90 px-4 py-2.5 backdrop-blur sm:hidden">
      <h1 className="font-display text-[18px] font-extrabold text-text-primary">Sanctum</h1>
      <div className="flex items-center gap-2">
        <Link
          to="/codex"
          className="grid h-9 w-9 place-items-center rounded-md border border-border bg-surface-1 text-text-secondary"
          aria-label="Search"
        >
          <Search className="h-[15px] w-[15px]" />
        </Link>
        <Avatar size="sm" gradient="cyan-violet" initials={initials} />
      </div>
    </div>
  )
}

// ── Hero greeting ─────────────────────────────────────────────────────────
function HeroGreeting() {
  const { t } = useTranslation(['sanctum'])
  const { data: streak } = useStreakQuery()
  const { data: profile } = useProfileQuery()
  // Sanctum-bug 2026-04 (#3): when the profile has no display_name AND no
  // username (fresh accounts before settings finish), the old code rendered
  // "С возвращением, —" — embarrassing. Fall back through display_name →
  // username → anonymous greeting (no trailing dash).
  const cleanName =
    (profile?.display_name && profile.display_name.trim()) ||
    (profile?.username && profile.username.trim()) ||
    ''
  const current = streak?.current ?? 0
  // Sanctum-bug 2026-04 (#2): "Найти соперника" CTA removed from the hero.
  // The same action lives in the Arena card row below + the bottom-nav FAB
  // on mobile, so the hero entry was redundant.
  return (
    <div className="flex flex-col items-start gap-1.5">
      <h1 className="font-display text-[22px] font-bold leading-[0.95] text-text-primary sm:text-[28px] lg:text-[40px] lg:leading-[1.1]">
        {cleanName ? t('sanctum:welcome', { name: cleanName }) : t('sanctum:welcome_anon')}
      </h1>
      <p className="text-[12px] text-text-secondary sm:text-[13px] lg:text-sm">
        {t('sanctum:subtitle', { streak: current })}
      </p>
    </div>
  )
}

function fmtTimeUntilUTCMidnight(now: Date = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0))
  const diff = next.getTime() - now.getTime()
  if (diff <= 0) return '00:00'
  const totalSec = Math.floor(diff / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec - h * 3600) / 60)
  const s = totalSec - h * 3600 - m * 60
  if (h > 0) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// DailyHero — `compact` shrinks H2 + paddings + the "passed today" stat for
// 320px. Same data, denser layout.
function DailyHero({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation('sanctum')
  const { data: kata, isError, isLoading } = useDailyKataQuery()
  const { data: streak } = useStreakQuery()
  const day = streak?.current ?? 0
  const title = kata?.task?.title ?? (isLoading ? '...' : 'Сегодняшняя задача недоступна')
  const difficulty = kata?.task?.difficulty
  const section = kata?.task?.section
  const meta = [humanizeDifficulty(difficulty), humanizeSection(section)]
    .filter((v) => v && v !== '—')
    .join(' · ') || '—'
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const remaining = fmtTimeUntilUTCMidnight(now)
  return (
    <Card
      className={cn(
        'flex-1 flex-col gap-4',
        compact ? 'p-4 sm:p-5 lg:p-7' : 'p-5 lg:p-7',
      )}
      interactive={false}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[0.08em] text-warn sm:text-[11px]">
            <Flame className="h-3 w-3" /> {t('daily_kata_day', { day })}
          </span>
          {isError && <ErrorChip />}
          <h2
            className={cn(
              'w-full font-display font-bold text-text-primary',
              compact ? 'text-[22px] leading-tight sm:text-2xl' : 'text-2xl',
            )}
          >
            {title}
          </h2>
          <p className="font-mono text-[10px] text-text-muted sm:text-xs">{meta}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-display text-[20px] font-bold text-cyan sm:text-[24px] lg:text-[28px]">{remaining}</span>
          <span className="text-[10px] text-text-muted sm:text-xs">{t('remaining')}</span>
        </div>
      </div>
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap gap-4 sm:gap-6" data-tour="streak">
          <Stat value={`${day} ${day > 0 ? '🔥' : ''}`} label={t('streak_days')} highlight="warn" />
          {kata?.already_submitted && <Stat value="✓" label={t('passed_today')} highlight="cyan" />}
        </div>
        <Link to="/arena/kata">
          <Button
            variant="primary"
            iconRight={<ArrowRight className="h-4 w-4" />}
            className="w-full bg-text-primary text-bg shadow-none hover:bg-white/90 hover:shadow-none sm:w-auto"
          >
            {kata?.already_submitted ? 'Открыть' : t('begin')}
          </Button>
        </Link>
      </div>
    </Card>
  )
}

function Stat({ value, label, highlight }: { value: string; label: string; highlight?: 'cyan' | 'warn' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={
          highlight === 'cyan'
            ? 'font-display text-base font-semibold text-cyan sm:text-lg'
            : highlight === 'warn'
              ? 'font-display text-base font-semibold text-warn sm:text-lg'
              : 'font-display text-base font-semibold text-text-primary sm:text-lg'
        }
      >
        {value}
      </span>
      <span className="text-[10px] text-text-muted sm:text-[11px]">{label}</span>
    </div>
  )
}

// ── Mobile stat strip (sm-app.jsx · StatStrip) ────────────────────────────
// 1.3fr-streak + 1fr-ELO + 1fr-XP. Real values from existing hooks; no fake
// «↑ +21%» trend if we don't have a delta channel.
function MobileStatStrip() {
  const { data: streak } = useStreakQuery()
  const { data: rating } = useRatingMeQuery()
  const { data: profile } = useProfileQuery()
  const algo = rating?.ratings?.find((r) => r.section === 'algorithms')
  const elo = algo?.elo ?? 0
  const xp = profile?.xp ?? 0
  const xpDisplay = xp >= 1000 ? `${(xp / 1000).toFixed(1)}k` : String(xp)
  const day = streak?.current ?? 0
  const best = streak?.longest ?? 0
  return (
    <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-2 sm:hidden">
      <div className="rounded-xl border border-pink/30 bg-pink/5 p-3">
        <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-pink">◆ streak</div>
        <div className="mt-1.5 flex items-baseline gap-1">
          <span className="font-display text-[26px] font-extrabold leading-none">{day}</span>
          <span className="font-mono text-[9px] text-text-muted">дней</span>
        </div>
        {best > 0 && <div className="mt-1 font-mono text-[9px] text-pink">🔥 rec {best}</div>}
      </div>
      <div className="rounded-xl border border-cyan/30 bg-cyan/5 p-3">
        <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-cyan">elo</div>
        <div className="mt-1.5 font-display text-[20px] font-extrabold leading-none">{elo || '—'}</div>
        <div className="mt-1 font-mono text-[9px] text-text-muted">algo</div>
      </div>
      <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
        <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-accent-hover">xp</div>
        <div className="mt-1.5 font-display text-[20px] font-extrabold leading-none">{xpDisplay}</div>
        <div className="mt-1 font-mono text-[9px] text-text-muted">lvl {profile?.level ?? '—'}</div>
      </div>
    </div>
  )
}

function SeasonRank() {
  const { t } = useTranslation('sanctum')
  const { data: season, isError } = useSeasonQuery()
  const { data: rating } = useRatingMeQuery()
  const tier = season?.tier ?? 0
  const sp = season?.my_points ?? 0
  const freeTrack = season?.tracks?.find((tr) => tr.kind === 'free')?.tiers ?? []
  const nextTier = freeTrack.find((row) => row.tier === tier + 1)
  const nextTarget = nextTier?.required_points ?? Math.max(1, (tier + 1) * 200)
  const pct = Math.min(100, Math.round((sp / Math.max(1, nextTarget)) * 100))
  const gps = rating?.global_power_score ?? 0
  const endsAt = season?.season?.ends_at
  const daysLeft = endsAt
    ? Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000))
    : 0
  return (
    <Card className="w-full flex-col gap-4 border-accent/25 bg-surface-3 p-5 lg:w-[380px] lg:p-6">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-secondary">{season?.season?.name ?? t('season_label')}</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-text-secondary">
          {t('days_to_end', { count: daysLeft })}
        </span>
      </div>
      {isError && <ErrorChip />}
      <div className="flex flex-col items-center gap-1">
        <span className="font-display text-[26px] font-extrabold text-text-primary lg:text-[30px]">{t('tier', { n: tier })}</span>
        <span className="font-mono text-[12px] text-cyan lg:text-[13px]">{gps} GPS</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-black/30">
        <div className="h-full rounded-full bg-gradient-to-r from-cyan to-accent" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-text-muted">
        <span>{t('tier', { n: tier })}</span>
        <span>{t('tier', { n: tier + 1 })}</span>
      </div>
    </Card>
  )
}

function ArenaCard() {
  const { t } = useTranslation('sanctum')
  const { data: rating } = useRatingMeQuery()
  const algo = rating?.ratings?.find((r) => r.section === 'algorithms')
  const matches = algo?.matches_count ?? 0
  const elo = algo?.elo ?? 0
  return (
    <Card className="flex-1 flex-col gap-3.5 p-5">
      <div className="flex items-center gap-2">
        <Swords className="h-4 w-4 text-pink" />
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-pink">{t('arena_label')}</span>
      </div>
      <h3 className="font-display text-xl font-bold text-text-primary">{t('ranked_1v1')}</h3>
      <div className="flex gap-4">
        <Stat value={`${matches}`} label={t('matches')} />
        <Stat value={`${elo}`} label={t('elo')} highlight="cyan" />
        <Stat value={`${algo?.percentile ?? 0}%`} label={t('percentile')} highlight="cyan" />
      </div>
      <Link to="/arena">
        <Button variant="ghost" icon={<Play className="h-3.5 w-3.5" />} className="border-accent text-accent-hover hover:bg-accent/10">
          {t('queue')}
        </Button>
      </Link>
    </Card>
  )
}

function GuildCard() {
  const { t } = useTranslation('sanctum')
  const { data: guild } = useMyGuildQuery()
  const warID = guild?.current_war_id ?? undefined
  const { data: war } = useGuildWarQuery(warID)
  if (!guild) {
    return (
      <Card className="flex-1 flex-col gap-3.5 p-5">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-cyan" />
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan">
            {t('guild_war')}
          </span>
        </div>
        <h3 className="font-display text-lg font-bold text-text-primary">Ты пока без гильдии</h3>
        <p className="text-xs text-text-secondary">
          Гильдии играют еженедельные guild-war-баталии. Найди свою или создай.
        </p>
        <Link to="/guild" className="text-xs font-semibold text-accent-hover hover:underline">
          К списку гильдий →
        </Link>
      </Card>
    )
  }
  if (!war) {
    return (
      <Card className="flex-1 flex-col gap-3.5 p-5">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-cyan" />
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan">
            {t('guild_war')}
          </span>
        </div>
        <h3 className="font-display text-lg font-bold text-text-primary">{guild.name}</h3>
        <p className="text-xs text-text-secondary">
          Активной войны нет — следующая стартует с понедельника.
        </p>
        <span className="font-mono text-xs text-text-muted">Guild ELO: {guild.guild_elo}</span>
      </Card>
    )
  }
  const scoreA = war.lines.reduce((s, l) => s + (l.score_a ?? 0), 0)
  const scoreB = war.lines.reduce((s, l) => s + (l.score_b ?? 0), 0)
  const total = Math.max(1, scoreA + scoreB)
  const aPct = Math.round((scoreA / total) * 100)
  const bPct = 100 - aPct
  return (
    <Card className="flex-1 flex-col gap-3.5 p-5">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-cyan" />
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan">
          {t('guild_war')}
        </span>
      </div>
      <h3 className="font-display text-lg font-bold text-text-primary">
        {war.guild_a.name} vs {war.guild_b.name}
      </h3>
      <div className="flex items-center gap-3">
        <span className="font-display text-[22px] font-bold text-success">{scoreA}</span>
        <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-black/30">
          <div className="h-full bg-success" style={{ width: `${aPct}%` }} />
          <div className="h-full bg-danger" style={{ width: `${bPct}%` }} />
        </div>
        <span className="font-display text-[22px] font-bold text-danger">{scoreB}</span>
      </div>
    </Card>
  )
}

function CoachCard() {
  const { t } = useTranslation('sanctum')
  const report = useWeeklyReportQuery()
  const insight = report.data?.ai_insight?.trim() ?? ''
  const preview = insight.length > 140 ? insight.slice(0, 140).trimEnd() + '…' : insight
  return (
    <div className="flex flex-1 flex-col gap-3 rounded-xl bg-gradient-to-br from-accent to-pink p-5 shadow-glow">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-text-primary" />
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-primary">
          {t('ai_mentor')}
        </span>
      </div>
      <h3 className="w-full max-w-[300px] font-display text-base font-bold text-text-primary">
        Еженедельный AI-разбор
      </h3>
      <p className="w-full max-w-[300px] text-xs leading-relaxed text-white/85">
        {insight
          ? preview
          : 'Слабые зоны, рекомендации и план — собирается по твоей активности за прошлую неделю.'}
      </p>
      <Link
        to="/weekly"
        className="inline-flex w-fit items-center gap-1.5 rounded-md bg-white/20 px-3.5 py-2 text-xs font-semibold text-text-primary hover:bg-white/30"
      >
        {insight ? 'Полный отчёт' : t('open_plan')} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}

// ── Mobile mentor card (sm-app.jsx · MentorCard) ──────────────────────────
// Cyan-tinted secondary CTA tone — does NOT compete with the FAB. Only
// surfaces when there's a real insight for the user.
function MobileMentorCard() {
  const report = useWeeklyReportQuery()
  const insight = report.data?.ai_insight?.trim() ?? ''
  if (!insight) return null
  return (
    <div className="rounded-xl border border-cyan/30 bg-gradient-to-br from-cyan/10 to-surface-1 p-4 sm:hidden">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-cyan" />
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-cyan">ai mentor</span>
      </div>
      <h3 className="mt-2 font-display text-[15px] font-bold leading-snug text-text-primary">
        Готов разбор твоей недели
      </h3>
      <p className="mt-1 font-mono text-[10.5px] text-text-muted line-clamp-2">
        {insight.length > 90 ? insight.slice(0, 90).trimEnd() + '…' : insight}
      </p>
      <Link
        to="/weekly"
        className="mt-3 inline-flex rounded-md border border-cyan/40 bg-cyan/10 px-3 py-2 font-display text-[12px] font-semibold text-cyan"
      >
        Открыть разбор →
      </Link>
    </div>
  )
}

function Leaderboard() {
  const { t } = useTranslation('sanctum')
  const { data: lb, isError, isLoading } = useLeaderboardQuery({ section: 'algorithms', limit: 5 })
  const entries = lb?.entries ?? []
  const myRank = lb?.my_rank ?? 0
  const medalBg = (idx: number) =>
    idx === 0 ? 'bg-warn text-bg'
      : idx === 1 ? 'bg-border-strong text-text-secondary'
      : idx === 2 ? 'bg-accent text-text-primary'
      : 'bg-border-strong text-text-secondary'

  return (
    <Card className="w-full flex-col gap-3 p-5 lg:w-[420px]">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-text-primary">{t('top_friends')}</h3>
        <span className="font-mono text-[11px] text-text-muted">{isError ? '—' : t('week')}</span>
      </div>
      {isError && <ErrorChip />}
      {isLoading && (
        <>
          <div className="h-9 animate-pulse rounded bg-surface-2" />
          <div className="h-9 animate-pulse rounded bg-surface-2" />
          <div className="h-9 animate-pulse rounded bg-surface-2" />
        </>
      )}
      {!isLoading && entries.length === 0 && !isError && (
        <p className="text-xs text-text-muted">
          Лидерборд секции пуст — сыграй ranked-матч.
        </p>
      )}
      {entries.map((e, idx) => {
        const you = myRank === e.rank
        return (
          <div
            key={`${e.user_id}:${e.rank}`}
            className={['flex items-center gap-3 rounded-lg px-2 py-2', you ? 'bg-accent/10' : ''].join(' ')}
          >
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full font-display text-[13px] font-bold ${medalBg(idx)}`}
            >
              {e.rank}
            </span>
            <Avatar size="sm" gradient="violet-cyan" initials={(e.username[0] ?? '?').toUpperCase()} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cn('truncate', you ? 'text-sm font-bold text-text-primary' : 'text-sm font-semibold text-text-primary')}>
                @{e.username}
              </span>
              <span className={cn('truncate font-mono text-[11px]', you ? 'text-accent-hover' : 'text-text-muted')}>
                {e.title ? `${e.title} · ${e.elo} ELO` : `${e.elo} ELO`}
              </span>
            </div>
          </div>
        )
      })}
    </Card>
  )
}

// ── Mobile mini-leaderboard (sm-app.jsx · LeaderMini) ─────────────────────
// Top-3 + dashed divider + «ты #N» row — compact replacement for the full
// list. Real data via useLeaderboardQuery; «все →» links to the full page.
function MobileLeaderMini() {
  const { data: lb, isError, isLoading } = useLeaderboardQuery({ section: 'algorithms', limit: 3 })
  const entries = (lb?.entries ?? []).slice(0, 3)
  const myRank = lb?.my_rank ?? 0
  const myEntry = (lb?.entries ?? []).find((e) => e.rank === myRank)
  const inTop3 = myRank > 0 && myRank <= 3
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4 sm:hidden">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-warn">◆ leaderboard · нед.</div>
        <Link to="/match-history" className="font-mono text-[9px] uppercase tracking-[0.14em] text-cyan">
          все →
        </Link>
      </div>
      {isError && <ErrorChip />}
      {isLoading && (
        <>
          <div className="my-1 h-7 animate-pulse rounded bg-surface-2" />
          <div className="my-1 h-7 animate-pulse rounded bg-surface-2" />
          <div className="my-1 h-7 animate-pulse rounded bg-surface-2" />
        </>
      )}
      {!isLoading && entries.length === 0 && !isError && (
        <p className="text-[11px] text-text-muted">Сыграй ranked-матч, чтобы попасть в лидерборд.</p>
      )}
      <div className="divide-y divide-border">
        {entries.map((e) => {
          const you = myRank === e.rank
          return (
            <div key={e.user_id} className={cn('flex items-center gap-3 py-2', you && 'bg-accent/10')}>
              <span className={cn('w-5 font-mono text-[11px]', e.rank === 1 ? 'text-warn' : 'text-text-muted')}>
                #{e.rank}
              </span>
              <Avatar size="sm" gradient="violet-cyan" initials={(e.username[0] ?? '?').toUpperCase()} />
              <span className="flex-1 truncate font-display text-[12px] font-semibold text-text-primary">
                @{e.username}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-text-secondary">{e.elo}</span>
            </div>
          )
        })}
        {/* You-row: only render when there's actual data and user isn't already in top-3 */}
        {!inTop3 && myRank > 0 && (
          <>
            <div className="py-1">
              <div className="border-t border-dashed border-border" />
            </div>
            <div className="-mx-2 flex items-center gap-3 rounded-md border border-accent/30 bg-accent/10 px-2 py-2">
              <span className="w-5 font-mono text-[11px] text-accent-hover">#{myRank}</span>
              <Avatar size="sm" gradient="cyan-violet" initials="Я" />
              <span className="flex-1 font-display text-[12px] font-bold text-text-primary">ты</span>
              <span className="font-mono text-[11px] tabular-nums text-text-primary">
                {myEntry?.elo ?? ''}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function fmtAgo(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diffSec = Math.max(0, Math.floor((now.getTime() - t) / 1000))
  if (diffSec < 60) return 'только что'
  const m = Math.floor(diffSec / 60)
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ч`
  const d = Math.floor(h / 24)
  return `${d} д`
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Activity — `mobileCollapsed` shows only 2 items + «показать ещё N» button
// per the sm-app.jsx accordion. On desktop expanded by default.
function Activity({ mobileCollapsed = false }: { mobileCollapsed?: boolean }) {
  const { t } = useTranslation(['sanctum', 'common'])
  const { data, isError, isLoading } = useArenaHistoryQuery({ limit: mobileCollapsed ? 5 : 3 })
  const items = data?.items ?? []
  const [open, setOpen] = useState(!mobileCollapsed)
  const visible = !mobileCollapsed || open ? items : items.slice(0, 2)

  return (
    <Card className="flex-1 flex-col gap-3 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-text-primary">
          {t('sanctum:recent_activity')}
        </h3>
        <Link to="/match-history" className="text-xs text-text-muted hover:text-text-secondary">
          {t('common:buttons.view_all')}
        </Link>
      </div>
      {isError && <ErrorChip />}
      {isLoading && (
        <>
          <div className="h-12 animate-pulse rounded bg-surface-2" />
          <div className="h-12 animate-pulse rounded bg-surface-2" />
        </>
      )}
      {!isLoading && items.length === 0 && !isError && (
        <p className="text-xs text-text-muted">
          Сыграй первый матч — он появится здесь.
        </p>
      )}
      {visible.map((m) => {
        const won = m.result === 'win'
        const lpSign = m.lp_change >= 0 ? '+' : ''
        return (
          <div key={m.match_id} className="flex items-center gap-3 py-1.5 sm:py-2">
            <span
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                won ? 'bg-success/15' : 'bg-danger/15'
              }`}
            >
              <Swords
                className={`h-4 w-4 ${won ? 'text-success' : 'text-danger'}`}
              />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[13px] font-semibold text-text-primary sm:text-sm">
                {won ? 'Победа' : m.result === 'loss' ? 'Поражение' : 'Матч'} · vs @
                {m.opponent_username || m.opponent_user_id?.slice(0, 6) || 'неизв.'}
              </span>
              <span className="truncate text-[10px] text-text-muted sm:text-[11px]">
                {humanizeSection(m.section)} · {fmtDuration(m.duration_seconds)} · {lpSign}
                {m.lp_change} LP
              </span>
            </div>
            <span className="shrink-0 font-mono text-[10px] text-text-muted sm:text-[11px]">
              {fmtAgo(m.finished_at)}
            </span>
          </div>
        )
      })}
      {mobileCollapsed && items.length > 2 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1 w-full rounded-md border border-border bg-bg/40 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-text-secondary hover:text-text-primary sm:hidden"
        >
          {open ? 'свернуть' : `показать ещё ${items.length - 2}`}
        </button>
      )}
    </Card>
  )
}

export default function SanctumPageV2() {
  const reduced = useReducedMotion()
  const [searchParams] = useSearchParams()
  const showTour = searchParams.get('tour') === '1'
  const queryClient = useQueryClient()
  const [ptrError, setPtrError] = useState<string | null>(null)

  // Pull-to-refresh: invalidate all the hooks the page reads from. Silent on
  // success per anti-fallback spec; failure surfaces an EmptyState bar.
  const onRefresh = useCallback(async () => {
    setPtrError(null)
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['daily', 'kata'] }),
        queryClient.invalidateQueries({ queryKey: ['streak'] }),
        queryClient.invalidateQueries({ queryKey: ['arena', 'history'] }),
        queryClient.invalidateQueries({ queryKey: ['rating'] }),
        queryClient.invalidateQueries({ queryKey: ['leaderboard'] }),
        queryClient.invalidateQueries({ queryKey: ['guild'] }),
        queryClient.invalidateQueries({ queryKey: ['season'] }),
      ])
    } catch (err) {
      setPtrError(err instanceof Error ? err.message : 'refresh failed')
    }
  }, [queryClient])

  const { offset, refreshing, armed } = usePullToRefresh(onRefresh)

  const containerProps = reduced
    ? {}
    : { variants: staggerContainer, initial: 'hidden', animate: 'show' }
  const itemProps = reduced ? {} : { variants: staggerItem }

  return (
    <AppShellV2>
      <MobileSubHeader />
      <PtrIndicator offset={offset} refreshing={refreshing} armed={armed} />
      {ptrError && (
        <div className="px-4 pt-3 sm:hidden">
          <EmptyState
            variant="error"
            title="Не удалось обновить"
            body={ptrError}
            compact
            cta={{ label: 'Повторить', onClick: () => onRefresh() }}
          />
        </div>
      )}

      {/* Page padding ladder: mobile p-4 / tablet p-8 / desktop p-20.
          Vertical gap ladder: mobile gap-3 / tablet gap-4 / desktop gap-6. */}
      <motion.div
        className="flex flex-col gap-3 px-4 py-4 sm:gap-4 sm:px-8 sm:py-6 lg:gap-6 lg:px-20 lg:py-8"
        {...(containerProps as object)}
      >
        <motion.div {...(itemProps as object)}>
          <HeroGreeting />
        </motion.div>

        {/* Daily kata + Season */}
        <motion.div
          className="flex flex-col gap-3 sm:gap-4 lg:h-[280px] lg:flex-row lg:gap-5"
          {...(itemProps as object)}
          data-tour="daily-kata"
        >
          <DailyHero compact />
          {/* SeasonRank stays for tablet+desktop; on phone the StatStrip below
              gives streak/ELO/XP density per the designer's priority table. */}
          <div className="hidden sm:contents">
            <SeasonRank />
          </div>
        </motion.div>

        {/* Mobile-only stat strip (sm-app.jsx StatStrip) */}
        <motion.div {...(itemProps as object)}>
          <MobileStatStrip />
        </motion.div>

        {/* Tablet 768 layout: 2-col grid (left = Daily/Guild/Activity already
            split; right column starts with Arena+Coach pair). Desktop keeps
            the original 3-col flow row from the prior version. */}
        <motion.div
          className="flex flex-col gap-3 sm:gap-4 lg:h-[220px] lg:flex-row lg:gap-5"
          {...(itemProps as object)}
          data-tour="match-cta"
        >
          {/* ArenaCard hidden on mobile — FAB owns the «start match» action. */}
          <div className="hidden sm:contents">
            <ArenaCard />
          </div>
          <GuildCard />
          <div data-tour="coach" className="contents">
            {/* Big AI-mentor banner: tablet/desktop only. Mobile gets the
                cyan secondary card lower down so it doesn't fight the FAB. */}
            <div className="hidden sm:contents">
              <CoachCard />
            </div>
          </div>
        </motion.div>

        {/* Mobile leaderboard mini + mentor card slot in here */}
        <motion.div {...(itemProps as object)} className="flex flex-col gap-3 sm:hidden">
          <MobileLeaderMini />
          <MobileMentorCard />
        </motion.div>

        {/* Activity + full Leaderboard (desktop/tablet) */}
        <motion.div
          className="flex flex-col gap-3 sm:gap-4 lg:h-[260px] lg:flex-row lg:gap-5"
          {...(itemProps as object)}
        >
          <Activity mobileCollapsed />
          <div className="hidden sm:contents">
            <Leaderboard />
          </div>
        </motion.div>
      </motion.div>
      {showTour && <SanctumTour />}
    </AppShellV2>
  )
}
