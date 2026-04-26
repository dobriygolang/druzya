import type * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Compass, Map as MapIcon, Shield, Sparkles, Target, TrendingUp, Trophy } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Card } from '../components/Card'
import { useMockLeaderboardQuery } from '../lib/queries/mockPipeline'
import { useAtlasQuery } from '../lib/queries/profile'
import {
 useMockInsightsOverviewQuery,
 type RecurringPattern,
 type ScoreTrajectoryPoint,
 type StagePerformance,
} from '../lib/queries/mockInsights'
import {
 useDailyBriefQuery,
 type RecommendationKind,
} from '../lib/queries/intelligence'

/**
 * InsightsPage — live analytics surface.
 *
 * Three real cards driven by `useMockInsightsOverviewQuery`:
 *   - StagePerformance  — pass rate per stage_kind (30d)
 *   - PatternsCard      — top recurring missing_points (30d)
 *   - ScoreTrajectory   — sparkline of last 10 finished pipelines
 *
 * Plus the existing live blocks (Atlas mini, Daily Coach brief,
 * Leaderboard). Tone is intentionally calm and motivational: "patterns
 * to sharpen", not "where you're weak".
 */
export default function InsightsPage() {
 const overviewQ = useMockInsightsOverviewQuery()
 const overview = overviewQ.data
 return (
 <AppShellV2>
 <div className="flex flex-col gap-8 px-4 py-6 sm:px-8 lg:px-20 lg:py-10">
 <header className="flex flex-col gap-3">
 <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-text-muted">
 last 30 days
 </span>
 <div className="flex flex-col gap-1.5 lg:flex-row lg:items-end lg:justify-between lg:gap-4">
 <h1 className="font-display text-3xl font-bold leading-tight text-text-primary lg:text-4xl">
 Insights
 </h1>
 {overview && overview.total_sessions_30d > 0 && (
 <div className="flex items-center gap-4 font-mono text-[12px] text-text-secondary">
 <span>
 <span className="font-display text-base font-bold text-text-primary">
 {overview.total_sessions_30d}
 </span>{' '}
 mock sessions
 </span>
 <span>
 <span className="font-display text-base font-bold text-text-primary">
 {overview.pipeline_pass_rate_30d}%
 </span>{' '}
 pipeline pass rate
 </span>
 </div>
 )}
 </div>
 <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">
 What your last month of practice tells us — stage performance, recurring
 themes worth sharpening, and your score trajectory. All counts are
 user-scoped and refresh after every finished mock session.
 </p>
 </header>

 {/* AI Coach narrative — single paragraph synthesised from the data
     below. Hero of the page when there's anything to talk about. */}
 {overview?.summary && (
 <CoachSummaryCard summary={overview.summary} />
 )}

 {/* Top row — three live intel widgets */}
 <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
 <WeeklyDigestCard />
 <StagePerformanceCard
 rows={overview?.stage_performance ?? []}
 loading={overviewQ.isPending}
 errored={overviewQ.isError}
 />
 <ScoreTrajectoryCard
 series={overview?.score_trajectory ?? []}
 loading={overviewQ.isPending}
 errored={overviewQ.isError}
 />
 </section>

 {/* Patterns to sharpen — wider card, important block */}
 <section>
 <PatternsCard
 patterns={overview?.recurring_patterns ?? []}
 loading={overviewQ.isPending}
 errored={overviewQ.isError}
 />
 </section>

 {/* Atlas — "what to learn next" sub-section */}
 <section className="flex flex-col gap-3">
 <div className="flex items-baseline justify-between gap-2">
 <h2 className="font-display text-xl font-bold text-text-primary">
 Skill Atlas
 </h2>
 <Link
 to="/atlas"
 className="inline-flex items-center gap-1.5 font-mono text-[12px] text-text-primary hover:underline"
 >
 Open full view <ArrowRight className="h-3.5 w-3.5" />
 </Link>
 </div>
 <AtlasPreviewCard />
 </section>

 {/* Mock leaderboard — fairness-watermarked, real data. */}
 <section className="flex flex-col gap-3">
 <LeaderboardCard />
 </section>
 </div>
 </AppShellV2>
 )
}

/* ─── Widgets ─── */

function WeeklyDigestCard() {
 const briefQ = useDailyBriefQuery()
 const brief = briefQ.data
 const loading = briefQ.isPending
 const failed = briefQ.isError && !briefQ.data

 return (
 <Card className="flex-col gap-3 p-5" interactive={false}>
 <div className="flex items-center gap-2">
 <Sparkles className="h-4 w-4 text-text-primary" />
 <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-primary">
 AI coach · today
 </span>
 </div>

 {loading && (
 <p className="text-[13px] leading-relaxed text-text-muted">
 Loading brief…
 </p>
 )}

 {failed && (
 <>
 <h3 className="font-display text-lg font-bold leading-tight text-text-primary">
 Coach is offline.
 </h3>
 <p className="text-[13px] leading-relaxed text-text-secondary">
 Daily brief недоступен — LLM chain не отвечает или у тебя ещё нет
 данных. Попробуй позже.
 </p>
 </>
 )}

 {brief && (
 <>
 <h3 className="font-display text-lg font-bold leading-tight text-text-primary">
 {brief.headline}
 </h3>
 <p className="text-[13px] leading-relaxed text-text-secondary">
 <InlineMarkdown text={brief.narrative} />
 </p>
 {brief.recommendations && brief.recommendations.length > 0 && (
 <ul className="mt-2 flex flex-col gap-2">
 {brief.recommendations.slice(0, 3).map((r, i) => (
 <li
 key={i}
 className="flex items-start gap-2 rounded-md border border-border bg-surface-2 p-2 text-[12px] text-text-secondary"
 >
 <span
 className="mt-0.5 inline-flex shrink-0 rounded border border-border bg-surface-1 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted"
 >
 {kindLabel(r.kind)}
 </span>
 <div className="flex flex-col gap-0.5">
 <span className="font-medium text-text-primary">
 <InlineMarkdown text={r.title} />
 </span>
 <span className="text-[11px] leading-snug text-text-muted">
 <InlineMarkdown text={r.rationale} />
 </span>
 </div>
 </li>
 ))}
 </ul>
 )}
 </>
 )}
 </Card>
 )
}

// InlineMarkdown — минимальный inline-only markdown renderer. Поддерживает
// только `[label](url)` ссылки. Coach prompt инструктирован эмитить URL'ы
// вида `/codex?topic=algorithms` для диплинка в каталог знаний — без этого
// рекомендации «изучи redis» оставались мёртвым текстом без действия.
// Любой URL начинающийся с `/` рендерится как in-app router link;
// абсолютные http(s) URL'ы открываются в new tab. Хитроумные markdown
// фичи (bold, code) намеренно НЕ поддерживаются — мы не хотим скармливать
// LLM'у сложную грамматику и потом дебажить malformed output.
function InlineMarkdown({ text }: { text: string }) {
  const parts: Array<React.ReactNode> = []
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g
  let lastIdx = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index))
    const label = m[1] ?? ''
    const href = m[2] ?? ''
    const isExternal = /^https?:\/\//i.test(href)
    parts.push(
      <a
        key={key++}
        href={href}
        {...(isExternal
          ? { target: '_blank', rel: 'noopener noreferrer' }
          : {})}
        className="text-text-primary underline decoration-text-muted/40 underline-offset-2 hover:decoration-text-primary"
      >
        {label}
      </a>,
    )
    lastIdx = re.lastIndex
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx))
  return <>{parts}</>
}

function kindLabel(k: RecommendationKind): string {
 switch (k) {
 case 'tiny_task': return 'TINY TASK'
 case 'schedule': return 'SCHEDULE'
 case 'review_note': return 'REVIEW NOTE'
 case 'unblock': return 'UNBLOCK'
 case 'practice_skill': return 'SKILL'
 case 'drill_mock': return 'MOCK'
 case 'drill_kata': return 'KATA'
 default: return 'TIP'
 }
}

// ── AI Coach summary ─────────────────────────────────────────────────
// Single-paragraph narrative synthesised by the backend from the same
// data the cards below show. Server-side cache 30 min, so every page
// mount within that window reads it instantly. Tone is set in the
// system prompt: factual + supportive + ends with a concrete next step.
function CoachSummaryCard({ summary }: { summary: string }) {
 return (
 <Card
  className="flex-col gap-3 border-text-primary/30 bg-gradient-to-br from-text-primary/[0.04] to-transparent p-6"
  interactive={false}
 >
 <div className="flex items-center gap-2">
 <Sparkles className="h-4 w-4 text-text-primary" />
 <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-primary">
 AI Coach · this month
 </span>
 </div>
 <p className="text-[14px] leading-relaxed text-text-primary">{summary}</p>
 </Card>
 )
}

// ── Stage performance ────────────────────────────────────────────────
//
// Bar list per stage_kind with pass rate (0-100%). Empty / loading /
// error states render distinct copy so the user knows whether to wait
// or do something. Tone: report findings, no judgement.
function StagePerformanceCard({
 rows,
 loading,
 errored,
}: {
 rows: StagePerformance[]
 loading: boolean
 errored: boolean
}) {
 const stageLabel: Record<string, string> = {
  hr: 'HR',
  algorithms: 'Algorithms',
  algo: 'Algorithms',
  coding: 'Coding',
  sysdesign: 'System design',
  sys_design: 'System design',
  behavioral: 'Behavioral',
 }
 const sorted = [...rows].sort((a, b) => b.total - a.total)
 return (
 <Card className="flex-col gap-3 p-5" interactive={false}>
 <div className="flex items-center gap-2">
 <Target className="h-4 w-4 text-text-primary" />
 <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-primary">
 Performance by stage
 </span>
 </div>
 <h3 className="font-display text-base font-bold leading-tight text-text-primary">
 Where the signal is strongest — and where there's room.
 </h3>
 {loading && <p className="text-[13px] text-text-muted">Loading…</p>}
 {errored && !loading && (
 <p className="text-[13px] text-text-muted">Couldn't load — try later.</p>
 )}
 {!loading && !errored && sorted.length === 0 && (
 <p className="text-[13px] text-text-secondary">
 No finished stages yet. Run a mock pipeline and the breakdown shows up here.
 </p>
 )}
 {sorted.length > 0 && (
 <ul className="flex flex-col gap-2.5">
 {sorted.map((s) => (
 <li key={s.stage_kind} className="flex flex-col gap-1">
 <div className="flex items-baseline justify-between gap-3 font-mono text-[11px]">
 <span className="text-text-primary">
 {stageLabel[s.stage_kind] ?? s.stage_kind}
 </span>
 <span className="text-text-muted">
 {s.passed}/{s.total} ·{' '}
 <span className="text-text-primary">{s.pass_rate}%</span>
 </span>
 </div>
 <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
 <div
  className="h-full bg-text-primary"
  style={{ width: `${Math.max(2, s.pass_rate)}%` }}
 />
 </div>
 </li>
 ))}
 </ul>
 )}
 </Card>
 )
}

// ── Score trajectory ─────────────────────────────────────────────────
//
// Sparkline of total_score across last N finished pipelines. Returned
// oldest→newest so we can render left-to-right without sorting again.
function ScoreTrajectoryCard({
 series,
 loading,
 errored,
}: {
 series: ScoreTrajectoryPoint[]
 loading: boolean
 errored: boolean
}) {
 const last = series[series.length - 1]
 const first = series[0]
 const trend =
  series.length >= 2 && first && last
   ? Math.round(last.score - first.score)
   : 0
 const trendLabel =
  series.length < 2
   ? null
   : trend > 0
    ? `+${trend} vs first`
    : trend < 0
     ? `${trend} vs first`
     : 'flat vs first'
 return (
 <Card className="flex-col gap-3 p-5" interactive={false}>
 <div className="flex items-center gap-2">
 <TrendingUp className="h-4 w-4 text-text-primary" />
 <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-primary">
 Score trajectory
 </span>
 </div>
 <h3 className="font-display text-base font-bold leading-tight text-text-primary">
 {series.length > 0
  ? `Last ${series.length} session${series.length === 1 ? '' : 's'}`
  : 'Last 10 sessions'}
 </h3>
 {loading && <p className="text-[13px] text-text-muted">Loading…</p>}
 {errored && !loading && (
 <p className="text-[13px] text-text-muted">Couldn't load — try later.</p>
 )}
 {!loading && !errored && series.length === 0 && (
 <p className="text-[13px] text-text-secondary">
 Once you finish a couple of pipelines, the score curve appears here.
 </p>
 )}
 {series.length > 0 && (
 <div className="flex flex-col gap-2">
 <Sparkline points={series} />
 <div className="flex items-baseline justify-between gap-2 font-mono text-[11px] text-text-muted">
 <span>
 latest{' '}
 <span className="font-display text-base font-bold tabular-nums text-text-primary">
 {Math.round(last?.score ?? 0)}
 </span>
 </span>
 {trendLabel && <span>{trendLabel}</span>}
 </div>
 </div>
 )}
 </Card>
 )
}

function Sparkline({ points }: { points: ScoreTrajectoryPoint[] }) {
 const navigate = useNavigate()
 if (points.length === 0) return null
 const w = 240
 const h = 56
 const pad = 4
 const xs = points.map((_, i) =>
  points.length === 1
   ? w / 2
   : pad + (i * (w - 2 * pad)) / (points.length - 1),
 )
 const ys = points.map(
  (p) => h - pad - ((p.score / 100) * (h - 2 * pad)),
 )
 const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
 const lastX = xs[xs.length - 1]
 const lastY = ys[ys.length - 1]
 const drillTo = (id: string) => {
  if (id) navigate(`/mock/pipeline/${id}/debrief`)
 }
 return (
 <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full">
 <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-text-primary" />
 {points.map((p, i) => (
 <g key={i}>
  {/* Bigger transparent hit-area on top of the visible 1.6r dot — */}
  {/* the user's mouse target stays comfortable. */}
  <circle
   cx={xs[i]}
   cy={ys[i]}
   r={8}
   className="cursor-pointer fill-transparent"
   onClick={() => drillTo(p.pipeline_id)}
  >
   <title>{`${Math.round(p.score)}/100 · ${p.verdict.toUpperCase()} · ${new Date(p.finished_at).toLocaleDateString()} — click for debrief`}</title>
  </circle>
  <circle
   cx={xs[i]}
   cy={ys[i]}
   r={1.6}
   className={`pointer-events-none ${p.verdict === 'pass' ? 'fill-success' : 'fill-danger'}`}
  />
 </g>
 ))}
 <circle cx={lastX} cy={lastY} r={3} className="pointer-events-none fill-text-primary" />
 </svg>
 )
}

// ── Patterns to sharpen ──────────────────────────────────────────────
//
// Top recurring missing_points across attempts. Carefully worded:
// "patterns to sharpen", not "what you fail at". Counts make it
// concrete without being shaming.
function PatternsCard({
 patterns,
 loading,
 errored,
}: {
 patterns: RecurringPattern[]
 loading: boolean
 errored: boolean
}) {
 return (
 <Card className="flex-col gap-3 p-5" interactive={false}>
 <div className="flex items-center gap-2">
 <Compass className="h-4 w-4 text-text-primary" />
 <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-primary">
 Patterns to sharpen
 </span>
 </div>
 <h3 className="font-display text-base font-bold leading-tight text-text-primary">
 Themes that came up most across your last sessions.
 </h3>
 {loading && <p className="text-[13px] text-text-muted">Loading…</p>}
 {errored && !loading && (
 <p className="text-[13px] text-text-muted">Couldn't load — try later.</p>
 )}
 {!loading && !errored && patterns.length === 0 && (
 <p className="text-[13px] text-text-secondary">
 No recurring themes yet — finish a few mocks and the AI judges'
 missing-points cluster shows up here.
 </p>
 )}
 {patterns.length > 0 && (
 <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
 {patterns.map((p, i) => (
 <li
  key={p.point + i}
  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2"
 >
 <span className="truncate text-[13px] text-text-primary first-letter:uppercase">
 {p.point}
 </span>
 <span className="shrink-0 rounded-full bg-bg/40 px-2 py-0.5 font-mono text-[10px] tabular-nums text-text-muted">
 ×{p.count}
 </span>
 </li>
 ))}
 </ul>
 )}
 </Card>
 )
}

function AtlasPreviewCard() {
 const atlasQ = useAtlasQuery()
 const nodes = atlasQ.data?.nodes ?? []
 // Stat semantics:
 //  - Узлов  = всего нод в атласе
 //  - Освоено = unlocked && !decaying (полная mastery, без распада)
 //  - В работе = есть прогресс, но ещё не unlocked (учим)
 //  - Декай  = unlocked-then-decaying (надо подтянуть)
 const total = nodes.length
 const mastered = nodes.filter((n) => n.unlocked && !n.decaying).length
 const inProgress = nodes.filter((n) => !n.unlocked && (n.progress ?? 0) > 0).length
 const decaying = nodes.filter((n) => n.decaying).length
 const fmt = (v: number) => (atlasQ.isPending ? '…' : atlasQ.isError ? '—' : String(v))
 return (
 <Card className="flex-col gap-4 p-6" interactive={false}>
 <div className="flex items-start justify-between gap-4">
 <div className="flex flex-col gap-1">
 <div className="flex items-center gap-2">
 <MapIcon className="h-4 w-4 text-text-primary" />
 <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-primary">
 Atlas
 </span>
 </div>
 <p className="text-[13px] leading-relaxed text-text-secondary">
 Снимок навыков: что освоено, что учишь, что начинает разваливаться.
 Обновляется после mock-собесов, kata-solves и матчей.
 </p>
 </div>
 <Link
 to="/atlas"
 className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border-strong bg-text-primary/5 px-4 py-2 font-sans text-[13px] font-medium text-text-primary hover:bg-text-primary/10"
 >
 Открыть Atlas <ArrowRight className="h-3.5 w-3.5" />
 </Link>
 </div>
 <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
 <AtlasMiniStat label="Узлов" value={fmt(total)} />
 <AtlasMiniStat label="Освоено" value={fmt(mastered)} />
 <AtlasMiniStat label="В работе" value={fmt(inProgress)} />
 <AtlasMiniStat label="Декай" value={fmt(decaying)} />
 </div>
 </Card>
 )
}

function AtlasMiniStat({ label, value }: { label: string; value: string }) {
 return (
 <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
 <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
 {label}
 </span>
 <span className="font-display text-lg font-bold text-text-primary">{value}</span>
 </div>
 )
}

function LeaderboardCard() {
 const { data, isLoading, error } = useMockLeaderboardQuery({ limit: 10 })
 const items = data?.items ?? []
 return (
 <Card className="flex-col gap-4 p-5" interactive={false}>
 <div className="flex items-start justify-between gap-3">
 <div className="flex items-center gap-2">
 <Trophy className="h-4 w-4 text-text-primary" />
 <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-primary">
 Mock leaderboard · Top 10
 </span>
 </div>
 <span
  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted"
  title="Учитываются только пайплайны, пройденные с выключенным AI-ассистом."
 >
 <Shield className="h-3 w-3" />
 fair · ai-off only
 </span>
 </div>
 {isLoading && (
 <p className="text-[13px] text-text-muted">Загрузка…</p>
 )}
 {error && !isLoading && (
 <p className="text-[13px] text-text-muted">
 Лидерборд временно недоступен.
 </p>
 )}
 {!isLoading && !error && items.length === 0 && (
 <p className="text-[13px] text-text-secondary">
 Пока ни одного завершённого мок-собеса в честном режиме. Будь первым —
 запусти пайплайн с выключенным AI-ассистом.
 </p>
 )}
 {items.length > 0 && (
 <ol className="flex flex-col gap-1">
 {items.map((e) => (
 <li
  key={e.user_id}
  className="grid grid-cols-[2rem_1fr_auto_auto] items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2"
 >
 <span className="font-mono text-[11px] tabular-nums text-text-muted">
 #{e.rank}
 </span>
 <span className="truncate font-sans text-[13px] font-medium text-text-primary">
 {e.display_name}
 </span>
 <span className="font-mono text-[11px] text-text-muted">
 {e.pipelines_passed}/{e.pipelines_finished} pass
 </span>
 <span className="font-display text-sm font-bold tabular-nums text-text-primary">
 {e.avg_score.toFixed(1)}
 </span>
 </li>
 ))}
 </ol>
 )}
 </Card>
 )
}
