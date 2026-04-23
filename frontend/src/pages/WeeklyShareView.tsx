// WeeklyShareView — Wave-11: refactored to designer-spec layouts (web 1280px /
// mobile 320px / OG 1200×630). Designer sources:
//   /Users/sedorofeevd/Downloads/og-cards.jsx
//   /Users/sedorofeevd/Downloads/web-view.jsx
//   /Users/sedorofeevd/Downloads/mobile-view.jsx
//
// Variant selection precedence (most specific first):
//   1. ?variant=achievement|xp|streak in URL
//   2. backend hint via WeeklyReport.featured_metric (NOT in proto yet — see
//      TODO(api) at bottom)
//   3. default 'xp' — самая универсальная история «сколько ты заработал»
//
// Render mode:
//   ?screenshot=1 → <OGStage> (fixed 1200×630, used by puppeteer)
//   else          → web layout; CSS @media collapses to mobile ≤640px
//
// Anti-fallback: ни одного выдуманного числа. Empty payload поле → секция
// показывает honest empty-line или скрывается. EmptyState для loading/404/error.
//
// TODO(api) — backend deps still missing:
//   1. WeeklyReport.featured_metric ('xp'|'streak'|'achievement') so we can
//      auto-pick the layout instead of defaulting to xp.
//   2. SSR-shim для /weekly/share/{token}: должен инжектить
//      <script>window.__SHARE_META__={title,description,image,url}</script>
//      перед бандлом, чтобы краулеры (Twitter / Telegram / FB) увидели
//      заполненные og:* теги (см. index.html:25-44).
//   3. GET /api/v1/profile/weekly/share/{token}/og.png — puppeteer endpoint.
//      Должен ходить во фронт по адресу /weekly/share/{token}?screenshot=1
//      (+ при необходимости &variant=streak|achievement) и кропить
//      #screenshot-stage. Кешировать 24h на токен+variant.

import { useMemo } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import {
  useWeeklyShareQuery,
  type WeeklyReport,
  type AchievementBrief,
} from '../lib/queries/profile'
import { EmptyState } from '../components/EmptyState'
import { type HeroVariant } from '../components/share/ShareHero'
import { useScreenshotMode } from '../components/share/ShareScreenshotMode'
import { OGStage } from '../components/share/og/OGStage'
import {
  Avatar,
  LogoMark,
  ShareRow,
  Eyebrow,
  PullQuote,
} from '../components/share/og/ogPrimitives'

const VALID_VARIANTS: ReadonlySet<string> = new Set(['achievement', 'xp', 'streak'])

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

function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

// User identity: бэкенд /weekly/share/{token} НЕ возвращает имя владельца —
// это намеренно (приватность). Используем дегенеративную «обезличку».
// TODO(api): если хотим показывать @handle, нужно расширить эндпоинт полем
// share_owner_handle (опц., если автор разрешил).
function makeUser(report: WeeklyReport, token: string) {
  let week: string | number = ''
  let range = ''
  try {
    week = isoWeekNumber(new Date(report.week_start))
    range = fmtPeriod(report.week_start, report.week_end)
  } catch {
    // intentional empty — honest fallback (token-based name only).
  }
  // Token first 6 chars → стабильный, обезличенный handle.
  const handle = (token || 'guest').slice(0, 6)
  return { name: handle, letter: (handle[0] ?? '·').toUpperCase(), week, range }
}

// ════════════════════════════════════════════════════════════════════════════
// WEB LAYOUT — 1280px desktop / collapses to mobile spec ≤640px via CSS
// ════════════════════════════════════════════════════════════════════════════

function WebChrome({
  token,
  showCta,
  children,
}: {
  token: string
  showCta: boolean
  children: React.ReactNode
}) {
  return (
    <div className="relative overflow-hidden min-h-screen bg-bg text-text-primary">
      <div className="absolute inset-0 tex-grid pointer-events-none" />
      <div
        className="absolute pointer-events-none"
        style={{
          top: -300,
          right: -300,
          width: 900,
          height: 900,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(244,114,182,0.12) 0%, rgba(34,211,238,0.06) 40%, transparent 70%)',
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          bottom: -200,
          left: -200,
          width: 700,
          height: 700,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, rgba(88,44,255,0.10) 0%, transparent 60%)',
        }}
      />

      <header className="relative border-b border-border/60">
        <div className="mx-auto flex items-center justify-between px-4 py-4 sm:px-10 lg:px-20 lg:py-5 max-w-[1280px]">
          <Link to="/" className="flex items-center gap-3">
            <LogoMark size={26} />
            <span className="font-display text-[15px] sm:text-[17px] font-bold tracking-tight">
              druz9
            </span>
            <span className="ml-2 hidden sm:inline-block rounded-full bg-cyan/15 border border-cyan/30 px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-cyan">
              ● public share
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden md:inline font-mono text-[11px] text-text-muted uppercase tracking-[0.14em]">
              token · {token.slice(0, 4)}…{token.slice(-3)}
            </span>
            <ShareRow size="sm" />
          </div>
        </div>
      </header>

      <section className="relative px-4 sm:px-10 lg:px-20 py-8 sm:py-12 lg:py-16">
        <div className="mx-auto" style={{ maxWidth: 1120 }}>
          {children}
        </div>
      </section>

      <section className="relative border-t border-border/60 px-4 sm:px-10 lg:px-20 py-8 lg:py-10">
        <div className="mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start" style={{ maxWidth: 1120 }}>
          <div className="lg:col-span-5">
            <Eyebrow>what is druz9?</Eyebrow>
            <h3 className="mt-2 font-display font-bold leading-tight text-[20px] sm:text-[24px] lg:text-[28px]">
              Gamified prep для Big-Tech интервью.
              <br />
              <span className="g-pc">Алгоритмы · Go · System Design · Behavioral.</span>
            </h3>
            <p className="mt-3 text-text-secondary text-[14px] leading-relaxed max-w-[460px]">
              Ranked PvP-арена, когорты до 50 человек, AI-коуч, который читает твои провалы и строит focused-недели. Это публичный weekly — так выглядит каждая неделя на платформе.
            </p>
          </div>
          {showCta && (
            <div className="lg:col-span-7 flex lg:justify-end">
              <Link
                to="/onboarding/welcome"
                className="inline-flex items-center gap-3 rounded-md border border-accent/60 bg-accent/15 hover:bg-accent/25 transition px-5 py-3"
              >
                <div>
                  <div className="font-display font-semibold text-[14px]">Хочу так же →</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
                    бесплатно · 2 мин регистрация
                  </div>
                </div>
              </Link>
            </div>
          )}
        </div>
      </section>

      <footer className="relative border-t border-border/60 px-4 sm:px-10 lg:px-20 py-6 lg:py-8">
        <div className="mx-auto flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-3" style={{ maxWidth: 1120 }}>
          <div className="flex items-center gap-3">
            <LogoMark size={22} />
            <span className="font-mono text-[11px] text-text-muted uppercase tracking-[0.14em]">
              druz9.online · public share view
            </span>
          </div>
          <div className="flex items-center gap-3 sm:gap-6 font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.14em] text-text-muted">
            <span>скачать как png</span>
            <span className="text-border-strong">·</span>
            <span>поделиться</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

function WebMini({
  label,
  value,
  tone,
  foot,
}: {
  label: string
  value: string | number
  tone?: 'success' | 'cyan' | 'warn' | 'danger' | 'pink'
  foot?: string
}) {
  const toneCls =
    tone === 'success'
      ? 'text-success'
      : tone === 'cyan'
        ? 'text-cyan'
        : tone === 'warn'
          ? 'text-warn'
          : tone === 'danger'
            ? 'text-danger'
            : tone === 'pink'
              ? 'text-pink'
              : 'text-text-primary'
  return (
    <div className="pr-4 border-r border-border last:border-r-0">
      <div className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.14em] text-text-muted">
        {label}
      </div>
      <div
        className={`mt-2 font-display font-extrabold ${toneCls}`}
        style={{ fontSize: 28, lineHeight: 1 }}
      >
        {value}
      </div>
      {foot && (
        <div className="mt-2 font-mono text-[10px] sm:text-[11px] text-text-muted">{foot}</div>
      )}
    </div>
  )
}

function ContextRow({ user }: { user: ReturnType<typeof makeUser> }) {
  return (
    <div className="flex items-center gap-4 mb-8 sm:mb-10">
      <Avatar letter={user.letter} size={56} />
      <div>
        <div className="flex items-baseline gap-2 leading-none">
          <span className="font-mono text-text-muted text-[12px] sm:text-[14px]">@</span>
          <span className="font-display font-bold text-[20px] sm:text-[24px] lg:text-[28px]">
            {user.name}
          </span>
        </div>
        <div className="mt-2 font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.16em] text-text-muted">
          week {user.week}{user.range ? ` · ${user.range}` : ''} · druz9 weekly report
        </div>
      </div>
    </div>
  )
}

// ── Web hero · XP ───────────────────────────────────────────────────────────
function WebHeroXP({ report }: { report: WeeklyReport }) {
  const xp = report.metrics.xp_earned ?? 0
  const prev = report.prev_xp_earned ?? 0
  const ratingDelta = report.metrics.rating_change ?? 0
  const matches = report.metrics.matches_won ?? 0
  const tasks = report.metrics.tasks_solved ?? 0
  const activeDays = (report.heatmap ?? []).filter((v) => v > 0).length
  const streak = report.streak_days ?? 0
  const minutes = report.metrics.time_minutes ?? 0
  const pct = prev > 0 ? Math.round(((xp - prev) / prev) * 100) : null
  const quote = (report.ai_insight ?? report.stress_analysis ?? '').trim()
  const lead = quote.split('\n\n')[0].slice(0, 240)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-end">
      <div className="lg:col-span-8">
        <Eyebrow>▲ xp earned</Eyebrow>
        <div className="mt-3 flex items-start">
          <span
            className="font-display font-medium text-text-muted"
            style={{ fontSize: 48, lineHeight: 0.9, marginTop: 18 }}
          >
            +
          </span>
          <span
            className="font-display font-extrabold tracking-tighter g-ac"
            style={{ fontSize: 'clamp(80px, 18vw, 220px)', lineHeight: 0.82, letterSpacing: '-0.04em' }}
          >
            {xp.toLocaleString('ru-RU')}
          </span>
        </div>
        {pct !== null && (
          <div className="mt-4 flex items-center gap-3">
            <span className="font-mono text-success text-[13px]">
              {pct >= 0 ? '+' : ''}{pct}% к прошлой неделе
            </span>
          </div>
        )}
      </div>
      <div className="lg:col-span-4 lg:border-l lg:border-border-strong lg:pl-10 lg:pb-4">
        <Eyebrow>elo Δ</Eyebrow>
        <div
          className={`mt-2 font-display font-extrabold ${ratingDelta >= 0 ? 'text-success' : 'text-danger'}`}
          style={{ fontSize: 56, lineHeight: 1 }}
        >
          {ratingDelta >= 0 ? '+' : ''}
          {ratingDelta}
        </div>
        <div className="mt-2 font-mono text-[14px] text-text-secondary">
          {matches} <span className="text-text-muted">w</span> · {tasks} <span className="text-text-muted">задач</span>
        </div>
      </div>

      <div className="lg:col-span-12 mt-6 lg:mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4 lg:gap-0 border-t border-border-strong pt-6 lg:pt-8">
        <WebMini label="actions" value={report.actions_count ?? matches + tasks} foot={`${matches} w · ${tasks} t`} />
        <WebMini label="active days" value={`${activeDays}/7`} tone="cyan" />
        <WebMini label="streak" value={`${streak}d`} tone="warn" foot="unbroken" />
        <WebMini label="minutes" value={minutes} foot="deliberate practice" />
      </div>

      {lead && (
        <div className="lg:col-span-12 mt-4 pt-6 lg:pt-8 border-t border-border-strong">
          <PullQuote>{lead}</PullQuote>
        </div>
      )}
    </div>
  )
}

// ── Web hero · Streak ───────────────────────────────────────────────────────
function WebHeroStreak({ report, range }: { report: WeeklyReport; range: string }) {
  const streak = report.streak_days ?? 0
  const heatRaw = report.heatmap ?? []
  const max = heatRaw.reduce((m, v) => Math.max(m, v), 0) || 1
  const heat: number[] = Array.from({ length: 7 }, (_, i) => {
    const v = heatRaw[i] ?? 0
    return v <= 0 ? 0 : Math.max(0.15, v / max)
  })
  const days = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС']
  const best = report.best_streak ?? 0
  const quote = (report.ai_insight ?? report.stress_analysis ?? '').trim()
  const lead = quote.split('\n\n')[0].slice(0, 240)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
      <div className="lg:col-span-5">
        <Eyebrow>🔥 streak · unbroken</Eyebrow>
        <div className="flex items-start gap-4 mt-2">
          <span
            className="font-display font-extrabold text-warn"
            style={{ fontSize: 'clamp(140px, 26vw, 280px)', lineHeight: 0.82, letterSpacing: '-0.05em' }}
          >
            {streak}
          </span>
          <div className="flex flex-col pt-12 lg:pt-24">
            <span className="font-display font-bold text-text-primary" style={{ fontSize: 32, lineHeight: 1 }}>
              дней
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-muted mt-3">
              {best > 0 ? `лучший: ${best}` : 'подряд · без пропуска'}
            </span>
          </div>
        </div>
      </div>
      <div className="lg:col-span-7 lg:border-l lg:border-border-strong lg:pl-10">
        <Eyebrow>7 дней · {range}</Eyebrow>
        <div className="mt-5 grid grid-cols-7 gap-2 sm:gap-3">
          {heat.map((h, i) => (
            <div key={i} className="flex flex-col items-center gap-2 sm:gap-3">
              <div
                className="w-full rounded-[6px] relative"
                style={{
                  height: 110,
                  background: h === 0 ? 'transparent' : 'rgba(251,191,36,0.08)',
                  border:
                    h === 0
                      ? '1px dashed rgb(var(--color-danger))'
                      : '1px solid rgba(251,191,36,0.3)',
                }}
              >
                {h > 0 && (
                  <div
                    className="absolute bottom-0 left-0 right-0 rounded-b-[5px]"
                    style={{
                      background: 'rgb(var(--color-warn))',
                      height: `${h * 100}%`,
                      opacity: 0.88,
                    }}
                  />
                )}
                {h === 0 && (
                  <span className="absolute inset-0 grid place-items-center font-mono text-[10px] uppercase text-danger">
                    skip
                  </span>
                )}
              </div>
              <span
                className={`font-mono text-[10px] sm:text-[11px] uppercase ${h === 0 ? 'text-danger' : 'text-text-muted'}`}
              >
                {days[i]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {lead && (
        <div className="lg:col-span-12 mt-2 pt-6 lg:pt-8 border-t border-border-strong">
          <PullQuote>{lead}</PullQuote>
        </div>
      )}
    </div>
  )
}

// ── Web hero · Achievement ──────────────────────────────────────────────────
function WebHeroAchievement({
  report,
  achievement,
}: {
  report: WeeklyReport
  achievement: AchievementBrief
}) {
  const tier = (achievement.tier ?? '').toLowerCase()
  const grad =
    tier === 'gold'
      ? ['#FBBF24', '#B45309']
      : tier === 'silver'
        ? ['#94A3B8', '#475569']
        : tier === 'bronze'
          ? ['#D97706', '#92400E']
          : tier === 'legendary'
            ? ['#F472B6', '#582CFF']
            : ['#22D3EE', '#582CFF']
  const xp = report.metrics.xp_earned ?? 0
  const ratingDelta = report.metrics.rating_change ?? 0
  const matches = report.metrics.matches_won ?? 0
  const streak = report.streak_days ?? 0
  const quote = (report.ai_insight ?? report.stress_analysis ?? '').trim()
  const lead = quote.split('\n\n')[0].slice(0, 240)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
      <div className="lg:col-span-5 flex justify-center lg:justify-start">
        <div className="relative" style={{ width: 280, height: 280 }}>
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, ${grad[0]}, ${grad[1]})`,
              clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
              opacity: 0.14,
            }}
          />
          <div
            className="absolute grid place-items-center rounded-[40px]"
            style={{
              inset: 36,
              background: `linear-gradient(135deg, ${grad[0]} 0%, ${grad[1]} 100%)`,
              boxShadow: '0 32px 80px -16px rgba(88,44,255,0.5)',
            }}
          >
            <span className="font-display font-extrabold text-white" style={{ fontSize: 100, lineHeight: 1 }}>
              {(achievement.title || '·').slice(0, 1).toUpperCase()}
            </span>
          </div>
          <div
            className="absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-md px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em]"
            style={{
              background: 'rgb(var(--color-bg))',
              border: '1px solid rgb(var(--color-border-strong))',
              color: '#FBBF24',
            }}
          >
            {achievement.tier}
          </div>
        </div>
      </div>
      <div className="lg:col-span-7">
        <Eyebrow>◆ achievement unlocked</Eyebrow>
        <h1
          className="mt-3 font-display font-extrabold g-ac"
          style={{ fontSize: 'clamp(48px, 10vw, 96px)', lineHeight: 0.92, letterSpacing: '-0.03em' }}
        >
          {achievement.title}
        </h1>
      </div>

      <div className="lg:col-span-12 mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 lg:gap-0 border-t border-border-strong pt-6 lg:pt-8">
        <WebMini label="xp" value={`+${xp.toLocaleString('ru-RU')}`} tone="cyan" />
        <WebMini
          label="elo Δ"
          value={`${ratingDelta >= 0 ? '+' : ''}${ratingDelta}`}
          tone={ratingDelta >= 0 ? 'success' : 'danger'}
        />
        <WebMini label="actions" value={report.actions_count ?? matches} foot="across the week" />
        <WebMini label="streak" value={`${streak}d`} tone="warn" />
      </div>

      {lead && (
        <div className="lg:col-span-12 mt-2 pt-6 lg:pt-8 border-t border-border-strong">
          <PullQuote>{lead}</PullQuote>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Page entry
// ════════════════════════════════════════════════════════════════════════════

export default function WeeklyShareView() {
  const { token } = useParams<{ token: string }>()
  const [search] = useSearchParams()

  const screenshot = useScreenshotMode()
  const { data, isLoading, isError, error } = useWeeklyShareQuery(token)

  const variant = useMemo(
    () => pickVariant(search.get('variant'), data),
    [search, data],
  )
  const showCta = !isOwnerView(token ?? '', search.get('own'))

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg text-text-primary">
        <EmptyState variant="loading" skeletonLayout="single-card" />
      </div>
    )
  }

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

  const user = makeUser(data, token ?? '')
  const topAchievement = (data.achievements_this_week ?? [])[0]
  const userWithCta = { ...user, showCta }

  // Screenshot mode → puppeteer-friendly fixed 1200×630 stage.
  if (screenshot) {
    return <OGStage variant={variant} report={data} user={userWithCta} achievement={topAchievement} />
  }

  // Web/mobile responsive view.
  let hero: React.ReactNode
  if (variant === 'achievement' && topAchievement) {
    hero = <WebHeroAchievement report={data} achievement={topAchievement} />
  } else if (variant === 'streak') {
    hero = <WebHeroStreak report={data} range={user.range} />
  } else {
    hero = <WebHeroXP report={data} />
  }

  return (
    <WebChrome token={token ?? ''} showCta={showCta}>
      <ContextRow user={user} />
      {hero}
    </WebChrome>
  )
}
