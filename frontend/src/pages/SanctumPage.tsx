import { ArrowRight, Flame, Play, Sparkles, Shield, Swords, Trophy } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../components/AppShell'
import { staggerContainer, staggerItem } from '../lib/motion'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
import { useDailyKataQuery, useStreakQuery } from '../lib/queries/daily'
import { useSeasonQuery } from '../lib/queries/season'
import { useRatingMeQuery, useLeaderboardQuery } from '../lib/queries/rating'
import { useProfileQuery } from '../lib/queries/profile'

function ErrorChip() {
  const { t } = useTranslation('errors')
  return (
    <span className="rounded-full bg-danger/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger">
      {t('load_failed')}
    </span>
  )
}

function HeaderRow() {
  const { t } = useTranslation(['sanctum', 'common'])
  const { data: streak } = useStreakQuery()
  const { data: profile } = useProfileQuery()
  const name = profile?.display_name ?? '—'
  const current = streak?.current ?? 0
  return (
    <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-bold leading-[1.1] text-text-primary lg:text-[32px]">
          {t('sanctum:welcome', { name })}
        </h1>
        <p className="text-sm text-text-secondary">
          {t('sanctum:subtitle', { streak: current })}
        </p>
      </div>
      <Button variant="primary" icon={<Swords className="h-[18px] w-[18px]" />} iconRight={<ArrowRight className="h-4 w-4" />} className="w-full justify-center px-5 py-3 text-sm sm:w-auto">
        {t('common:buttons.find_opponent')}
      </Button>
    </div>
  )
}

function DailyHero() {
  const { t } = useTranslation('sanctum')
  const { data: kata, isError } = useDailyKataQuery()
  const { data: streak } = useStreakQuery()
  const day = streak?.current ?? 0
  const title = kata?.task?.title ?? '—'
  const difficulty = kata?.task?.difficulty ?? '—'
  const section = kata?.task?.section ?? '—'
  return (
    <Card className="flex-1 flex-col gap-5 p-7" interactive={false}>
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-2">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn">
            <Flame className="h-3 w-3" /> {t('daily_kata_day', { day })}
          </span>
          {isError && <ErrorChip />}
          <h2 className="max-w-[540px] font-display text-2xl font-bold text-text-primary">
            {title}
          </h2>
          <p className="font-mono text-xs text-text-muted">{difficulty} · O(log n) · {section}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="font-display text-[32px] font-bold text-cyan">15:00</span>
          <span className="text-xs text-text-muted">{t('remaining')}</span>
        </div>
      </div>
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap gap-6">
          <Stat value="850 XP" label={t('reward')} />
          <Stat value="62%" label={t('passed_today')} highlight="cyan" />
          <Stat value={`${day} 🔥`} label={t('streak_days')} highlight="warn" />
        </div>
        <Button variant="primary" iconRight={<ArrowRight className="h-4 w-4" />} className="bg-text-primary text-bg shadow-none hover:bg-white/90 hover:shadow-none">
          {t('begin')}
        </Button>
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
            ? 'font-display text-lg font-semibold text-cyan'
            : highlight === 'warn'
              ? 'font-display text-lg font-semibold text-warn'
              : 'font-display text-lg font-semibold text-text-primary'
        }
      >
        {value}
      </span>
      <span className="text-[11px] text-text-muted">{label}</span>
    </div>
  )
}

function SeasonRank() {
  const { t } = useTranslation('sanctum')
  const { data: season, isError } = useSeasonQuery()
  const { data: rating } = useRatingMeQuery()
  const tier = season?.current_tier ?? 0
  const sp = season?.current_sp ?? 0
  const tierMax = season?.tier_max ?? 1
  const pct = Math.min(100, Math.round((sp / Math.max(1, tierMax * 200)) * 100))
  const gps = rating?.global_power_score ?? 0
  const daysLeft = season?.ends_at
    ? Math.max(0, Math.ceil((new Date(season.ends_at).getTime() - Date.now()) / 86_400_000))
    : 0
  return (
    <Card className="w-full flex-col gap-4 border-accent/25 bg-surface-3 p-6 lg:w-[380px]">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-secondary">{season?.title ?? t('season_label')}</span>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-text-secondary">
          {t('days_to_end', { count: daysLeft })}
        </span>
      </div>
      {isError && <ErrorChip />}
      <div className="flex flex-col items-center gap-1">
        <span className="font-display text-[30px] font-extrabold text-text-primary">{t('tier', { n: tier })}</span>
        <span className="font-mono text-[13px] text-cyan">{gps} GPS</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-black/30">
        <div className="h-full rounded-full bg-gradient-to-r from-cyan to-accent" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-text-muted">
        <span>{t('tier', { n: tier })}</span>
        <span>{t('tier', { n: tierMax })}</span>
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
      <Button variant="ghost" icon={<Play className="h-3.5 w-3.5" />} className="border-accent text-accent-hover hover:bg-accent/10">
        {t('queue')}
      </Button>
    </Card>
  )
}

function GuildCard() {
  const { t } = useTranslation('sanctum')
  return (
    <Card className="flex-1 flex-col gap-3.5 p-5">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4 text-cyan" />
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-cyan">{t('guild_war')}</span>
      </div>
      <h3 className="font-display text-lg font-bold text-text-primary">{t('guild_match')}</h3>
      <div className="flex items-center gap-3">
        <span className="font-display text-[22px] font-bold text-success">2 140</span>
        <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-black/30">
          <div className="h-full w-[56%] bg-success" />
          <div className="h-full w-[14%] bg-danger" />
        </div>
        <span className="font-display text-[22px] font-bold text-danger">1 670</span>
      </div>
      <p className="text-xs text-text-secondary">{t('your_contribution', { points: 240 })}</p>
    </Card>
  )
}

function CoachCard() {
  const { t } = useTranslation('sanctum')
  return (
    <div className="flex flex-1 flex-col gap-3 rounded-xl bg-gradient-to-br from-accent to-pink p-5 shadow-glow">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-text-primary" />
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-primary">{t('ai_mentor')}</span>
      </div>
      <h3 className="max-w-[300px] font-display text-base font-bold text-text-primary">
        {t('weak_spot')}
      </h3>
      <p className="max-w-[300px] text-xs text-white/80">
        {t('weak_spot_desc')}
      </p>
      <button className="inline-flex w-fit items-center gap-1.5 rounded-md bg-white/20 px-3.5 py-2 text-xs font-semibold text-text-primary hover:bg-white/30">
        {t('open_plan')} <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function Leaderboard() {
  const { t } = useTranslation('sanctum')
  const { data: lb, isError } = useLeaderboardQuery('algorithms')
  const fallback = [
    { rank: 1, name: '@alexey', tier: 'Grandmaster · 3 420 LP', delta: '+240', medal: 'gold' as const },
    { rank: 2, name: '@kirill_dev', tier: 'Diamond I · 2 980 LP', delta: '+180', medal: 'silver' as const },
    { rank: 3, name: '@you', tier: 'Diamond III · 2 840 LP', delta: '+124', medal: 'accent' as const, you: true },
    { rank: 4, name: '@nastya', tier: 'Diamond IV · 2 610 LP', delta: '+90', medal: 'plain' as const },
  ] as Array<{ rank: number; name: string; tier: string; delta: string; medal: 'gold' | 'silver' | 'accent' | 'plain'; you?: boolean }>
  const rows = lb?.entries
    ? lb.entries.slice(0, 4).map((e, idx) => ({
        rank: e.rank,
        name: `@${e.username}`,
        tier: e.title ? `${e.title} · ${e.elo} ELO` : `${e.elo} ELO`,
        delta: '',
        medal: (idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'accent' : 'plain') as 'gold' | 'silver' | 'accent' | 'plain',
        you: false,
      }))
    : fallback
  const medalBg = (m: string) =>
    m === 'gold' ? 'bg-warn text-bg' : m === 'silver' ? 'bg-border-strong text-text-secondary' : m === 'accent' ? 'bg-accent text-text-primary' : 'bg-border-strong text-text-secondary'

  return (
    <Card className="w-full flex-col gap-3 p-5 lg:w-[420px]">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-text-primary">{t('top_friends')}</h3>
        <span className="font-mono text-[11px] text-text-muted">{isError ? '—' : t('week')}</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.rank}
          className={[
            'flex items-center gap-3 rounded-lg px-2 py-2',
            r.you ? 'bg-accent/10' : '',
          ].join(' ')}
        >
          <span className={`grid h-7 w-7 place-items-center rounded-full font-display text-[13px] font-bold ${medalBg(r.medal)}`}>
            {r.rank}
          </span>
          <Avatar size="sm" gradient="violet-cyan" initials={r.name[1]?.toUpperCase()} />
          <div className="flex flex-1 flex-col gap-0.5">
            <span className={r.you ? 'text-sm font-bold text-text-primary' : 'text-sm font-semibold text-text-primary'}>
              {r.name}
            </span>
            <span className={r.you ? 'font-mono text-[11px] text-accent-hover' : 'font-mono text-[11px] text-text-muted'}>
              {r.tier}
            </span>
          </div>
          <span className="font-mono text-sm font-semibold text-success">{r.delta || ''}</span>
        </div>
      ))}
    </Card>
  )
}

function Activity() {
  const { t } = useTranslation(['sanctum', 'common'])
  const items = [
    { icon: <Trophy className="h-4 w-4 text-warn" />, bg: 'bg-warn/15', title: 'Ачивмент · Speed Demon', sub: '10 задач под 5 минут подряд', time: 'вчера' },
    { icon: <Swords className="h-4 w-4 text-accent-hover" />, bg: 'bg-accent/15', title: 'Победа в арене · vs @kirill_dev', sub: 'Median of Two Sorted Arrays · +18 LP', time: '1 ч назад' },
    { icon: <Sparkles className="h-4 w-4 text-success" />, bg: 'bg-success/15', title: 'Two Sum · Easy', sub: 'Решено за 4:21 · +120 XP', time: '2 мин назад' },
  ]
  return (
    <Card className="flex-1 flex-col gap-3.5 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold text-text-primary">{t('sanctum:recent_activity')}</h3>
        <button className="text-xs text-text-muted hover:text-text-secondary">{t('common:buttons.view_all')}</button>
      </div>
      {items.reverse().map((i, idx) => (
        <div key={idx} className="flex items-center gap-3 py-2">
          <span className={`grid h-9 w-9 place-items-center rounded-full ${i.bg}`}>{i.icon}</span>
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold text-text-primary">{i.title}</span>
            <span className="text-[11px] text-text-muted">{i.sub}</span>
          </div>
          <span className="font-mono text-[11px] text-text-muted">{i.time}</span>
        </div>
      ))}
    </Card>
  )
}

export default function SanctumPageV2() {
  const reduced = useReducedMotion()
  const containerProps = reduced
    ? {}
    : { variants: staggerContainer, initial: 'hidden', animate: 'show' }
  const itemProps = reduced ? {} : { variants: staggerItem }
  return (
    <AppShellV2>
      <motion.div
        className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8"
        {...(containerProps as object)}
      >
        <motion.div {...(itemProps as object)}>
          <HeaderRow />
        </motion.div>
        <motion.div
          className="flex flex-col gap-5 lg:h-[280px] lg:flex-row"
          {...(itemProps as object)}
        >
          <DailyHero />
          <SeasonRank />
        </motion.div>
        <motion.div
          className="flex flex-col gap-5 lg:h-[220px] lg:flex-row"
          {...(itemProps as object)}
        >
          <ArenaCard />
          <GuildCard />
          <CoachCard />
        </motion.div>
        <motion.div
          className="flex flex-col gap-5 lg:h-[260px] lg:flex-row"
          {...(itemProps as object)}
        >
          <Activity />
          <Leaderboard />
        </motion.div>
      </motion.div>
    </AppShellV2>
  )
}
