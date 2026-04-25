// MockPipelinePage — multi-stage mock interview cockpit (Phase B.2 / ADR-002).
//
// Route: /mock/pipeline/:pipelineId
//
// Layout:
//   ┌────────────────────────────────────────────────────────────┐
//   │  TopBar: druz9 mock · {company} · stage progress dots     │
//   ├──────────┬─────────────────────────────────────────────────┤
//   │ Stages   │ Active stage chat (HR for now; ComingSoon stub │
//   │ sidebar  │ for algo / coding / sysdesign / behavioral)    │
//   │          │                                                 │
//   │ Cancel   │ <QuestionCard> per attempt + "Завершить этап"   │
//   └──────────┴─────────────────────────────────────────────────┘
//
// State machine:
//   - verdict !== 'in_progress'  → redirect to /debrief
//   - currentStage.status === 'pending'  → auto-fire start-next-stage once
//   - stage_kind === 'hr' && in_progress  → render <HRChat>
//   - other kinds                → <ComingSoonStage> with "Пропустить"
//                                  (Phase C/D/E will replace these stubs)

import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import Editor, { type OnMount } from '@monaco-editor/react'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  X,
  XCircle,
} from 'lucide-react'
import { AppShellV2 } from '../../components/AppShell'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { useMockCompaniesQuery } from '../../lib/queries/mockPipeline'
import {
  isComingSoonError,
  STAGE_LABEL,
  useCancelPipelineMutation,
  useFinishStageMutation,
  useMockPipelineQuery,
  useStartNextStageMutation,
  useSubmitAnswerMutation,
  type Pipeline,
  type PipelineAttempt,
  type PipelineStage,
  type StageKind,
} from '../../lib/queries/mockPipeline'
import { SysDesignCanvas } from './SysDesignCanvas'

const STAGE_ORDER_DISPLAY: StageKind[] = ['hr', 'algo', 'coding', 'sysdesign', 'behavioral']

export default function MockPipelinePage() {
  const { pipelineId } = useParams<{ pipelineId: string }>()
  const navigate = useNavigate()
  const pipelineQ = useMockPipelineQuery(pipelineId)
  const startNext = useStartNextStageMutation(pipelineId)
  const cancelPipeline = useCancelPipelineMutation(pipelineId)
  const companiesQ = useMockCompaniesQuery()

  // Track whether we already fired start-next-stage for the current ordinal
  // so React StrictMode double-mount doesn't cause two POSTs in dev.
  const startedForOrdinalRef = useRef<number | null>(null)

  const pipeline = pipelineQ.data
  const currentStage = useMemo<PipelineStage | undefined>(() => {
    if (!pipeline) return undefined
    return (
      pipeline.stages.find((s) => s.ordinal === pipeline.current_stage_idx) ??
      pipeline.stages[pipeline.current_stage_idx]
    )
  }, [pipeline])

  // Auto-start the current stage if it's still pending. Fire-and-forget;
  // the mutation's onSuccess writes the new pipeline to the cache so the
  // next render sees status='in_progress' with materialized attempts.
  useEffect(() => {
    if (!pipeline || !currentStage) return
    if (pipeline.verdict !== 'in_progress') return
    if (currentStage.status !== 'pending') return
    if (startedForOrdinalRef.current === currentStage.ordinal) return
    if (startNext.isPending) return
    startedForOrdinalRef.current = currentStage.ordinal
    startNext.mutate()
  }, [pipeline, currentStage, startNext])

  // ── loading / error ──────────────────────────────────────────────────

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

  if (pipelineQ.isError) {
    return (
      <AppShellV2>
        <div className="px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
          <EmptyState
            variant="error"
            title="Не удалось загрузить пайплайн"
            cta={{ label: 'Повторить', onClick: () => pipelineQ.refetch() }}
            secondaryCta={{ label: 'Новый собес', onClick: () => navigate('/mock') }}
          />
        </div>
      </AppShellV2>
    )
  }

  if (!pipeline) {
    return (
      <AppShellV2>
        <div className="px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
          <EmptyState variant="404-not-found" title="Пайплайн не найден" />
        </div>
      </AppShellV2>
    )
  }

  // Pipeline finished / cancelled → redirect to debrief.
  if (pipeline.verdict !== 'in_progress') {
    return <Navigate to={`/mock/pipeline/${pipeline.id}/debrief`} replace />
  }

  if (!currentStage) {
    return (
      <AppShellV2>
        <div className="px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
          <EmptyState
            variant="error"
            title="Стадия не найдена"
            body="Пайплайн в неконсистентном состоянии."
            cta={{ label: 'Новый собес', onClick: () => navigate('/mock') }}
          />
        </div>
      </AppShellV2>
    )
  }

  const company = companiesQ.data?.find((c) => c.id === pipeline.company_id) ?? null
  const companyLabel = company?.name ?? (pipeline.company_id ? '…' : 'Random')

  const handleCancel = () => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm('Прервать собес? Прогресс будет потерян.')
      if (!ok) return
    }
    cancelPipeline.mutate(undefined, {
      onSuccess: () => navigate(`/mock/pipeline/${pipeline.id}/debrief`),
    })
  }

  return (
    <AppShellV2>
      <div className="flex flex-col gap-4 px-4 py-6 sm:px-8 lg:px-20 lg:py-8">
        {/* Top bar */}
        <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-0.5">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
              druz9 mock
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-text-primary">
              {companyLabel}
            </h1>
          </div>
          <StageProgressDots pipeline={pipeline} />
        </header>

        {/* Two-column body */}
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 lg:gap-6">
          <StagesSidebar pipeline={pipeline} onCancel={handleCancel} cancelling={cancelPipeline.isPending} />

          <main className="min-w-0 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
                {STAGE_LABEL[currentStage.stage_kind]} · {currentStage.status === 'in_progress' ? 'in_progress' : currentStage.status}
              </span>
            </div>

            {currentStage.status === 'pending' || startNext.isPending ? (
              <StageLoadingSkeleton kind={currentStage.stage_kind} />
            ) : startNext.isError ? (
              <StageStartError
                error={startNext.error}
                onRetry={() => {
                  startedForOrdinalRef.current = null
                  startNext.reset()
                }}
              />
            ) : currentStage.stage_kind === 'hr' ||
              currentStage.stage_kind === 'algo' ||
              currentStage.stage_kind === 'coding' ||
              currentStage.stage_kind === 'sysdesign' ||
              currentStage.stage_kind === 'behavioral' ? (
              <StageChat
                key={currentStage.id}
                stage={currentStage}
                pipelineId={pipeline.id}
              />
            ) : (
              <ComingSoonStage
                kind={currentStage.stage_kind}
                stageId={currentStage.id}
                pipelineId={pipeline.id}
              />
            )}
          </main>
        </div>
      </div>
    </AppShellV2>
  )
}

// ── StageProgressDots — 5 dots, current highlighted ─────────────────────

function StageProgressDots({ pipeline }: { pipeline: Pipeline }) {
  // Render in canonical kind-order so the row stays stable regardless of
  // server-side ordinal numbering oddities.
  const byKind = new Map<StageKind, PipelineStage>()
  for (const s of pipeline.stages) byKind.set(s.stage_kind, s)
  return (
    <div className="flex items-center gap-1.5" aria-label="Прогресс этапов">
      {STAGE_ORDER_DISPLAY.map((kind) => {
        const s = byKind.get(kind)
        const isCurrent = s && s.ordinal === pipeline.current_stage_idx
        const cls = stageDotClass(s?.status, s?.verdict, !!isCurrent)
        return (
          <span
            key={kind}
            title={STAGE_LABEL[kind]}
            className={[
              'h-2.5 w-2.5 rounded-full',
              cls,
              isCurrent ? 'ring-2 ring-text-primary/40' : '',
            ].join(' ')}
          />
        )
      })}
    </div>
  )
}

function stageDotClass(
  status: PipelineStage['status'] | undefined,
  verdict: PipelineStage['verdict'] | undefined,
  isCurrent: boolean,
): string {
  if (!status) return 'bg-surface-2'
  if (status === 'finished') {
    if (verdict === 'pass') return 'bg-success'
    if (verdict === 'fail') return 'bg-danger'
    if (verdict === 'borderline') return 'bg-warn'
    return 'bg-text-secondary'
  }
  if (status === 'in_progress') return 'bg-text-primary animate-pulse'
  if (status === 'skipped') return 'bg-surface-2 opacity-60'
  // pending
  return isCurrent ? 'bg-text-primary/60' : 'bg-surface-2'
}

// ── StagesSidebar ───────────────────────────────────────────────────────

function StagesSidebar({
  pipeline,
  onCancel,
  cancelling,
}: {
  pipeline: Pipeline
  onCancel: () => void
  cancelling: boolean
}) {
  const sorted = [...pipeline.stages].sort((a, b) => a.ordinal - b.ordinal)
  return (
    <aside className="flex flex-col gap-2">
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary px-1">
        Этапы
      </div>
      <ul className="flex flex-col gap-1.5">
        {sorted.map((s) => {
          const isCurrent = s.ordinal === pipeline.current_stage_idx
          return (
            <li key={s.id}>
              <div
                className={[
                  'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                  isCurrent
                    ? 'border-border-strong bg-surface-2 text-text-primary'
                    : 'border-border bg-surface-1 text-text-secondary',
                ].join(' ')}
              >
                <span className="truncate font-medium">{STAGE_LABEL[s.stage_kind]}</span>
                <StageStatusDot status={s.status} verdict={s.verdict} isCurrent={isCurrent} />
              </div>
            </li>
          )
        })}
      </ul>
      <div className="mt-2">
        <Button
          variant="ghost"
          size="sm"
          icon={<X className="h-3.5 w-3.5" />}
          onClick={onCancel}
          disabled={cancelling}
          loading={cancelling}
          className="w-full"
        >
          Прервать собес
        </Button>
      </div>
    </aside>
  )
}

function StageStatusDot({
  status,
  verdict,
  isCurrent,
}: {
  status: PipelineStage['status']
  verdict: PipelineStage['verdict']
  isCurrent: boolean
}) {
  const cls = stageDotClass(status, verdict, isCurrent)
  return <span className={['h-2 w-2 rounded-full shrink-0', cls].join(' ')} aria-hidden />
}

// ── StageLoadingSkeleton ────────────────────────────────────────────────

function StageLoadingSkeleton({ kind }: { kind: StageKind }) {
  return (
    <Card variant="default" padding="lg" className="flex items-center gap-3">
      <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
      <span className="text-sm text-text-secondary">
        Поднимаю этап «{STAGE_LABEL[kind]}»…
      </span>
    </Card>
  )
}

// ── StageChat — kind-agnostic; iterates attempts and dispatches per kind ──

function StageChat({ stage, pipelineId }: { stage: PipelineStage; pipelineId: string }) {
  const finishStage = useFinishStageMutation(pipelineId)

  const allJudged = stage.attempts.every((a) => a.ai_verdict !== 'pending')
  const noAttempts = stage.attempts.length === 0

  if (noAttempts) {
    const isCodeLike = stage.stage_kind === 'algo' || stage.stage_kind === 'coding'
    return (
      <Card variant="default" padding="lg" className="text-sm text-text-secondary">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-warn" />
          <span>
            {isCodeLike
              ? 'Для этого этапа ещё не настроены задачи в пуле компании. Попроси админа добавить mock_task через /admin → Mock Tasks.'
              : 'Для этого этапа ещё не настроены вопросы. Попроси админа залить default_questions.'}
          </span>
        </div>
      </Card>
    )
  }

  const handleFinish = () => {
    finishStage.mutate(stage.id)
  }

  return (
    <div className="flex flex-col gap-4">
      {stage.attempts.map((a, idx) => (
        <QuestionCard
          key={a.id}
          attempt={a}
          pipelineId={pipelineId}
          ordinal={idx + 1}
          attempts={stage.attempts}
        />
      ))}
      <div className="flex items-center justify-end gap-3 pt-2">
        {!allJudged && (
          <span className="text-xs text-text-secondary">
            Дождись AI-оценки всех ответов
          </span>
        )}
        <Button
          variant="primary"
          size="md"
          iconRight={<ArrowRight className="h-4 w-4" />}
          onClick={handleFinish}
          disabled={!allJudged || finishStage.isPending}
          loading={finishStage.isPending}
        >
          Завершить этап
        </Button>
      </div>
    </div>
  )
}

// ── QuestionCard ────────────────────────────────────────────────────────

type CodeLanguage = 'go' | 'python' | 'sql' | 'javascript' | 'typescript'

const CODE_LANGUAGES: { value: CodeLanguage; label: string; monaco: string }[] = [
  { value: 'go', label: 'Go', monaco: 'go' },
  { value: 'python', label: 'Python', monaco: 'python' },
  { value: 'sql', label: 'SQL', monaco: 'sql' },
  { value: 'javascript', label: 'JavaScript', monaco: 'javascript' },
  { value: 'typescript', label: 'TypeScript', monaco: 'typescript' },
]

// TODO(backend): ASK BACKEND TO SURFACE `task_language` IN AttemptView DTO
// (mock_tasks.language). Until then we best-effort detect from question_body.
function detectLanguageFromBrief(brief: string | null | undefined): CodeLanguage {
  if (!brief) return 'python'
  const lower = brief.toLowerCase()
  if (/\bgo\b|\bgolang\b/.test(lower)) return 'go'
  if (/\bpython\b/.test(lower)) return 'python'
  if (/\bsql\b/.test(lower)) return 'sql'
  if (/\btypescript\b/.test(lower)) return 'typescript'
  if (/\bjavascript\b|\bjs\b/.test(lower)) return 'javascript'
  return 'python'
}

function QuestionCard({
  attempt,
  pipelineId,
  ordinal,
  attempts,
}: {
  attempt: PipelineAttempt
  pipelineId: string
  ordinal: number
  attempts: PipelineAttempt[]
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const previousVerdict = useRef<PipelineAttempt['ai_verdict']>(attempt.ai_verdict)

  const isAnswered = !!(attempt.user_answer_md && attempt.user_answer_md.length > 0)
  const isJudging = isAnswered && attempt.ai_verdict === 'pending'
  const isJudged = isAnswered && attempt.ai_verdict !== 'pending'

  // Auto-scroll: when this attempt transitions to judged, gently bring the
  // verdict panel into view (or the next unanswered question if any).
  useEffect(() => {
    const prev = previousVerdict.current
    previousVerdict.current = attempt.ai_verdict
    if (prev === 'pending' && attempt.ai_verdict !== 'pending') {
      const nextUnanswered = attempts.find(
        (a) => !a.user_answer_md && a.id !== attempt.id,
      )
      if (nextUnanswered) {
        const el = document.getElementById(`question-${nextUnanswered.id}`)
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      } else {
        cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }, [attempt.ai_verdict, attempt.id, attempts])

  // ── sysdesign_canvas — Phase D.2 full canvas surface ──
  if (attempt.kind === 'sysdesign_canvas') {
    return (
      <div id={`question-${attempt.id}`} ref={cardRef}>
        <SysDesignCanvas attempt={attempt} pipelineId={pipelineId} />
      </div>
    )
  }

  // ── voice_answer (Phase E) → still placeholder ──
  if (attempt.kind === 'voice_answer') {
    return (
      <Card
        variant="default"
        padding="lg"
        className="flex flex-col gap-2"
        id={`question-${attempt.id}`}
        ref={cardRef as React.RefObject<HTMLDivElement>}
      >
        <ComingSoonAttempt attempt={attempt} ordinal={ordinal} />
      </Card>
    )
  }

  return (
    <Card
      variant="default"
      padding="lg"
      className="flex flex-col gap-4"
      id={`question-${attempt.id}`}
      ref={cardRef as React.RefObject<HTMLDivElement>}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
          {attempt.kind === 'task_solve' ? `T${ordinal}` : `Q${ordinal}`}
        </span>
        {attempt.kind !== 'task_solve' && (
          <h3 className="font-display text-base font-bold text-text-primary whitespace-pre-wrap">
            {attempt.question_body ?? '—'}
          </h3>
        )}
      </div>

      {attempt.kind === 'task_solve' && (
        <TaskBrief content={attempt.question_body ?? ''} criteria={attempt.reference_criteria} />
      )}

      {!isAnswered && attempt.kind === 'task_solve' && (
        <CodeAnswerEditor
          attemptId={attempt.id}
          pipelineId={pipelineId}
          briefForDetection={attempt.question_body ?? ''}
          taskLanguage={attempt.task_language ?? null}
        />
      )}

      {!isAnswered && attempt.kind === 'question_answer' && (
        <TextAnswerForm attemptId={attempt.id} pipelineId={pipelineId} />
      )}

      {isAnswered && (
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border bg-surface-1 p-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-1">
              Твой ответ
            </div>
            <div className="text-sm text-text-primary whitespace-pre-wrap font-mono">
              {attempt.user_answer_md}
            </div>
          </div>

          {isJudging && (
            <div className="flex items-center gap-2 rounded-lg border border-border-strong bg-surface-2 p-3">
              <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
              <span className="text-sm text-text-secondary">AI оценивает…</span>
            </div>
          )}

          {isJudged && <VerdictPanel attempt={attempt} />}
        </div>
      )}
    </Card>
  )
}

// ── TaskBrief ───────────────────────────────────────────────────────────

function TaskBrief({ content, criteria }: { content: string; criteria: PipelineAttempt['reference_criteria'] }) {
  const mustMention = criteria?.must_mention ?? []
  const mentionsComplexity = mustMention.some((m) => m.includes('O('))
  return (
    <div className="flex flex-col gap-3">
      {mentionsComplexity && (
        <div className="self-start rounded-full border border-border-strong bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary">
          Алгоритм · O(n) target
        </div>
      )}
      <div className="rounded-lg border border-border-strong bg-surface-2 p-5">
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-2">
          Задача
        </div>
        <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-text-primary">
          {content || '—'}
        </div>
      </div>
    </div>
  )
}

// ── TextAnswerForm — original HR textarea path, extracted ────────────────

function TextAnswerForm({ attemptId, pipelineId }: { attemptId: string; pipelineId: string }) {
  const submit = useSubmitAnswerMutation(pipelineId)
  const [draft, setDraft] = useState<string>('')

  const handleSubmit = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    submit.mutate({ attemptId, userAnswer: trimmed })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={submit.isPending}
        rows={6}
        placeholder="Твой ответ…"
        className="w-full resize-y rounded-lg border border-border-strong bg-surface-1 p-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-text-primary/40"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-text-secondary">
          {draft.length} символов · ⌘+Enter — отправить
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={submit.isPending || draft.trim().length === 0}
          loading={submit.isPending}
        >
          Отправить
        </Button>
      </div>
    </div>
  )
}

// ── CodeAnswerEditor — Monaco for task_solve attempts ────────────────────

function CodeAnswerEditor({
  attemptId,
  pipelineId,
  briefForDetection,
  taskLanguage,
}: {
  attemptId: string
  pipelineId: string
  briefForDetection: string
  taskLanguage: string | null
}) {
  const submit = useSubmitAnswerMutation(pipelineId)
  const [code, setCode] = useState<string>('')
  const [language, setLanguage] = useState<CodeLanguage>(() => {
    // Prefer the real task.language from backend (Phase D.2). Fall back to
    // the brief-text heuristic if the field is missing/unrecognized.
    const known: CodeLanguage[] = ['go', 'python', 'sql', 'javascript', 'typescript']
    if (taskLanguage && (known as string[]).includes(taskLanguage)) {
      return taskLanguage as CodeLanguage
    }
    return detectLanguageFromBrief(briefForDetection)
  })

  const handleSubmit = () => {
    const body = code.trim()
    if (!body) return
    const fenced = '```' + language + '\n' + code + '\n```'
    submit.mutate({ attemptId, userAnswer: fenced })
  }

  // Stable ref so Monaco's keybinding sees the latest handler.
  const handleSubmitRef = useRef(handleSubmit)
  handleSubmitRef.current = handleSubmit

  const handleMount: OnMount = (editor, monaco) => {
    // Cmd+Enter / Ctrl+Enter inside Monaco submits.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handleSubmitRef.current()
    })
  }

  const monacoLang = CODE_LANGUAGES.find((l) => l.value === language)?.monaco ?? 'python'
  const lineCount = code.length === 0 ? 0 : code.split('\n').length
  const charCount = code.length

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-lg border border-border-strong bg-surface-2">
        <Editor
          height="400px"
          language={monacoLang}
          value={code}
          onChange={(v) => setCode(v ?? '')}
          onMount={handleMount}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            fontSize: 13,
            automaticLayout: true,
            tabSize: 2,
          }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <LanguageSelect value={language} onChange={setLanguage} disabled={submit.isPending} />
          <span className="font-mono text-[10px] text-text-secondary">
            {lineCount} строк · {charCount} символов · ⌘+Enter — отправить
          </span>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={submit.isPending || code.trim().length === 0}
          loading={submit.isPending}
        >
          Отправить решение
        </Button>
      </div>
    </div>
  )
}

// ── LanguageSelect ──────────────────────────────────────────────────────

function LanguageSelect({
  value,
  onChange,
  disabled,
}: {
  value: CodeLanguage
  onChange: (v: CodeLanguage) => void
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CodeLanguage)}
      disabled={disabled}
      className="rounded-lg border border-border-strong bg-surface-1 px-2 py-1 font-mono text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-text-primary/40 disabled:opacity-60"
    >
      {CODE_LANGUAGES.map((l) => (
        <option key={l.value} value={l.value}>
          {l.label}
        </option>
      ))}
    </select>
  )
}

// ── ComingSoonAttempt — placeholder for sysdesign_canvas / voice_answer ──

function ComingSoonAttempt({ attempt, ordinal }: { attempt: PipelineAttempt; ordinal: number }) {
  const phaseLabel: Record<string, string> = {
    sysdesign_canvas: 'Phase D',
    voice_answer: 'Phase E',
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
          A{ordinal}
        </span>
        <h3 className="font-display text-base font-bold text-text-primary">
          {attempt.kind === 'sysdesign_canvas' ? 'System Design canvas' : 'Voice answer'}
        </h3>
      </div>
      <p className="text-sm text-text-secondary">
        {phaseLabel[attempt.kind] ?? 'Soon'} — этот формат ответа ещё не подключён в UI.
      </p>
    </div>
  )
}

// ── VerdictPanel ────────────────────────────────────────────────────────

function VerdictPanel({ attempt }: { attempt: PipelineAttempt }) {
  const v = attempt.ai_verdict
  const score = attempt.ai_score ?? 0
  const cls =
    v === 'pass'
      ? 'border-success bg-success/10 text-success'
      : v === 'fail'
        ? 'border-danger bg-danger/10 text-danger'
        : v === 'borderline'
          ? 'border-warn bg-warn/10 text-warn'
          : 'border-border bg-surface-1 text-text-secondary'
  const label = v === 'pass' ? 'PASS' : v === 'fail' ? 'FAIL' : v === 'borderline' ? 'BORDERLINE' : v
  const Icon = v === 'pass' ? CheckCircle2 : v === 'fail' ? XCircle : AlertCircle

  return (
    <div className="flex flex-col gap-3">
      <div className={['flex items-center gap-2 rounded-lg border px-3 py-2', cls].join(' ')}>
        <Icon className="h-4 w-4" />
        <span className="font-display text-sm font-bold uppercase">{label}</span>
        <span className="font-mono text-sm">· {score}/100</span>
        {attempt.ai_water_score !== null && attempt.ai_water_score > 30 && (
          <span className="font-mono text-[10px] ml-auto opacity-70">
            water {attempt.ai_water_score}%
          </span>
        )}
      </div>

      {attempt.ai_feedback_md && (
        <Card variant="default" padding="md" className="font-sans">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-1">
            Feedback
          </div>
          <div className="text-sm text-text-primary whitespace-pre-wrap">
            {attempt.ai_feedback_md}
          </div>
        </Card>
      )}

      {attempt.ai_missing_points.length > 0 && (
        <div className="rounded-lg border border-border bg-surface-1 p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary mb-1">
            Что упустил
          </div>
          <ul className="list-disc list-inside text-sm text-text-secondary space-y-0.5">
            {attempt.ai_missing_points.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── StageStartError — surface start-next-stage failure (e.g. no task) ───

function StageStartError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const msg = error instanceof Error ? error.message : String(error)
  const isNoTask = /no\s*task/i.test(msg)
  return (
    <Card variant="default" padding="lg" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-warn" />
        <span className="font-display text-sm font-bold text-text-primary">
          {isNoTask ? 'Нет задач для этого этапа' : 'Не удалось поднять этап'}
        </span>
      </div>
      <p className="text-sm text-text-secondary whitespace-pre-wrap">
        {isNoTask
          ? 'Для этого этапа ещё не настроены задачи в пуле компании. Попроси админа добавить mock_task с stage_kind=\'algo\' через /admin → Mock Tasks.'
          : msg}
      </p>
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Повторить
        </Button>
      </div>
    </Card>
  )
}

// ── ComingSoonStage ─────────────────────────────────────────────────────

function ComingSoonStage({
  kind,
  stageId,
  pipelineId,
}: {
  kind: StageKind
  stageId: string
  pipelineId: string
}) {
  const finishStage = useFinishStageMutation(pipelineId)
  const phaseLabel: Record<StageKind, string> = {
    hr: 'Phase B',
    algo: 'Phase C',
    coding: 'Phase D',
    sysdesign: 'Phase E',
    behavioral: 'Phase E',
  }
  return (
    <Card variant="default" padding="lg" className="flex flex-col gap-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-secondary">
        {STAGE_LABEL[kind]} · stub
      </div>
      <h2 className="font-display text-lg font-bold text-text-primary">
        Этот этап скоро будет
      </h2>
      <p className="text-sm text-text-secondary">
        {phaseLabel[kind]} ships this stage. Сейчас этап-заглушка — можно пропустить и идти дальше.
      </p>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="md"
          iconRight={<ArrowRight className="h-4 w-4" />}
          onClick={() => finishStage.mutate(stageId)}
          loading={finishStage.isPending}
          disabled={finishStage.isPending}
        >
          Пропустить
        </Button>
      </div>
    </Card>
  )
}
