// MockPipelineDebrief — terminal page after all 5 stages complete.
//
// Route: /mock/pipeline/:pipelineId/debrief
//
// Renders cumulative scores per stage + overall + CTAs to "Запустить ещё"
// (back to /mock) or "Open weekly" (the existing /weekly report digests
// these into the user's progression).

import { useNavigate, useParams } from 'react-router-dom'
import { AppShellV2 } from '../../components/AppShell'
import { EmptyState } from '../../components/EmptyState'
import {
  isComingSoonError,
  STAGE_LABEL,
  useMockPipelineQuery,
} from '../../lib/queries/mockPipeline'

export default function MockPipelineDebrief() {
  const { pipelineId } = useParams<{ pipelineId: string }>()
  const navigate = useNavigate()
  const pipeline = useMockPipelineQuery(pipelineId)

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
            body="Запускается в Wave-12. Отчёт пайплайна будет доступен после релиза orchestrator-сервиса."
            cta={{ label: 'К выбору компании', onClick: () => navigate('/mock') }}
          />
        </div>
      </AppShellV2>
    )
  }

  if (pipeline.isError || !pipeline.data) {
    return (
      <AppShellV2>
        <div className="px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
          <EmptyState
            variant="error"
            title="Отчёт недоступен"
            cta={{ label: 'Повторить', onClick: () => pipeline.refetch() }}
            secondaryCta={{ label: 'Новый собес', onClick: () => navigate('/mock') }}
          />
        </div>
      </AppShellV2>
    )
  }

  const stages = pipeline.data.stages
  const scored = stages.filter((s) => s.score !== null)
  const overall =
    scored.length > 0
      ? Math.round(scored.reduce((sum, s) => sum + (s.score ?? 0), 0) / scored.length)
      : 0

  return (
    <AppShellV2>
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        <header className="flex flex-col gap-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-success">Debrief</div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-text-primary">
            Пайплайн завершён
          </h1>
          <p className="text-sm text-text-secondary">
            Итоговая оценка: <span className="font-mono text-success font-bold">{overall}</span> / 100
          </p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {stages.map((s) => (
            <div
              key={s.stage_idx}
              className="rounded-lg border border-border bg-surface-1 p-4 flex flex-col gap-2"
            >
              <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                Stage {s.stage_idx + 1}
              </div>
              <div className="font-display font-bold text-text-primary">{STAGE_LABEL[s.kind]}</div>
              <div className="font-mono text-2xl font-bold text-text-primary">
                {s.score !== null ? s.score : '—'}
                <span className="text-xs text-text-muted ml-1">/ 100</span>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{s.status}</div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => navigate('/mock')}
            className="rounded-md bg-text-primary hover:bg-text-primary/90 text-bg font-medium text-sm px-4 py-2"
          >
            Запустить ещё
          </button>
          <button
            type="button"
            onClick={() => navigate('/weekly')}
            className="rounded-md border border-border bg-surface-1 hover:bg-surface-2 text-text-secondary font-medium text-sm px-4 py-2"
          >
            Открыть weekly-отчёт
          </button>
        </div>
      </div>
    </AppShellV2>
  )
}
