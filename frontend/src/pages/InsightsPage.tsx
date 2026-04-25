import { Link } from 'react-router-dom'
import { ArrowRight, Brain, Flame, Map as MapIcon, RefreshCw, Shield, Sparkles, Target, Trophy, TrendingUp } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Card } from '../components/Card'
import { useMockLeaderboardQuery } from '../lib/queries/mockPipeline'
import {
 useDailyBriefQuery,
 useRegenerateDailyBriefMutation,
 type RecommendationKind,
} from '../lib/queries/intelligence'

/**
 * InsightsPage — Wave 4 of ADR-001.
 *
 * Aggregated analytics surface across the three druz9 surfaces (web /
 * Hone / Cue). The killer feature per docs/ecosystem.md: a single
 * narrative of the user's growth — what they solved, what they focused
 * on, what mock-interview signals say about readiness — fed by the
 * `services/intelligence` module which subscribes to all the relevant
 * cross-surface events.
 *
 * Status: skeleton. Widgets show placeholder copy until the intelligence
 * service exposes the corresponding RPCs (`GetWeeklyIntel`,
 * `GetReadinessForecast`, `GetAtlasUpdate`). The IA — top-nav slot
 * between Atlas and Circles — is the load-bearing piece this page
 * delivers; data flows in incrementally as backend ships.
 *
 * Atlas is intentionally linked from here as a sub-view — Skill Atlas
 * fits inside the "what to learn next" intelligence narrative, not as
 * its own standalone destination.
 */
export default function InsightsPage() {
 return (
 <AppShellV2>
 <div className="flex flex-col gap-8 px-4 py-6 sm:px-8 lg:px-20 lg:py-10">
 <header className="flex flex-col gap-2">
 <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-text-muted">
 Wave 4 · skeleton
 </span>
 <h1 className="font-display text-3xl font-bold leading-tight text-text-primary lg:text-4xl">
 Insights
 </h1>
 <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">
 Что говорит твоя статистика — по матчам, mock-сессиям, фокус-времени и
 заметкам. Сводный отчёт за неделю, прогноз готовности к собесу и точки
 роста на Skill Atlas. Данные приходят из всех трёх поверхностей druz9
 (web · Hone · Cue) и обновляются автоматически.
 </p>
 </header>

 {/* Top row — three primary intel widgets */}
 <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
 <WeeklyDigestCard />
 <ReadinessForecastCard />
 <FocusTrendCard />
 </section>

 {/* Atlas — the "what to learn next" view, framed as a sub-section */}
 <section className="flex flex-col gap-3">
 <div className="flex items-baseline justify-between gap-2">
 <h2 className="font-display text-xl font-bold text-text-primary">
 Skill Atlas
 </h2>
 <Link
 to="/atlas"
 className="inline-flex items-center gap-1.5 font-mono text-[12px] text-text-primary hover:underline"
 >
 Открыть полностью <ArrowRight className="h-3.5 w-3.5" />
 </Link>
 </div>
 <AtlasPreviewCard />
 </section>

 {/* Mock leaderboard — fairness-watermarked, real data. */}
 <section className="flex flex-col gap-3">
 <LeaderboardCard />
 </section>

 {/* Bottom row — secondary context */}
 <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
 <MockSignalsCard />
 <CrossSurfaceCard />
 </section>
 </div>
 </AppShellV2>
 )
}

/* ─── Widgets ─── */

function WeeklyDigestCard() {
 const briefQ = useDailyBriefQuery()
 const regen = useRegenerateDailyBriefMutation()
 const brief = briefQ.data
 const loading = briefQ.isPending
 const failed = briefQ.isError && !briefQ.data

 return (
 <Card className="flex-col gap-3 p-5" interactive={false}>
 <div className="flex items-center justify-between gap-2">
 <div className="flex items-center gap-2">
 <Sparkles className="h-4 w-4 text-text-primary" />
 <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-primary">
 AI coach · today
 </span>
 </div>
 <button
 onClick={() => regen.mutate()}
 disabled={regen.isPending}
 title="Regenerate brief"
 className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition hover:bg-surface-2 hover:text-text-primary disabled:opacity-40"
 >
 <RefreshCw className={`h-3 w-3 ${regen.isPending ? 'animate-spin' : ''}`} />
 </button>
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
 {brief.narrative}
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
 <span className="font-medium text-text-primary">{r.title}</span>
 <span className="text-[11px] leading-snug text-text-muted">
 {r.rationale}
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

function ReadinessForecastCard() {
 return (
 <Card className="flex-col gap-3 p-5" interactive={false}>
 <div className="flex items-center gap-2">
 <Target className="h-4 w-4 text-text-primary" />
 <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-primary">
 Readiness forecast
 </span>
 </div>
 <h3 className="font-display text-lg font-bold leading-tight text-text-primary">
 Готовность к собесу — прогноз.
 </h3>
 <p className="text-[13px] leading-relaxed text-text-secondary">
 Bayesian-классификатор поверх mock-сессий («честный» режим) даст оценку:
 готов / нужно ещё N недель / какие пробелы критичны. RPC{' '}
 <span className="font-mono text-text-primary">GetReadinessForecast</span>.
 </p>
 <div className="mt-2 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
 ETA · Phase C
 </div>
 </Card>
 )
}

function FocusTrendCard() {
 return (
 <Card className="flex-col gap-3 p-5" interactive={false}>
 <div className="flex items-center gap-2">
 <Flame className="h-4 w-4 text-text-primary" />
 <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-primary">
 Focus trend · 7d
 </span>
 </div>
 <h3 className="font-display text-lg font-bold leading-tight text-text-primary">
 Фокус-время + стрик за 7 дней.
 </h3>
 <p className="text-[13px] leading-relaxed text-text-secondary">
 Heatmap из Hone (focus-sessions + plan adherence). Сейчас живёт в
 Profile · Stats; в Phase B переедет сюда финальной формой.
 </p>
 <div className="mt-2 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
 ETA · Phase B
 </div>
 </Card>
 )
}

function AtlasPreviewCard() {
 return (
 <Card className="flex-col gap-4 p-6" interactive={false}>
 <div className="flex items-start justify-between gap-4">
 <div className="flex flex-col gap-1">
 <div className="flex items-center gap-2">
 <MapIcon className="h-4 w-4 text-text-primary" />
 <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-primary">
 Atlas auto-update
 </span>
 </div>
 <p className="text-[13px] leading-relaxed text-text-secondary">
 Decay/mastery узлов будут обновляться автоматически на основе матчей,
 kata-solves и mock-сигналов. Сейчас атлас статичен — карта-снимок
 показывает текущее состояние навыков. RPC{' '}
 <span className="font-mono text-text-primary">GetAtlasUpdate</span>.
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
 <AtlasMiniStat label="Узлов" value="—" />
 <AtlasMiniStat label="Освоено" value="—" />
 <AtlasMiniStat label="В работе" value="—" />
 <AtlasMiniStat label="Декай" value="—" />
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

function MockSignalsCard() {
 return (
 <Card className="flex-col gap-3 p-5" interactive={false}>
 <div className="flex items-center gap-2">
 <Brain className="h-4 w-4 text-text-primary" />
 <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-primary">
 Mock signals
 </span>
 </div>
 <h3 className="font-display text-base font-bold leading-tight text-text-primary">
 Сравнение «честно» vs «с AI».
 </h3>
 <p className="text-[13px] leading-relaxed text-text-secondary">
 Mock-сессии теперь несут флаг{' '}
 <span className="font-mono text-text-primary">ai_assist</span> (Wave 3).
 Виджет покажет твой результат в обоих режимах и delta — насколько помогает
 AI. Это объективная метрика «готовности», когда выключаешь подсказки.
 </p>
 <div className="mt-2 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
 ETA · Phase A
 </div>
 </Card>
 )
}

function CrossSurfaceCard() {
 return (
 <Card className="flex-col gap-3 p-5" interactive={false}>
 <div className="flex items-center gap-2">
 <TrendingUp className="h-4 w-4 text-text-primary" />
 <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-primary">
 Cross-surface aggregation
 </span>
 </div>
 <h3 className="font-display text-base font-bold leading-tight text-text-primary">
 Web + Hone + Cue — одно событие.
 </h3>
 <p className="text-[13px] leading-relaxed text-text-secondary">
 Все три поверхности шлют события в общую шину: матчи и kata из web, focus
 и заметки из Hone, частые «застревания» из Cue. Intelligence-сервис
 склеивает их в единый таймлайн и кормит все остальные виджеты.
 </p>
 <div className="mt-2 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
 ETA · Phase C
 </div>
 </Card>
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
