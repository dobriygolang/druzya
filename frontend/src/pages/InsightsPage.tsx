import { Link } from 'react-router-dom'
import { ArrowRight, Brain, Flame, Map as MapIcon, Sparkles, Target, TrendingUp } from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { Card } from '../components/Card'

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
 return (
 <Card className="flex-col gap-3 p-5" interactive={false}>
 <div className="flex items-center gap-2">
 <Sparkles className="h-4 w-4 text-text-primary" />
 <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-primary">
 Weekly digest
 </span>
 </div>
 <h3 className="font-display text-lg font-bold leading-tight text-text-primary">
 Будет здесь — твоя неделя за 30 секунд.
 </h3>
 <p className="text-[13px] leading-relaxed text-text-secondary">
 Что сделал, где провалился, что важно сейчас. Сборка из arena-матчей,
 mock-сессий, focus-time и заметок. Источник —{' '}
 <span className="font-mono text-text-primary">services/intelligence</span>{' '}
 (RPC <span className="font-mono text-text-primary">GetWeeklyIntel</span>).
 </p>
 <div className="mt-2 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
 ETA · Phase A
 </div>
 </Card>
 )
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
