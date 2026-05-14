// MockPipelineDebrief — terminal report after a pipeline finishes.
//
// Route: /mock/pipeline/:pipelineId/debrief
//
// Sections:
//   1. Hero with overall verdict (pass/fail/cancelled) + total score.
//   2. Per-stage breakdown — verdict badge + score per stage, optional
//      expanded `ai_feedback_md`.
//   3. Top 5 missing points aggregated across all attempts.
//   4. CTAs: "Попробовать ещё раз" (re-creates pipeline with same company
//      + ai_assist) / "В Insights" (/insights).

import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppShellV2 } from '../../components/AppShell'
import { bcp47 } from '../../lib/i18n'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { clearCanvasDraftsForAttempts } from '../../lib/canvasDraft'
import {
  isComingSoonError,
  STAGE_LABEL,
  useCreateMockPipelineMutation,
  useMockCompaniesQuery,
  useMockPipelineQuery,
  type Pipeline,
  type PipelineStage,
} from '../../lib/queries/mockPipeline'

export default function MockPipelineDebrief() {
  const { t } = useTranslation('pages')
  const { pipelineId } = useParams<{ pipelineId: string }>()
  const navigate = useNavigate()
  const pipelineQ = useMockPipelineQuery(pipelineId)
  const companiesQ = useMockCompaniesQuery()
  const create = useCreateMockPipelineMutation()

  // Pipeline is over → drop the localStorage drafts for every sysdesign
  // attempt (server-side drafts are already wiped by FinishPipeline /
  // CancelPipeline; this purges the client-side mirror).
  useEffect(() => {
    if (!pipelineQ.data) return
    const ids: string[] = []
    for (const s of pipelineQ.data.stages ?? []) {
      for (const a of s.attempts ?? []) ids.push(a.id)
    }
    if (ids.length > 0) clearCanvasDraftsForAttempts(ids)
  }, [pipelineQ.data])

  if (pipelineQ.isLoading) {
    return (
      <AppShellV2>
        <div className="px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
          <EmptyState variant="loading" skeletonLayout="card-grid" />
        </div>
      </AppShellV2>
    )
  }

  if (pipelineQ.isError && isComingSoonError(pipelineQ.error)) {
    return (
      <AppShellV2>
        <div className="px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
          <EmptyState
            variant="coming-soon"
            title="Mock Interview"
            body={t('mock_debrief.coming_soon_body')}
            cta={{ label: t('mock_debrief.to_picker'), onClick: () => navigate('/mock') }}
          />
        </div>
      </AppShellV2>
    )
  }

  if (pipelineQ.isError || !pipelineQ.data) {
    return (
      <AppShellV2>
        <div className="px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
          <EmptyState
            variant="error"
            title={t('mock_debrief.report_unavailable')}
            cta={{ label: t('mock_debrief.retry'), onClick: () => pipelineQ.refetch() }}
            secondaryCta={{ label: t('mock_debrief.new_interview'), onClick: () => navigate('/mock') }}
          />
        </div>
      </AppShellV2>
    )
  }

  const pipeline = pipelineQ.data

  // Pipeline still in progress → user landed here too early; bounce back.
  if (pipeline.verdict === 'in_progress') {
    return <Navigate to={`/mock/pipeline/${pipeline.id}`} replace />
  }

  const company = companiesQ.data?.find((c) => c.id === pipeline.company_id) ?? null
  const stages = [...pipeline.stages].sort((a, b) => a.ordinal - b.ordinal)

  const topMissing = aggregateMissingPoints(pipeline)

  const handleRetry = () => {
    create.mutate(
      { company_id: pipeline.company_id ?? undefined, ai_assist: pipeline.ai_assist },
      { onSuccess: (next) => navigate(`/mock/pipeline/${next.id}`) },
    )
  }

  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <div>
          <button
            type="button"
            onClick={() => navigate('/mock')}
            className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" />{t('mock_debrief.to_picker')}
          </button>
        </div>

        <DebriefHero pipeline={pipeline} companyName={company?.name ?? null} />

        <section className="flex flex-col gap-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
            {t('mock_debrief.radar_title')}
          </div>
          <Card variant="default" padding="lg" className="flex flex-col items-center gap-3">
            <PipelineRadar stages={stages} />
            <div className="font-mono text-[10px] text-text-secondary text-center max-w-md">
              {t('mock_debrief.radar_caption')}
            </div>
          </Card>
        </section>

        <section className="flex flex-col gap-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
            {t('mock_debrief.by_stages')}
          </div>
          <div className="flex flex-col gap-2">
            {stages.map((s) => (
              <StageRow key={s.id} stage={s} />
            ))}
          </div>
        </section>

        {topMissing.length > 0 && (
          <section className="flex flex-col gap-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
              {t('mock_debrief.missing_title')}
            </div>
            <Card variant="default" padding="lg">
              <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
                {topMissing.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="md"
            onClick={handleRetry}
            loading={create.isPending}
            disabled={create.isPending}
          >
            {t('mock_debrief.try_again')}
          </Button>
          <Button variant="ghost" size="md" onClick={() => navigate('/insights')}>
            {t('mock_debrief.to_insights')}
          </Button>
        </div>
      </div>
    </AppShellV2>
  )
}

// ── DebriefHero ─────────────────────────────────────────────────────────

function DebriefHero({
  pipeline,
  companyName,
}: {
  pipeline: Pipeline
  companyName: string | null
}) {
  const { t } = useTranslation('pages')
  const v = pipeline.verdict
  const total = pipeline.total_score ?? 0
  const dateLabel = formatDate(pipeline.finished_at ?? pipeline.started_at)

  if (v === 'cancelled') {
    return (
      <Card variant="default" padding="lg" className="flex flex-col gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
          {t('mock_debrief.cancelled_eyebrow')}
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
          {t('mock_debrief.cancelled_title')}
        </h1>
        <p className="text-sm text-text-secondary">
          {companyName ?? 'Random'} · {dateLabel}
        </p>
      </Card>
    )
  }

  const isPass = v === 'pass'
  const Icon = isPass ? CheckCircle2 : XCircle
  const title = isPass ? t('mock_debrief.passed') : t('mock_debrief.failed')
  const sub = isPass
    ? t('mock_debrief.pass_sub')
    : t('mock_debrief.fail_sub')

  return (
    <Card
      variant="default"
      padding="lg"
      className="relative flex flex-col gap-3 border border-border-strong bg-surface-2"
    >
      {!isPass && (
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-[1.5px]"
          style={{ background: 'var(--red)' }}
        />
      )}
      <div className="flex items-center gap-3">
        <Icon
          className="h-8 w-8 text-text-primary"
          style={!isPass ? { color: 'var(--red)' } : undefined}
        />
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
            {title}
          </h1>
          <p className="text-sm text-text-secondary">{sub}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-mono text-3xl font-bold tabular-nums text-text-primary">
          {total}
          <span className="text-sm text-text-secondary ml-1">/ 100</span>
        </div>
        <span className="text-xs text-text-secondary">
          {companyName ?? 'Random'} · {dateLabel}
        </span>
      </div>
    </Card>
  )
}

// ── StageRow ────────────────────────────────────────────────────────────

function StageRow({ stage }: { stage: PipelineStage }) {
  const { t } = useTranslation('pages')
  const navigate = useNavigate()
  const [open, setOpen] = useState<boolean>(false)
  const hasFeedback = !!stage.ai_feedback_md
  // Red signal stripe + ink ramp opacity instead of multi-hue verdict text:
  // pass = full ink, borderline/fail = red accent on icon/label.
  const isFail = stage.verdict === 'fail'
  const isBorderline = stage.verdict === 'borderline'
  const verdictLabel =
    stage.status === 'skipped'
      ? 'skipped'
      : stage.verdict === 'pass'
        ? 'pass'
        : stage.verdict === 'fail'
          ? 'fail'
          : stage.verdict === 'borderline'
            ? 'borderline'
            : '—'
  const VIcon =
    stage.verdict === 'pass'
      ? CheckCircle2
      : stage.verdict === 'fail'
        ? XCircle
        : null

  // Wave 15 — gather attempts that have a user answer (worth replaying).
  // Skipped / blank attempts get filtered out so the "Разобрать" CTA only
  // appears where there's actually something to compare.
  const replayableAttempts = stage.attempts.filter(
    (a) => (a.user_answer_md ?? '').trim().length > 0,
  )

  return (
    <Card variant="default" padding="md" className="relative flex flex-col gap-2">
      {(isFail || isBorderline) && (
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-lg"
          style={{ background: 'var(--red)' }}
        />
      )}
      <button
        type="button"
        onClick={() => hasFeedback && setOpen((v) => !v)}
        className={[
          'flex items-center gap-3 text-left transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-emphasized)]',
          hasFeedback ? 'cursor-pointer' : 'cursor-default',
        ].join(' ')}
        disabled={!hasFeedback}
      >
        <span className="font-display font-bold text-text-primary w-32 truncate">
          {STAGE_LABEL[stage.stage_kind]}
        </span>
        <span
          className="flex items-center gap-1 text-sm font-medium tracking-[0.08em] text-text-primary"
          style={isFail || isBorderline ? { color: 'var(--red)' } : undefined}
        >
          {VIcon && <VIcon className="h-4 w-4" />}
          {verdictLabel}
        </span>
        <span className="font-mono text-sm tabular-nums text-text-primary ml-auto">
          {stage.score ?? '—'}
          <span className="text-text-secondary">/100</span>
        </span>
        {hasFeedback &&
          (open ? (
            <ChevronDown className="h-4 w-4 text-text-secondary" />
          ) : (
            <ChevronRight className="h-4 w-4 text-text-secondary" />
          ))}
      </button>
      {open && stage.ai_feedback_md && (
        <div className="rounded-lg border border-border bg-surface-1 p-3 text-sm text-text-secondary whitespace-pre-wrap">
          {stage.ai_feedback_md}
        </div>
      )}
      {replayableAttempts.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {replayableAttempts.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/mock/replay/${a.id}`)
              }}
              className="rounded-md border border-border bg-transparent px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
            >
              {replayableAttempts.length > 1
                ? t('mock_debrief.replay_attempt', { n: i + 1 })
                : t('mock_debrief.replay')}
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── helpers ─────────────────────────────────────────────────────────────

function aggregateMissingPoints(pipeline: Pipeline): string[] {
  const counts = new Map<string, number>()
  for (const s of pipeline.stages) {
    for (const a of s.attempts) {
      for (const m of a.ai_missing_points ?? []) {
        const key = m.trim()
        if (!key) continue
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k)
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(bcp47(), { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

// ── PipelineRadar — 5-axis radar across all stages ──────────────────────
//
// Each canonical stage (HR / Algo / Coding / SysDesign / Behavioral) maps
// to one axis. Score is normalized to 0..5 by dividing the stage's 0..100
// score by 20. Stages without a score (skipped / not finished) render the
// axis at 0 — visible as a notch toward centre.
//
// B/W only: stroke-based polygon (no fill), tick labels in monospace, axis
// labels in uppercase. No gradient / glow / colored markers.

const RADAR_AXES: { kind: PipelineStage['stage_kind']; label: string }[] = [
  { kind: 'hr', label: 'HR' },
  { kind: 'algo', label: 'Algo' },
  { kind: 'coding', label: 'Coding' },
  { kind: 'sysdesign', label: 'SysDesign' },
  { kind: 'behavioral', label: 'Behav' },
]

function PipelineRadar({ stages }: { stages: PipelineStage[] }) {
  const { t } = useTranslation('wave14')
  // Build a kind → 0..5 value map. Missing stage = 0.
  const byKind = new Map<PipelineStage['stage_kind'], number>()
  for (const s of stages) {
    const raw = s.score ?? 0
    const v = Math.max(0, Math.min(5, raw / 20))
    byKind.set(s.stage_kind, v)
  }

  const cx = 150
  const cy = 150
  const r = 110
  const n = RADAR_AXES.length
  // 5 axes evenly spaced clockwise from 12 o'clock.
  const axisGeometry = RADAR_AXES.map((a, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n
    return { ...a, angle, value: byKind.get(a.kind) ?? 0 }
  })

  // Polygon points for the score path.
  const valuePoints = axisGeometry
    .map((a) => {
      const ratio = a.value / 5
      const x = cx + Math.cos(a.angle) * r * ratio
      const y = cy + Math.sin(a.angle) * r * ratio
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  // Grid rings — 5 concentric pentagons.
  const ringPoints = (step: number) => {
    const rr = (r * step) / 5
    return axisGeometry
      .map((a) => {
        const x = cx + Math.cos(a.angle) * rr
        const y = cy + Math.sin(a.angle) * rr
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }

  const filled = axisGeometry.filter((a) => a.value > 0)
  const avg =
    filled.length === 0
      ? 0
      : filled.reduce((acc, a) => acc + a.value, 0) / filled.length

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        viewBox="0 0 300 300"
        className="w-full max-w-[320px]"
        aria-label="Mock interview 5-axis radar"
      >
        {/* Grid rings */}
        {[1, 2, 3, 4, 5].map((step) => (
          <polygon
            key={step}
            points={ringPoints(step)}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.5}
            className="text-border"
          />
        ))}
        {/* Axis spokes */}
        {axisGeometry.map((a, i) => (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={cx + Math.cos(a.angle) * r}
            y2={cy + Math.sin(a.angle) * r}
            stroke="currentColor"
            strokeWidth={0.5}
            className="text-border"
          />
        ))}
        {/* Score polygon */}
        <polygon
          points={valuePoints}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          className="text-text-primary"
        />
        {/* Per-axis ticks (the score dots) */}
        {axisGeometry.map((a, i) => {
          const ratio = a.value / 5
          const x = cx + Math.cos(a.angle) * r * ratio
          const y = cy + Math.sin(a.angle) * r * ratio
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={2.5}
              className="fill-text-primary"
            />
          )
        })}
        {/* Axis labels + numeric values */}
        {axisGeometry.map((a, i) => {
          const lx = cx + Math.cos(a.angle) * (r + 22)
          const ly = cy + Math.sin(a.angle) * (r + 22)
          return (
            <g key={i}>
              <text
                x={lx}
                y={ly - 5}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-text-secondary"
                style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em' }}
              >
                {a.label}
              </text>
              <text
                x={lx}
                y={ly + 7}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-text-primary"
                style={{ fontFamily: 'monospace', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
              >
                {a.value.toFixed(1)}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
          {t('mock_debrief_extra.average')}
        </span>
        <span className="font-mono text-lg font-bold text-text-primary tabular-nums">
          {avg.toFixed(1)}
          <span className="text-xs text-text-secondary ml-0.5">/ 5</span>
        </span>
      </div>
    </div>
  )
}
