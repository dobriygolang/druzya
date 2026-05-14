// AlgoStage — R2 dedicated surface для Algo стадии mock pipeline'а.
//
// Layout (lg+): three-column grid
//   ┌────────────┬──────────────────────┬────────────────────┐
//   │ Problem    │ Monaco editor        │ Test cases /       │
//   │ prompt     │ + language selector  │ verdict panel      │
//   │ (read-only)│                      │ + Run + Submit     │
//   └────────────┴──────────────────────┴────────────────────┘
// Narrow viewports collapse to single column (problem → editor → tests).
//
// Lifecycle:
//   - One task_solve attempt + N question_answer follow-ups.
//   - This component renders ONLY the task_solve attempt's editor surface.
//     Follow-up question_answer attempts (если есть) рендерятся таким же
//     <QuestionCard> механизмом снизу через StageChat-fallback path —
//     это сохраняет HR-style text-answer + AI verdict без перекодирования.
//   - "Run tests" hits POST /mock/attempts/{id}/run-algo (no persist).
//   - "Submit" finalises via SubmitAnswer (existing flow). The verdict
//     panel switches to LLM + Judge0 combined output.
//
// B/W design: passed tests use text-success (ink/dark), failed use the
// red-stripe accent. Никаких colourful chips на verdicts.

import { useMemo, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import {
  useFinishStageMutation,
  useRunAlgoMutation,
  useSubmitAnswerMutation,
  type AlgoTestResult,
  type AlgoVerdict,
  type PipelineAttempt,
  type PipelineStage,
} from '../../lib/queries/mockPipeline'

// Languages the Judge0 sandbox supports (mirror backend/shared/enums/language.go).
// SQL отсутствует — Judge0 не выполняет SQL.
type AlgoLanguage = 'go' | 'python' | 'javascript' | 'typescript' | 'cpp' | 'java'

const ALGO_LANGUAGES: { value: AlgoLanguage; label: string; monaco: string }[] = [
  { value: 'go', label: 'Go', monaco: 'go' },
  { value: 'python', label: 'Python', monaco: 'python' },
  { value: 'javascript', label: 'JavaScript', monaco: 'javascript' },
  { value: 'typescript', label: 'TypeScript', monaco: 'typescript' },
  { value: 'cpp', label: 'C++', monaco: 'cpp' },
  { value: 'java', label: 'Java', monaco: 'java' },
]

// Backend currently maps go|python|javascript|typescript directly. cpp/java
// показываем в UI чтобы кандидат не путался при просмотре задачи на C++,
// но run-algo для них вернёт sandbox_unavailable (стандартный fallback path
// в backend), плюс мы предупреждаем кандидата в подсказке.
const BACKEND_SUPPORTED = new Set<AlgoLanguage>(['go', 'python', 'javascript', 'typescript'])

function detectAlgoLanguage(taskLang: string | null | undefined, brief: string | null | undefined): AlgoLanguage {
  const known: AlgoLanguage[] = ['go', 'python', 'javascript', 'typescript', 'cpp', 'java']
  if (taskLang && known.includes(taskLang as AlgoLanguage)) {
    return taskLang as AlgoLanguage
  }
  const lower = (brief ?? '').toLowerCase()
  if (/\bgolang\b|\bgo\b/.test(lower)) return 'go'
  if (/\bpython\b/.test(lower)) return 'python'
  if (/\btypescript\b/.test(lower)) return 'typescript'
  if (/\bjavascript\b|\bjs\b/.test(lower)) return 'javascript'
  return 'python'
}

// ── AlgoStage ───────────────────────────────────────────────────────────

export function AlgoStage({
  stage,
  pipelineId,
}: {
  stage: PipelineStage
  pipelineId: string
}) {
  const { t } = useTranslation('pages')
  const finishStage = useFinishStageMutation(pipelineId)
  const attempts = useMemo(() => stage.attempts ?? [], [stage.attempts])

  // Главная попытка стадии — task_solve. Остальные attempts (если есть) —
  // follow-up question_answer; рендерим их под основным редактором через
  // тот же текст-форм UI который использует HR.
  const solveAttempt = useMemo(
    () => attempts.find((a) => a.kind === 'task_solve'),
    [attempts],
  )
  const followUps = useMemo(
    () => attempts.filter((a) => a.kind !== 'task_solve'),
    [attempts],
  )

  const allJudged = attempts.every((a) => a.ai_verdict !== 'pending')
  const noSolve = !solveAttempt
  const noAttempts = attempts.length === 0

  if (noAttempts) {
    return (
      <Card variant="default" padding="lg" className="text-sm text-text-secondary">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4" style={{ color: 'var(--red)' }} />
          <span>{t('algo_stage.no_tasks')}</span>
        </div>
      </Card>
    )
  }
  if (noSolve) {
    return (
      <Card variant="default" padding="lg" className="text-sm text-text-secondary">
        <AlertCircle className="h-4 w-4 inline mr-2" style={{ color: 'var(--red)' }} />
        {t('algo_stage.no_task_solve')}
      </Card>
    )
  }

  const handleFinish = () => {
    finishStage.mutate(stage.id)
  }

  return (
    <div className="flex flex-col gap-4">
      <AlgoTaskPanel attempt={solveAttempt!} pipelineId={pipelineId} />

      {followUps.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
            {t('algo_stage.followup_header')}
          </div>
          {followUps.map((a, idx) => (
            <FollowUpQuestion
              key={a.id}
              attempt={a}
              pipelineId={pipelineId}
              ordinal={idx + 1}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        {!allJudged && (
          <span className="text-xs text-text-secondary">
            {t('algo_stage.wait_judging')}
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
          {t('algo_stage.finish_stage')}
        </Button>
      </div>
    </div>
  )
}

// ── AlgoTaskPanel — three-column grid: problem | editor | tests ─────────

function AlgoTaskPanel({
  attempt,
  pipelineId,
}: {
  attempt: PipelineAttempt
  pipelineId: string
}) {
  const { t } = useTranslation('pages')
  const isAnswered = !!(attempt.user_answer_md && attempt.user_answer_md.length > 0)
  const isJudging = isAnswered && attempt.ai_verdict === 'pending'
  const isJudged = isAnswered && attempt.ai_verdict !== 'pending'

  const submit = useSubmitAnswerMutation(pipelineId)
  const runAlgo = useRunAlgoMutation()
  const [code, setCode] = useState<string>('')
  const [language, setLanguage] = useState<AlgoLanguage>(() =>
    detectAlgoLanguage(attempt.task_language ?? null, attempt.question_body ?? ''),
  )
  const [verdict, setVerdict] = useState<AlgoVerdict | null>(null)

  const handleRun = () => {
    const body = code.trim()
    if (!body) return
    runAlgo.mutate(
      { attemptId: attempt.id, code: body, language },
      {
        onSuccess: (data) => setVerdict(data),
      },
    )
  }

  const handleSubmit = () => {
    const body = code.trim()
    if (!body) return
    const fenced = '```' + language + '\n' + code + '\n```'
    submit.mutate({ attemptId: attempt.id, userAnswer: fenced })
  }

  // Stable refs so Monaco's keybindings see the latest handler.
  const handleRunRef = useRef(handleRun)
  handleRunRef.current = handleRun
  const handleSubmitRef = useRef(handleSubmit)
  handleSubmitRef.current = handleSubmit

  const handleMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handleRunRef.current()
    })
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      () => handleSubmitRef.current(),
    )
  }

  const monacoLang = ALGO_LANGUAGES.find((l) => l.value === language)?.monaco ?? 'python'
  const backendOK = BACKEND_SUPPORTED.has(language)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-3 lg:gap-4">
      {/* Column 1 — problem prompt */}
      <ProblemPanel attempt={attempt} />

      {/* Column 2 — editor */}
      {!isAnswered ? (
        <Card variant="default" padding="none" className="flex flex-col overflow-hidden min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <AlgoLanguageSelect
              value={language}
              onChange={setLanguage}
              disabled={runAlgo.isPending || submit.isPending}
            />
            <span className="font-mono text-[10px] text-text-secondary">
              {t('algo_stage.lines_chars', { lines: code.split('\n').length, chars: code.length })}
            </span>
          </div>
          <div className="flex-1 min-h-[360px]">
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
            <span className="font-mono text-[10px] text-text-secondary">
              ⌘+Enter · Run · ⌘+Shift+Enter · Submit
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={<Play className="h-3.5 w-3.5" />}
                onClick={handleRun}
                disabled={runAlgo.isPending || submit.isPending || code.trim().length === 0}
                loading={runAlgo.isPending}
              >
                Run tests
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSubmit}
                disabled={runAlgo.isPending || submit.isPending || code.trim().length === 0}
                loading={submit.isPending}
              >
                Submit
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card variant="default" padding="lg" className="flex flex-col gap-3 min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
            {t('algo_stage.submitted')}
          </div>
          <pre className="text-sm text-text-primary whitespace-pre-wrap font-mono overflow-x-auto">
            {attempt.user_answer_md}
          </pre>
        </Card>
      )}

      {/* Column 3 — verdict / tests panel */}
      <div className="flex flex-col gap-3 min-w-0">
        {!isAnswered && (
          <RunVerdictPanel
            verdict={verdict}
            isLoading={runAlgo.isPending}
            error={runAlgo.error}
            backendSupported={backendOK}
          />
        )}
        {isJudging && (
          <Card variant="default" padding="md" className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
            <span className="text-sm text-text-secondary">{t('algo_stage.judging')}</span>
          </Card>
        )}
        {isJudged && <SubmitVerdictPanel attempt={attempt} />}
      </div>
    </div>
  )
}

// ── ProblemPanel ────────────────────────────────────────────────────────

function ProblemPanel({ attempt }: { attempt: PipelineAttempt }) {
  const { t } = useTranslation('pages')
  const mustMention = attempt.reference_criteria?.must_mention ?? []
  const niceToHave = attempt.reference_criteria?.nice_to_have ?? []
  const complexityHint = mustMention.find((m) => /O\(/.test(m))

  return (
    <Card variant="default" padding="lg" className="flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
          {t('algo_stage.problem')}
        </span>
        {complexityHint && (
          <span className="rounded-full border border-border-strong bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
            target: {complexityHint}
          </span>
        )}
      </div>
      <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-text-primary">
        {attempt.question_body ?? '—'}
      </div>
      {mustMention.length > 0 && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary mb-1">
            Must mention
          </div>
          <ul className="list-disc list-inside text-xs text-text-secondary space-y-0.5">
            {mustMention.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {niceToHave.length > 0 && (
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary mb-1">
            Nice to have
          </div>
          <ul className="list-disc list-inside text-xs text-text-secondary space-y-0.5">
            {niceToHave.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

// ── RunVerdictPanel — shown after «Run tests» (pre-submit, dry-run) ─────

function RunVerdictPanel({
  verdict,
  isLoading,
  error,
  backendSupported,
}: {
  verdict: AlgoVerdict | null
  isLoading: boolean
  error: unknown
  backendSupported: boolean
}) {
  const { t } = useTranslation('pages')
  if (isLoading) {
    return (
      <Card variant="default" padding="md" className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
        <span className="text-sm text-text-secondary">{t('algo_stage.sandbox_running')}</span>
      </Card>
    )
  }
  if (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return (
      <Card variant="default" padding="md" className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: 'var(--red)' }} />
        <div className="flex flex-col gap-1">
          <span className="font-display text-sm font-bold text-text-primary">
            Run tests failed
          </span>
          <span className="text-xs text-text-secondary break-all">{msg}</span>
        </div>
      </Card>
    )
  }
  if (!verdict) {
    return (
      <Card variant="default" padding="md" className="flex flex-col gap-2 text-sm text-text-secondary">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em]">
          {t('algo_stage.tests_not_run')}
        </div>
        <p className="text-xs">
          {t('algo_stage.tests_hint_pre')}{' '}
          <span className="font-mono">Run tests</span>{' '}
          {t('algo_stage.tests_hint_mid')}{' '}
          <span className="font-mono">Submit</span>
          {t('algo_stage.tests_hint_post')}
        </p>
        {!backendSupported && (
          <p className="text-xs" style={{ color: 'var(--red)' }}>
            {t('algo_stage.sandbox_unsupported')}
          </p>
        )}
      </Card>
    )
  }

  if (verdict.sandbox_unavailable) {
    return (
      <Card variant="default" padding="md" className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: 'var(--red)' }} />
        <div className="flex flex-col gap-1">
          <span className="font-display text-sm font-bold text-text-primary">
            {t('algo_stage.sandbox_unavailable_title')}
          </span>
          <span className="text-xs text-text-secondary">
            {t('algo_stage.sandbox_unavailable_body_pre')}{' '}
            <span className="font-mono">Submit</span>{' '}
            {t('algo_stage.sandbox_unavailable_body_post')}
          </span>
        </div>
      </Card>
    )
  }

  const allPassed = verdict.passed === verdict.total && verdict.total > 0
  return (
    <Card variant="default" padding="md" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {allPassed ? (
          <CheckCircle2 className="h-4 w-4 text-text-primary" aria-hidden />
        ) : (
          <span
            className="inline-block h-3.5 w-[1.5px]"
            style={{ background: 'var(--red)' }}
            aria-hidden
            title="failed"
          />
        )}
        <span className="font-display text-sm font-bold text-text-primary">
          {t('algo_stage.tests_passed', { passed: verdict.passed, total: verdict.total })}
        </span>
        {verdict.runtime_ms > 0 && (
          <span className="font-mono text-[10px] text-text-secondary ml-auto">
            {verdict.runtime_ms}ms
          </span>
        )}
      </div>
      {verdict.status !== 'ok' && (
        <div className="rounded-md border border-border bg-surface-1 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
          {verdict.status.replace('_', ' ')}
        </div>
      )}
      <ul className="flex flex-col gap-1.5">
        {verdict.tests.map((t) => (
          <TestCaseRow key={t.ordinal} test={t} />
        ))}
      </ul>
    </Card>
  )
}

function TestCaseRow({ test }: { test: AlgoTestResult }) {
  const [open, setOpen] = useState(false)
  const failedWithDetails =
    !test.passed && (test.input || test.expected_output || test.actual_output || test.stderr)

  return (
    <li className="rounded-md border border-border bg-surface-1">
      <button
        type="button"
        onClick={() => (failedWithDetails ? setOpen((o) => !o) : undefined)}
        disabled={!failedWithDetails}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        {test.passed ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-text-primary shrink-0" aria-hidden />
        ) : (
          <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden style={{ color: 'var(--red)' }} />
        )}
        <span className="font-mono text-[11px] text-text-primary">
          Case {test.ordinal}
          {test.is_hidden ? ' · hidden' : ''}
        </span>
        {test.runtime_ms > 0 && (
          <span className="font-mono text-[10px] text-text-secondary ml-auto">
            {test.runtime_ms}ms
          </span>
        )}
        {failedWithDetails && (
          <span className="text-text-secondary">
            {open ? (
              <ChevronDown className="h-3 w-3" aria-hidden />
            ) : (
              <ChevronRight className="h-3 w-3" aria-hidden />
            )}
          </span>
        )}
      </button>
      {open && failedWithDetails && (
        <div className="border-t border-border bg-surface-2 px-2 py-2 font-mono text-[11px] text-text-primary flex flex-col gap-1.5">
          {test.stderr && (
            <div>
              <div className="text-[9px] uppercase tracking-[0.08em] mb-0.5" style={{ color: 'var(--red)' }}>
                stderr
              </div>
              <pre className="whitespace-pre-wrap break-all">{test.stderr}</pre>
            </div>
          )}
          {!test.is_hidden && test.input && (
            <div>
              <div className="text-[9px] uppercase tracking-[0.08em] text-text-secondary mb-0.5">
                input
              </div>
              <pre className="whitespace-pre-wrap break-all">{test.input}</pre>
            </div>
          )}
          {!test.is_hidden && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[9px] uppercase tracking-[0.08em] text-text-secondary mb-0.5">
                  expected
                </div>
                <pre className="whitespace-pre-wrap break-all">{test.expected_output || '—'}</pre>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-[0.08em] text-text-secondary mb-0.5">
                  actual
                </div>
                <pre className="whitespace-pre-wrap break-all">{test.actual_output || '—'}</pre>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

// ── SubmitVerdictPanel — final LLM + sandbox verdict after Submit ───────

function SubmitVerdictPanel({ attempt }: { attempt: PipelineAttempt }) {
  const { t } = useTranslation('pages')
  const v = attempt.ai_verdict
  const passed = v === 'pass'
  const Icon = passed ? CheckCircle2 : XCircle
  return (
    <Card variant="default" padding="md" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-text-primary" />
        <span className="font-display text-sm font-bold uppercase text-text-primary">
          {v}
        </span>
        {attempt.ai_score !== null && (
          <span className="font-mono text-sm text-text-primary">
            · {attempt.ai_score}/100
          </span>
        )}
      </div>
      {attempt.ai_feedback_md && (
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
          Feedback
        </div>
      )}
      {attempt.ai_feedback_md && (
        <div className="text-xs text-text-primary whitespace-pre-wrap">
          {attempt.ai_feedback_md}
        </div>
      )}
      {attempt.ai_missing_points.length > 0 && (
        <>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
            {t('algo_stage.what_missed')}
          </div>
          <ul className="list-disc list-inside text-xs text-text-secondary space-y-0.5">
            {attempt.ai_missing_points.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

// ── FollowUpQuestion — minimal text-answer form для interviewer follow-ups ─

function FollowUpQuestion({
  attempt,
  pipelineId,
  ordinal,
}: {
  attempt: PipelineAttempt
  pipelineId: string
  ordinal: number
}) {
  const { t } = useTranslation('pages')
  const submit = useSubmitAnswerMutation(pipelineId)
  const [draft, setDraft] = useState<string>('')
  const isAnswered = !!(attempt.user_answer_md && attempt.user_answer_md.length > 0)

  return (
    <Card variant="default" padding="md" className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
          Q{ordinal}
        </span>
        <h3 className="font-display text-sm font-bold text-text-primary whitespace-pre-wrap">
          {attempt.question_body ?? '—'}
        </h3>
      </div>

      {!isAnswered && (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            disabled={submit.isPending}
            placeholder={t('algo_stage.your_answer_placeholder')}
            className="w-full resize-y border-0 border-b border-solid bg-transparent p-2 text-sm text-text-primary placeholder:text-text-secondary outline-none transition-colors duration-[var(--motion-dur-small)] ease-[var(--motion-ease-emphasized)] focus:outline-none"
            style={{ borderBottomColor: 'var(--hair-2)' }}
            onFocus={(e) => {
              e.currentTarget.style.borderBottomColor = 'rgb(var(--ink))'
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderBottomColor = 'var(--hair-2)'
            }}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                const trimmed = draft.trim()
                if (!trimmed) return
                submit.mutate({ attemptId: attempt.id, userAnswer: trimmed })
              }}
              disabled={submit.isPending || draft.trim().length === 0}
              loading={submit.isPending}
            >
              {t('algo_stage.send')}
            </Button>
          </div>
        </>
      )}

      {isAnswered && (
        <div className="flex flex-col gap-2">
          <div className="rounded-md border border-border bg-surface-1 p-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary mb-0.5">
              {t('algo_stage.answer_label')}
            </div>
            <div className="text-xs text-text-primary whitespace-pre-wrap font-mono">
              {attempt.user_answer_md}
            </div>
          </div>
          {attempt.ai_verdict !== 'pending' && (
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              <span className="font-display font-bold uppercase">{attempt.ai_verdict}</span>
              {attempt.ai_score !== null && <span>· {attempt.ai_score}/100</span>}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// ── AlgoLanguageSelect ──────────────────────────────────────────────────

function AlgoLanguageSelect({
  value,
  onChange,
  disabled,
}: {
  value: AlgoLanguage
  onChange: (v: AlgoLanguage) => void
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as AlgoLanguage)}
      disabled={disabled}
      className="rounded-md border border-border-strong bg-surface-1 px-2 py-1 font-mono text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-text-primary/40 disabled:opacity-60"
    >
      {ALGO_LANGUAGES.map((l) => (
        <option key={l.value} value={l.value}>
          {l.label}
        </option>
      ))}
    </select>
  )
}
