// WeeklyShareView — Wave-10 P1 dedicated public view of the weekly report
// (replaces the previous «render-page = copy of authorized /weekly without
// branding»). Mounted at /weekly/share/:token. Public: no auth gate; query
// hits /api/v1/profile/weekly/share/{token} which is in publicPaths.
//
// Variant selection precedence (most specific first):
//   1. ?variant=achievement|xp|streak in URL
//   2. backend hint via WeeklyReport.featured_metric (NOT yet wired in proto;
//      see report at end of this file's TODO list)
//   3. default 'xp' — самая универсальная история «сколько ты заработал»
//
// Owner heuristic for hiding the «Хочу попробовать» CTA:
//   - ?own=1 → hide
//   - localStorage flag `druz9.share.owner.{token}` (set by /weekly Share
//     button when copying the link) → hide
//   - otherwise visible (it's a public link a non-owner is viewing)
//
// Anti-fallback policy is identical to /weekly: ни одного выдуманного числа.
// Empty payload field → секция показывает honest empty-line или скрывается.

import { useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useWeeklyShareQuery, type WeeklyReport } from '../lib/queries/profile'
import { EmptyState } from '../components/EmptyState'
import { ShareHero, type HeroVariant } from '../components/share/ShareHero'
import { ShareMetaStrip, type ShareMetaTile } from '../components/share/ShareMetaStrip'
import { ShareCoachQuote } from '../components/share/ShareCoachQuote'
import { ShareActionFooter } from '../components/share/ShareActionFooter'
import { ShareScreenshotMode, useScreenshotMode } from '../components/share/ShareScreenshotMode'

const VALID_VARIANTS: ReadonlySet<string> = new Set(['achievement', 'xp', 'streak'])

// pickVariant — URL param wins; otherwise look at backend payload hint
// (currently absent from proto — see TODO at file bottom); else 'xp'.
function pickVariant(urlVariant: string | null, _r: WeeklyReport | undefined): HeroVariant {
  if (urlVariant && VALID_VARIANTS.has(urlVariant)) return urlVariant as HeroVariant
  // Future hook: when proto adds WeeklyReport.featured_metric we read it here.
  return 'xp'
}

function isOwnerView(token: string, urlOwn: string | null): boolean {
  if (urlOwn === '1') return true
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(`druz9.share.owner.${token}`) === '1'
  } catch {
    return false
  }
}

function fmtPeriod(weekStart: string, weekEnd: string): string {
  try {
    const start = new Date(weekStart)
    const end = new Date(weekEnd)
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }
    const startStr = start.toLocaleDateString('ru', { day: 'numeric' })
    const endStr = end.toLocaleDateString('ru', opts)
    return `${startStr}–${endStr}`
  } catch {
    return `${weekStart} — ${weekEnd}`
  }
}

function buildTiles(report: WeeklyReport, variant: HeroVariant): ShareMetaTile[] {
  // Hero уже потребил один из метрик; в strip кладём остальные так, чтобы
  // не дублировать giant-number.
  const m = report.metrics
  const xp: ShareMetaTile = {
    label: 'XP',
    value: (m.xp_earned ?? 0).toLocaleString('ru-RU'),
    sub: 'за неделю',
    tone: 'pink',
  }
  const matches: ShareMetaTile = {
    label: 'Матчей',
    value: String(m.matches_won ?? 0),
    sub: 'выиграно',
    tone: 'success',
  }
  const lp: ShareMetaTile = {
    label: 'LP',
    value: `${(m.rating_change ?? 0) >= 0 ? '+' : ''}${m.rating_change ?? 0}`,
    sub: 'рейтинг',
    tone: (m.rating_change ?? 0) >= 0 ? 'success' : 'danger',
  }
  const streak: ShareMetaTile = {
    label: 'Стрик',
    value: String(report.streak_days ?? 0),
    sub: `лучший: ${report.best_streak ?? 0}`,
    tone: 'warn',
  }
  const tasks: ShareMetaTile = {
    label: 'Задач',
    value: String(m.tasks_solved ?? 0),
    sub: 'решено',
    tone: 'cyan',
  }

  // Hero ест свою «звёздную» метрику — её в strip не повторяем.
  if (variant === 'xp') return [matches, lp, streak, tasks]
  if (variant === 'streak') return [xp, matches, lp, tasks]
  // achievement
  return [xp, matches, lp, streak]
}

function ShareLayout({ children }: { children: React.ReactNode }) {
  const inScreenshot = useScreenshotMode()
  if (inScreenshot) return <ShareScreenshotMode>{children}</ShareScreenshotMode>
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:gap-8 sm:px-8 sm:py-12 lg:px-20">
      {children}
    </main>
  )
}

export default function WeeklyShareView() {
  const { token } = useParams<{ token: string }>()
  const [search] = useSearchParams()

  const { data, isLoading, isError, error } = useWeeklyShareQuery(token)

  const variant = useMemo(
    () => pickVariant(search.get('variant'), data),
    [search, data],
  )
  const showCta = !isOwnerView(token ?? '', search.get('own'))

  // Loading: layout-aware skeleton. single-card матчит «доминирующая
  // hero-карточка» главной композиции.
  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg text-text-primary">
        <EmptyState variant="loading" skeletonLayout="single-card" />
      </div>
    )
  }

  // 404 — токен протух или не существует. Fail-loud, anti-fallback.
  const status = (error as { status?: number } | null)?.status
  if (isError && status === 404) {
    return (
      <div className="min-h-screen bg-bg text-text-primary">
        <EmptyState
          variant="404-not-found"
          title="Ссылка устарела"
          body="Эта публичная ссылка на недельный отчёт больше не активна. Попроси автора сгенерировать новую."
          cta={{ label: 'На главную', href: '/' }}
        />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-bg text-text-primary">
        <EmptyState
          variant="error"
          title="Не удалось загрузить отчёт"
          body="Сервер отчётов временно недоступен. Попробуй обновить страницу."
        />
      </div>
    )
  }

  const tiles = buildTiles(data, variant)
  const period = fmtPeriod(data.week_start, data.week_end)
  const topAchievement = (data.achievements_this_week ?? [])[0]

  return (
    <div className="min-h-screen bg-bg text-text-primary">
      <ShareLayout>
        {/* Page header pattern: mono eyebrow + H1 with gradient slice + subline */}
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted">
            Weekly · публичная ссылка
          </span>
          <h1 className="font-display text-[22px] sm:text-[28px] lg:text-[40px] font-bold leading-[1.1] text-text-primary">
            Недельный{' '}
            <span className="bg-gradient-to-r from-pink to-cyan bg-clip-text text-transparent">
              отчёт
            </span>
          </h1>
          <p className="text-sm text-text-secondary">
            {period} · {data.actions_count ?? 0} действий
          </p>
        </div>

        <ShareHero
          variant={variant}
          xpEarned={data.metrics.xp_earned}
          prevXpEarned={data.prev_xp_earned}
          streakDays={data.streak_days}
          bestStreak={data.best_streak}
          achievementTitle={topAchievement?.title}
          achievementTier={topAchievement?.tier}
        />

        <ShareMetaStrip tiles={tiles} />

        <ShareCoachQuote text={data.ai_insight || data.stress_analysis || ''} />

        <ShareActionFooter showCta={showCta} />
      </ShareLayout>
    </div>
  )
}

// TODO(backend): proto.WeeklyReport нет поля featured_metric — когда оно
// появится (string enum 'xp' | 'streak' | 'achievement'), pickVariant выше
// должен начать его читать вторым по приоритету (после URL ?variant=).
// Эндпоинт остаётся прежним: GET /api/v1/profile/weekly/share/{token}.
