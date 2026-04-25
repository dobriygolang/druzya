// MockPipelinePage — cockpit for an active 5-stage mock pipeline.
//
// Route: /mock/pipeline/:pipelineId
//
// Layout (top → bottom):
//   1. Stepper showing all 5 stages, current highlighted
//   2. Stage-specific dispatch panel (placeholder host until each stage's
//      surface lands; for sys_design we lazy-load the Excalidraw chunk)
//   3. "Сдать секцию →" button — POST /complete, then either advance
//      (server returns next stage) or navigate to /mock/pipeline/:id/debrief.
//
// We deliberately keep stage hosts thin in this iteration. The real surfaces
// (VoiceMockPage embed for screening/behavioral, CodeEditor for go_sql/algo,
// Excalidraw for sys_design) will swap in when the orchestrator service is
// merged. Until then we render an inline coming-soon panel inside the
// cockpit shell — the stepper / company header / stage scaffolding is real.

import { lazy, Suspense, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppShellV2 } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import { PipelineStepper } from '../../components/mock/PipelineStepper'
import { AIAssistantChat } from '../../components/mock/AIAssistantChat'
import {
  isComingSoonError,
  MOCK_AI_ASSIST_STORAGE_KEY,
  STAGE_LABEL,
  useCompleteStageMutation,
  useFinishMockPipelineMutation,
  useMockPipelineQuery,
  useStartStageMutation,
  type MockPipelineStage,
  type StageKind,
} from '../../lib/queries/mockPipeline'

// Stages where the AI assistant chat panel is useful. Screening / behavioral
// happen on a voice channel; algo / sys_design / behavioral are text-friendly
// surfaces where typed hints help. (Behavioral is included because the
// candidate may want to refine STAR phrasing in text before recording.)
const AI_ASSIST_STAGES: ReadonlySet<StageKind> = new Set<StageKind>([
  'algo',
  'sys_design',
  'behavioral',
])

function readPipelineAiAssist(pipelineId: string | undefined, fromServer: boolean | undefined): boolean {
  if (typeof fromServer === 'boolean') return fromServer
  if (!pipelineId) return false
  try {
    if (typeof window === 'undefined') return false
    const v = window.localStorage.getItem(`${MOCK_AI_ASSIST_STORAGE_KEY}.${pipelineId}`)
    return v === '1'
  } catch {
    return false
  }
}

// Lazy-loaded Excalidraw chunk — only imported when a sys_design stage
// is actually active, so the main bundle stays slim. The dynamic import
// resolves a placeholder until @excalidraw/excalidraw is installed.
const SysDesignBoard = lazy(() => import('./_lazy/SysDesignBoard'))

const STAGE_HINT: Record<StageKind, string> = {
  screening: 'Голосовая нейрока проверяет cultural fit и базовое CS-знание (15 мин).',
  go_sql: 'Live coding на Go + SQL. Решай в редакторе, объясняй вслух (40 мин).',
  algo: 'Алгоритмическая задача среднего уровня. Optimal solution + complexity (40 мин).',
  sys_design: 'Спроектируй систему на Excalidraw доске. Думай вслух (45 мин).',
  behavioral: 'STAR-истории, голосовая нейрока с devil\'s advocate (20 мин).',
}

function StageHost({ stage }: { stage: MockPipelineStage }) {
  if (stage.kind === 'sys_design') {
    return (
      <Suspense fallback={<div className="text-sm text-text-muted">Загружаю доску…</div>}>
        <SysDesignBoard sessionId={stage.session_id} />
      </Suspense>
    )
  }
  // Until each surface is wired, render an honest "this stage will live
  // here" panel rather than fake the editor / voice UI.
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-1 p-8 text-center">
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted mb-2">
        Stage host · {stage.kind}
      </div>
      <div className="font-display text-base font-bold text-text-primary mb-1">{STAGE_LABEL[stage.kind]}</div>
      <p className="text-sm text-text-secondary max-w-md mx-auto">{STAGE_HINT[stage.kind]}</p>
      {stage.session_id && (
        <div className="mt-3 font-mono text-[10px] text-text-muted">session · {stage.session_id}</div>
      )}
    </div>
  )
}

export default function MockPipelinePage() {
  const { pipelineId } = useParams<{ pipelineId: string }>()
  const navigate = useNavigate()
  const pipeline = useMockPipelineQuery(pipelineId)
  const startStage = useStartStageMutation(pipelineId)
  const completeStage = useCompleteStageMutation(pipelineId)
  const finish = useFinishMockPipelineMutation(pipelineId)

  // Wrap in useMemo so the `?? []` fallback identity is stable; otherwise
  // currentStage's useMemo re-runs every render with a fresh empty array.
  const stages = useMemo(() => pipeline.data?.stages ?? [], [pipeline.data])
  const currentIdx = pipeline.data?.current_stage ?? 0
  const currentStage = useMemo(
    () => stages.find((s) => s.stage_idx === currentIdx) ?? stages[currentIdx],
    [stages, currentIdx],
  )

  if (pipeline.isLoading) {
    return (
      <AppShellV2>
        <div className="px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
          <EmptyState variant="loading" skeletonLayout="card-grid" />
        </div>
      </AppShellV2>
    )
  }

  if (pipeline.isError && isComingSoonError(pipeline.error)) {
    return (
      <AppShellV2>
        <div className="px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
          <EmptyState
            variant="coming-soon"
            title="Multi-stage Mock Interview"
            body="Запускается в Wave-12. Сейчас доступен одиночный mock /voice-mock."
            cta={{ label: 'Открыть /voice-mock', onClick: () => navigate('/voice-mock') }}
            secondaryCta={{ label: 'К выбору компании', onClick: () => navigate('/mock') }}
          />
        </div>
      </AppShellV2>
    )
  }

  if (pipeline.isError) {
    return (
      <AppShellV2>
        <div className="px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
          <EmptyState
            variant="error"
            title="Не удалось загрузить пайплайн"
            cta={{ label: 'Повторить', onClick: () => pipeline.refetch() }}
            secondaryCta={{ label: 'Новый собес', onClick: () => navigate('/mock') }}
          />
        </div>
      </AppShellV2>
    )
  }

  if (!pipeline.data || !currentStage) {
    return (
      <AppShellV2>
        <div className="px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
          <EmptyState variant="404-not-found" title="Пайплайн не найден" />
        </div>
      </AppShellV2>
    )
  }

  const allDone = stages.every((s) => s.status === 'done' || s.status === 'skipped')

  const onComplete = () => {
    if (!currentStage) return
    completeStage.mutate(
      { stage_idx: currentStage.stage_idx, score: 0 },
      {
        onSuccess: (resp) => {
          if (!resp.next_stage) {
            finish.mutate(undefined, {
              onSuccess: () => navigate(`/mock/pipeline/${pipelineId}/debrief`),
            })
          }
        },
      },
    )
  }

  const onStart = () => {
    if (!currentStage || currentStage.status !== 'pending') return
    startStage.mutate(currentStage.stage_idx)
  }

  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <header className="flex flex-col gap-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
            Mock Pipeline · {pipeline.data.id.slice(0, 8)}
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
            {STAGE_LABEL[currentStage.kind]}
          </h1>
        </header>

        <PipelineStepper
          currentStage={currentStage.stage_idx}
          stages={stages.map((s) => s.kind)}
          statuses={stages.map((s) => s.status)}
        />

        {(() => {
          const aiAssist = readPipelineAiAssist(pipelineId, pipeline.data.ai_assist)
          const showChat = aiAssist && AI_ASSIST_STAGES.has(currentStage.kind)
          if (!showChat) {
            return <StageHost stage={currentStage} />
          }
          return (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1">
                <StageHost stage={currentStage} />
              </div>
              <AIAssistantChat />
            </div>
          )
        })()}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => navigate('/mock')}
            className="text-sm text-text-muted hover:text-text-secondary"
          >
            ← Покинуть пайплайн
          </button>
          <div className="flex items-center gap-2">
            {currentStage.status === 'pending' && (
              <button
                type="button"
                onClick={onStart}
                disabled={startStage.isPending}
                className="rounded-md border border-border bg-surface-1 hover:bg-surface-2 text-text-secondary font-medium text-sm px-4 py-2 disabled:opacity-60"
              >
                {startStage.isPending ? 'Запускаю…' : 'Начать секцию'}
              </button>
            )}
            <button
              type="button"
              onClick={onComplete}
              disabled={completeStage.isPending || finish.isPending || currentStage.status === 'pending'}
              className="rounded-md bg-text-primary hover:bg-text-primary/90 text-bg font-medium text-sm px-4 py-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {allDone ? 'Завершить пайплайн' : 'Сдать секцию →'}
            </button>
          </div>
        </div>
      </div>
    </AppShellV2>
  )
}
