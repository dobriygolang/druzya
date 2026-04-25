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

import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, XCircle } from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
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
  const { pipelineId } = useParams<{ pipelineId: string }>()
  const navigate = useNavigate()
  const pipelineQ = useMockPipelineQuery(pipelineId)
  const companiesQ = useMockCompaniesQuery()
  const create = useCreateMockPipelineMutation()

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
            body="Сервис пайплайна ещё не активен."
            cta={{ label: 'К выбору компании', onClick: () => navigate('/mock') }}
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
            title="Отчёт недоступен"
            cta={{ label: 'Повторить', onClick: () => pipelineQ.refetch() }}
            secondaryCta={{ label: 'Новый собес', onClick: () => navigate('/mock') }}
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
            <ArrowLeft className="h-3.5 w-3.5" />К выбору компании
          </button>
        </div>

        <DebriefHero pipeline={pipeline} companyName={company?.name ?? null} />

        <section className="flex flex-col gap-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
            По этапам
          </div>
          <div className="flex flex-col gap-2">
            {stages.map((s) => (
              <StageRow key={s.id} stage={s} />
            ))}
          </div>
        </section>

        {topMissing.length > 0 && (
          <section className="flex flex-col gap-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
              Главное, что упустил
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
            Попробовать ещё раз
          </Button>
          <Button variant="ghost" size="md" onClick={() => navigate('/insights')}>
            В Insights
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
  const v = pipeline.verdict
  const total = pipeline.total_score ?? 0
  const dateLabel = formatDate(pipeline.finished_at ?? pipeline.started_at)

  if (v === 'cancelled') {
    return (
      <Card variant="default" padding="lg" className="flex flex-col gap-2">
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
          Прервано
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
          Собес прерван
        </h1>
        <p className="text-sm text-text-secondary">
          {companyName ?? 'Random'} · {dateLabel}
        </p>
      </Card>
    )
  }

  const isPass = v === 'pass'
  const cls = isPass
    ? 'border-success bg-success/10'
    : 'border-danger bg-danger/10'
  const Icon = isPass ? CheckCircle2 : XCircle
  const iconCls = isPass ? 'text-success' : 'text-danger'
  const title = isPass ? 'Сдал собес' : 'Не сдал'
  const sub = isPass
    ? 'Хорошая работа — продолжай в том же духе.'
    : 'Готовься ещё. Слабые места — ниже.'

  return (
    <Card variant="default" padding="lg" className={['flex flex-col gap-3 border', cls].join(' ')}>
      <div className="flex items-center gap-3">
        <Icon className={['h-8 w-8', iconCls].join(' ')} />
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
            {title}
          </h1>
          <p className="text-sm text-text-secondary">{sub}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-mono text-3xl font-bold text-text-primary">
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
  const [open, setOpen] = useState<boolean>(false)
  const hasFeedback = !!stage.ai_feedback_md
  const verdictCls =
    stage.verdict === 'pass'
      ? 'text-success'
      : stage.verdict === 'fail'
        ? 'text-danger'
        : stage.verdict === 'borderline'
          ? 'text-warn'
          : 'text-text-secondary'
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

  return (
    <Card variant="default" padding="md" className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => hasFeedback && setOpen((v) => !v)}
        className={[
          'flex items-center gap-3 text-left',
          hasFeedback ? 'cursor-pointer' : 'cursor-default',
        ].join(' ')}
        disabled={!hasFeedback}
      >
        <span className="font-display font-bold text-text-primary w-32 truncate">
          {STAGE_LABEL[stage.stage_kind]}
        </span>
        <span className={['flex items-center gap-1 text-sm font-medium', verdictCls].join(' ')}>
          {VIcon && <VIcon className="h-4 w-4" />}
          {verdictLabel}
        </span>
        <span className="font-mono text-sm text-text-primary ml-auto">
          {stage.score ?? '—'}<span className="text-text-secondary">/100</span>
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
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}
