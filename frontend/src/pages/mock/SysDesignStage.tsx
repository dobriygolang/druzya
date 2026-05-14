// SysDesignStage — R2 dedicated surface для SysDesign стадии mock pipeline'а.
//
// Wraps the existing <SysDesignCanvas> (Excalidraw + nfr/context textareas
// + canvas-judge SubmitCanvas) and adds an iterative «Run rubric» knob: a
// 5-axis text-only LLM rubric (availability / consistency / scalability /
// cost / simplicity) that the candidate can fire while drafting, without
// burning the vision-judge quota every iteration.
//
// Final grade still flows through the canvas judge (orchestrator.SubmitCanvas)
// — this UC is purely a draft-review knob.
//
// Layout (lg+): two-column grid
//   [SysDesignCanvas (existing)] · [Rubric run panel + 5-axis verdict]

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ArrowRight, Loader2, Play } from 'lucide-react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { SysDesignCanvas } from './SysDesignCanvas'
import {
  useFinishStageMutation,
  useRunSysDesignMutation,
  type PipelineAttempt,
  type PipelineStage,
  type SysDesignVerdict,
} from '../../lib/queries/mockPipeline'

export function SysDesignStage({
  stage,
  pipelineId,
}: {
  stage: PipelineStage
  pipelineId: string
}) {
  const { t } = useTranslation('wave14')
  const finishStage = useFinishStageMutation(pipelineId)
  const attempts = useMemo(() => stage.attempts ?? [], [stage.attempts])
  // Sysdesign stage typically has one sysdesign_canvas attempt; fall back to
  // first attempt if backend hasn't materialized the new kind yet.
  const canvasAttempt = useMemo(
    () => attempts.find((a) => a.kind === 'sysdesign_canvas') ?? attempts[0],
    [attempts],
  )
  const allJudged = attempts.every((a) => a.ai_verdict !== 'pending')

  if (attempts.length === 0) {
    return (
      <Card variant="default" padding="lg" className="text-sm text-text-secondary">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4" style={{ color: 'var(--red)' }} />
          <span>{t('mock_stage.no_sysdesign_task')}</span>
        </div>
      </Card>
    )
  }
  if (!canvasAttempt) {
    return (
      <Card variant="default" padding="lg" className="text-sm text-text-secondary">
        <AlertCircle className="h-4 w-4 inline mr-2" style={{ color: 'var(--red)' }} />
        {t('mock_stage.no_canvas_attempt')}
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <SysDesignCanvas attempt={canvasAttempt} pipelineId={pipelineId} />

      {/* Rubric drawer — only show pre-submit (after submit the canvas judge has run). */}
      {!canvasAttempt.user_answer_md && <RubricRunner attempt={canvasAttempt} />}

      <div className="flex items-center justify-end gap-3 pt-2">
        {!allJudged && (
          <span className="text-xs text-text-secondary">
            {t('mock_stage.wait_sysdesign_grading')}
          </span>
        )}
        <Button
          variant="primary"
          size="md"
          iconRight={<ArrowRight className="h-4 w-4" />}
          onClick={() => finishStage.mutate(stage.id)}
          disabled={!allJudged || finishStage.isPending}
          loading={finishStage.isPending}
        >
          {t('mock_stage.finish_stage')}
        </Button>
      </div>
    </div>
  )
}

// ── RubricRunner ────────────────────────────────────────────────────────

function RubricRunner({ attempt }: { attempt: PipelineAttempt }) {
  const { t } = useTranslation('wave14')
  const runRubric = useRunSysDesignMutation()
  const [narration, setNarration] = useState<string>('')
  const [verdict, setVerdict] = useState<SysDesignVerdict | null>(null)

  // Pull current scene JSON (best-effort — backend grader is tolerant of
  // empty canvas as long as narration is present).
  const canvasJson = useMemo(() => {
    const scene = attempt.user_excalidraw_scene_json
    if (!scene) return ''
    try {
      return JSON.stringify(scene)
    } catch {
      return ''
    }
  }, [attempt.user_excalidraw_scene_json])

  const handleRun = () => {
    const body = narration.trim()
    if (!body && !canvasJson) return
    runRubric.mutate(
      { attemptId: attempt.id, canvasJson, narrationText: body },
      {
        onSuccess: (data) => setVerdict(data),
      },
    )
  }

  return (
    <Card variant="default" padding="md" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex flex-col">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
            {t('mock_stage.rubric_draft_title')}
          </span>
          <span className="text-xs text-text-secondary">
            {t('mock_stage.rubric_draft_hint')}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<Play className="h-3.5 w-3.5" />}
          onClick={handleRun}
          disabled={runRubric.isPending || (!narration.trim() && !canvasJson)}
          loading={runRubric.isPending}
        >
          Run rubric
        </Button>
      </div>
      <textarea
        value={narration}
        onChange={(e) => setNarration(e.target.value)}
        rows={4}
        disabled={runRubric.isPending}
        placeholder={t('mock_stage.sysdesign_draft_placeholder')}
        className="w-full resize-y border-0 border-b border-solid bg-transparent p-2 text-sm text-text-primary placeholder:text-text-secondary outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-emphasized)] focus:outline-none"
        style={{ borderBottomColor: 'var(--hair-2)' }}
        onFocus={(e) => {
          e.currentTarget.style.borderBottomColor = 'rgb(var(--ink))'
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderBottomColor = 'var(--hair-2)'
        }}
      />
      <RubricVerdictPanel
        verdict={verdict}
        isLoading={runRubric.isPending}
        error={runRubric.error}
      />
    </Card>
  )
}

// ── RubricVerdictPanel ──────────────────────────────────────────────────

function RubricVerdictPanel({
  verdict,
  isLoading,
  error,
}: {
  verdict: SysDesignVerdict | null
  isLoading: boolean
  error: unknown
}) {
  const { t } = useTranslation('wave14')
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t('mock_stage.ai_grading_rubric')}</span>
      </div>
    )
  }
  if (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return (
      <div className="relative flex items-start gap-2 rounded-md border border-border-strong bg-surface-1 p-2 pl-3">
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-md"
          style={{ background: 'var(--red)' }}
        />
        <AlertCircle
          className="h-4 w-4 shrink-0 mt-0.5"
          style={{ color: 'var(--red)' }}
        />
        <span className="text-xs text-text-secondary break-all">{msg}</span>
      </div>
    )
  }
  if (!verdict) {
    return null
  }
  if (verdict.unavailable) {
    return (
      <div className="relative flex items-start gap-2 rounded-md border border-border-strong bg-surface-1 p-2 pl-3">
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-[1.5px] rounded-l-md"
          style={{ background: 'var(--red)' }}
        />
        <AlertCircle
          className="h-4 w-4 shrink-0 mt-0.5"
          style={{ color: 'var(--red)' }}
        />
        <span className="text-xs text-text-secondary">
          {t('mock_stage.grade_unavailable')}
        </span>
      </div>
    )
  }

  const axes = [
    { key: 'availability', label: 'Availability', value: verdict.axes.availability },
    { key: 'consistency', label: 'Consistency', value: verdict.axes.consistency },
    { key: 'scalability', label: 'Scalability', value: verdict.axes.scalability },
    { key: 'cost', label: 'Cost', value: verdict.axes.cost },
    { key: 'simplicity', label: 'Simplicity', value: verdict.axes.simplicity },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {axes.map((a) => (
          <div
            key={a.key}
            className="flex flex-col items-center rounded-md border border-border bg-surface-1 px-2 py-1.5"
          >
            <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-secondary">
              {a.label}
            </span>
            <span className="font-mono text-lg font-bold text-text-primary tabular-nums">
              {a.value}
              <span className="text-[10px] text-text-secondary ml-0.5">/5</span>
            </span>
          </div>
        ))}
      </div>
      <RadarMini axes={verdict.axes} />
      {verdict.narrative_critique && (
        <div className="text-sm text-text-primary whitespace-pre-wrap">
          {verdict.narrative_critique}
        </div>
      )}
      {verdict.missing_concepts.length > 0 && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary mb-1">
            {t('mock_stage.missed')}
          </div>
          <ul className="list-disc list-inside text-xs text-text-secondary space-y-0.5">
            {verdict.missing_concepts.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── RadarMini — 5-axis radar polygon (no fill, B/W only) ────────────────

function RadarMini({ axes }: { axes: SysDesignVerdict['axes'] }) {
  // Axis order (clockwise from 12 o'clock): availability, consistency,
  // scalability, cost, simplicity. 5 axes → angles at 0°, 72°, 144°, 216°, 288°.
  const cx = 100
  const cy = 100
  const r = 80
  const axisLabels = [
    { label: 'Avail', value: axes.availability, angle: -Math.PI / 2 },
    { label: 'Cons', value: axes.consistency, angle: -Math.PI / 2 + (2 * Math.PI) / 5 },
    { label: 'Scal', value: axes.scalability, angle: -Math.PI / 2 + (4 * Math.PI) / 5 },
    { label: 'Cost', value: axes.cost, angle: -Math.PI / 2 + (6 * Math.PI) / 5 },
    { label: 'Simp', value: axes.simplicity, angle: -Math.PI / 2 + (8 * Math.PI) / 5 },
  ]

  // Polygon points — scale value (1..5) onto radius r.
  const points = axisLabels
    .map((a) => {
      const ratio = Math.max(0, Math.min(1, a.value / 5))
      const x = cx + Math.cos(a.angle) * r * ratio
      const y = cy + Math.sin(a.angle) * r * ratio
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  // Grid rings (1..5).
  const rings = [1, 2, 3, 4, 5].map((step) => {
    const rr = (r * step) / 5
    const pts = axisLabels
      .map((a) => {
        const x = cx + Math.cos(a.angle) * rr
        const y = cy + Math.sin(a.angle) * rr
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
    return pts
  })

  return (
    <div className="flex justify-center">
      <svg viewBox="0 0 200 200" className="w-48 h-48" aria-label="5-axis system design rubric radar">
        {/* Grid rings */}
        {rings.map((pts, i) => (
          <polygon
            key={i}
            points={pts}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.5}
            className="text-border"
          />
        ))}
        {/* Axes */}
        {axisLabels.map((a, i) => (
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
        {/* Value polygon */}
        <polygon
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="text-text-primary"
        />
        {/* Axis labels */}
        {axisLabels.map((a, i) => {
          const lx = cx + Math.cos(a.angle) * (r + 14)
          const ly = cy + Math.sin(a.angle) * (r + 14)
          return (
            <text
              key={i}
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-text-secondary"
              style={{ fontFamily: 'monospace', fontSize: 9, textTransform: 'uppercase' }}
            >
              {a.label}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
