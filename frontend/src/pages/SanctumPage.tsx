import { useEffect, useState } from 'react'
import { ArrowRight, Flame, Play, Sparkles, Shield, Swords } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { AppShellV2 } from '../components/AppShell'
import { SanctumTour } from './onboarding/SanctumTour'
import { staggerContainer, staggerItem } from '../lib/motion'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Avatar } from '../components/Avatar'
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
      <Link to="/arena" className="w-full sm:w-auto">
        <Button variant="primary" icon={<Swords className="h-[18px] w-[18px]" />} iconRight={<ArrowRight className="h-4 w-4" />} className="w-full justify-center px-5 py-3 text-sm sm:w-auto">
          {t('common:buttons.find_opponent')}
        </Button>
      </Link>
    </div>
  )
}

// Время до сброса kata: считаем UTC-полночь как rolling deadline
// (бэк выдаёт новую kata в 00:00 UTC). Возвращаем "HH:MM"; если до сброса
// меньше часа — "MM:SS".
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

function DailyHero() {
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
  // Live-tick: ранее timer обновлялся только при reload. Теперь
  // setInterval(1s) гонит локальный clock, а fmt — всегда от свежего now.
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const remaining = fmtTimeUntilUTCMidnight(now)
  return (
    <Card className="flex-1 flex-col gap-5 p-7" interactive={false}>
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-2">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-warn">
            <Flame className="h-3 w-3" /> {t('daily_kata_day', { day })}
          </span>
          {isError && <ErrorChip />}
          <h2 className="w-full max-w-[540px] font-display text-2xl font-bold text-text-primary">
            {title}
          </h2>
          <p className="font-mono text-xs text-text-muted">{meta}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="font-display text-[28px] font-bold text-cyan">{remaining}</span>
          <span className="text-xs text-text-muted">{t('remaining')}</span>
        </div>
      </div>
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap gap-6" data-tour="streak">
          {/* "Сегодня прошли %" не показываем — нет канала статистики
              completion-rate. Срок жизни kata = 24h, день стрика и
              already_submitted покрывают то же намерение. */}
          <Stat value={`${day} ${day > 0 ? '🔥' : ''}`} label={t('streak_days')} highlight="warn" />
          {kata?.already_submitted && <Stat value="✓" label={t('passed_today')} highlight="cyan" />}
        </div>
        <Link to="/daily">
          <Button
            variant="primary"
            iconRight={<ArrowRight className="h-4 w-4" />}
            className="bg-text-primary text-bg shadow-none hover:bg-white/90 hover:shadow-none"
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
  const tier = season?.tier ?? 0
  const sp = season?.my_points ?? 0
  // Free track is the canonical ladder for the "next tier" target. Falls back
  // to a flat ladder when the API hasn't shipped (or 404).
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
    <Card className="w-full flex-col gap-4 border-accent/25 bg-surface-3 p-6 lg:w-[380px]">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-text-secondary">{season?.season?.name ?? t('season_label')}</span>
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
    // Empty-state: пользователь без гильдии — короткий CTA, без фейковых
    // 2140 vs 1670. Линкуем на /guild, где можно создать или вступить.
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
  // Если гильдия есть, но текущей войны нет — показываем имя гильдии и
  // GP без поддельного скоринга.
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
  // Реальная война: суммируем линии. score_a/b — суммы по секциям.
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

// CoachCard — превью реального AI-инсайта недели. Phase B wired
// `weekly_report.ai_insight` (claude-sonnet-4 через OpenRouter, 24h
// Redis-cache). Если инсайт пуст (LLM не настроен / новый юзер без активности)
// — показываем CTA на /weekly без ложного контента.
function CoachCard() {
  const { t } = useTranslation('sanctum')
  const report = useWeeklyReportQuery()
  const insight = report.data?.ai_insight?.trim() ?? ''
  // Усекаем до ~140 chars для preview (полный текст на /weekly).
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

// Mini-leaderboard — топ-5 algorithms-секции. Раньше показывали
// захардкоженные имена (@alexey / @kirill_dev / @you), что вводило
// пользователя в заблуждение, когда бэк падал. Теперь — реальные
// записи; при isError или пустом ответе даём empty-state.
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

// fmtAgo — компактный «5 мин» / «2 ч» / «3 д» для ленты активности.
// Берём timestamp ISO с бэка и считаем относительно сейчас.
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

function Activity() {
  const { t } = useTranslation(['sanctum', 'common'])
  const { data, isError, isLoading } = useArenaHistoryQuery({ limit: 3 })
  const items = data?.items ?? []

  return (
    <Card className="flex-1 flex-col gap-3.5 p-5">
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
      {items.map((m) => {
        const won = m.result === 'win'
        const lpSign = m.lp_change >= 0 ? '+' : ''
        return (
          <div key={m.match_id} className="flex items-center gap-3 py-2">
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
              <span className="truncate text-sm font-semibold text-text-primary">
                {won ? 'Победа' : m.result === 'loss' ? 'Поражение' : 'Матч'} · vs @
                {m.opponent_username || m.opponent_user_id?.slice(0, 6) || 'неизв.'}
              </span>
              <span className="truncate text-[11px] text-text-muted">
                {humanizeSection(m.section)} · {fmtDuration(m.duration_seconds)} · {lpSign}
                {m.lp_change} LP
              </span>
            </div>
            <span className="shrink-0 font-mono text-[11px] text-text-muted">
              {fmtAgo(m.finished_at)}
            </span>
          </div>
        )
      })}
    </Card>
  )
}

export default function SanctumPageV2() {
  const reduced = useReducedMotion()
  // Wave-10 onboarding Step 5 — when ?tour=1 is present in the URL, the
  // SanctumTour overlay is mounted on top of the regular page. The
  // overlay reads `data-tour="..."` attributes already placed below.
  const [searchParams] = useSearchParams()
  const showTour = searchParams.get('tour') === '1'
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
          // Wave-10 onboarding tour anchors. Step 5 (SanctumTour) reads
          // these data-tour attrs to position the radial spotlight.
          data-tour="daily-kata"
        >
          <DailyHero />
          <SeasonRank />
        </motion.div>
        <motion.div
          className="flex flex-col gap-5 lg:h-[220px] lg:flex-row"
          {...(itemProps as object)}
          data-tour="match-cta"
        >
          <ArenaCard />
          <GuildCard />
          <div data-tour="coach" className="contents">
            <CoachCard />
          </div>
        </motion.div>
        <motion.div
          className="flex flex-col gap-5 lg:h-[260px] lg:flex-row"
          {...(itemProps as object)}
        >
          <Activity />
          <Leaderboard />
        </motion.div>
      </motion.div>
      {/* Wave-10 onboarding Step 5: tour overlay mounts only when
          ?tour=1 is in the URL. Lives outside the motion stagger so its
          animation timing isn't tied to page reveal. */}
      {showTour && <SanctumTour />}
    </AppShellV2>
  )
}
