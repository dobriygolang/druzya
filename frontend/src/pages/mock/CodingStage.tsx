// CodingStage — R2 dedicated surface для Coding стадии mock pipeline'а.
//
// Differs from AlgoStage:
//   - Coding tasks are open-ended (refactor / implement endpoint). No exact
//     test verdict — LLM rubric instead. Monaco editor is full-width
//     (no Test-cases column).
//   - «Submit for grading» fires the rubric mutation (1..5 score +
//     strengths/weaknesses) without persisting. Final grading still flows
//     through SubmitAnswer.
//
// Layout (lg+): two-row grid
//   ┌─────────────────────────────────────────────┐
//   │ Problem brief (collapsible)                │
//   ├─────────────────────────────────────────────┤
//   │ Monaco editor (full width)                  │
//   ├─────────────────────────────────────────────┤
//   │ Rubric verdict card                         │
//   └─────────────────────────────────────────────┘
//
// B/W design: no green/red on score — uses font-mono tabular-nums for the
// 1..5 score, AlertCircle for unavailable, no colored gradients.

import { useMemo, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import {
  useFinishStageMutation,
  useRunCodingMutation,
  useSubmitAnswerMutation,
  type CodingVerdict,
  type PipelineAttempt,
  type PipelineStage,
} from '../../lib/queries/mockPipeline'

type CodingLanguage = 'go' | 'python' | 'javascript' | 'typescript' | 'cpp' | 'java'

const CODING_LANGUAGES: { value: CodingLanguage; label: string; monaco: string }[] = [
  { value: 'go', label: 'Go', monaco: 'go' },
  { value: 'python', label: 'Python', monaco: 'python' },
  { value: 'javascript', label: 'JavaScript', monaco: 'javascript' },
  { value: 'typescript', label: 'TypeScript', monaco: 'typescript' },
  { value: 'cpp', label: 'C++', monaco: 'cpp' },
  { value: 'java', label: 'Java', monaco: 'java' },
]

function detectCodingLanguage(taskLang: string | null | undefined, brief: string | null | undefined): CodingLanguage {
  const known: CodingLanguage[] = ['go', 'python', 'javascript', 'typescript', 'cpp', 'java']
  if (taskLang && known.includes(taskLang as CodingLanguage)) {
    return taskLang as CodingLanguage
  }
  const lower = (brief ?? '').toLowerCase()
  if (/\bgolang\b|\bgo\b/.test(lower)) return 'go'
  if (/\bpython\b/.test(lower)) return 'python'
  if (/\btypescript\b/.test(lower)) return 'typescript'
  if (/\bjavascript\b|\bjs\b/.test(lower)) return 'javascript'
  return 'python'
}

// ── CodingStage ─────────────────────────────────────────────────────────

export function CodingStage({
  stage,
  pipelineId,
}: {
  stage: PipelineStage
  pipelineId: string
}) {
  const finishStage = useFinishStageMutation(pipelineId)
  const attempts = useMemo(() => stage.attempts ?? [], [stage.attempts])
  const solveAttempt = useMemo(
    () => attempts.find((a) => a.kind === 'task_solve'),
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
          <span>
            Для этого этапа ещё не настроены задачи в пуле компании. Попроси админа
            добавить mock_task через /admin → Mock Tasks.
          </span>
        </div>
      </Card>
    )
  }
  if (noSolve) {
    return (
      <Card variant="default" padding="lg" className="text-sm text-text-secondary">
        <AlertCircle className="h-4 w-4 inline mr-2" style={{ color: 'var(--red)' }} />
        В пайплайне нет task_solve attempt'а для Coding стадии.
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <CodingTaskPanel attempt={solveAttempt!} pipelineId={pipelineId} />
      <div className="flex items-center justify-end gap-3 pt-2">
        {!allJudged && (
          <span className="text-xs text-text-secondary">
            Дождись AI-оценки решения
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
          Завершить этап
        </Button>
      </div>
    </div>
  )
}

// ── CodingTaskPanel ─────────────────────────────────────────────────────

function CodingTaskPanel({
  attempt,
  pipelineId,
}: {
  attempt: PipelineAttempt
  pipelineId: string
}) {
  const isAnswered = !!(attempt.user_answer_md && attempt.user_answer_md.length > 0)
  const isJudging = isAnswered && attempt.ai_verdict === 'pending'
  const isJudged = isAnswered && attempt.ai_verdict !== 'pending'

  const submit = useSubmitAnswerMutation(pipelineId)
  const runCoding = useRunCodingMutation()
  const [code, setCode] = useState<string>('')
  const [language, setLanguage] = useState<CodingLanguage>(() =>
    detectCodingLanguage(attempt.task_language ?? null, attempt.question_body ?? ''),
  )
  const [verdict, setVerdict] = useState<CodingVerdict | null>(null)

  const handleRunRubric = () => {
    const body = code.trim()
    if (!body) return
    runCoding.mutate(
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

  // Stable refs for Monaco keybindings.
  const handleRunRubricRef = useRef(handleRunRubric)
  handleRunRubricRef.current = handleRunRubric
  const handleSubmitRef = useRef(handleSubmit)
  handleSubmitRef.current = handleSubmit

  const handleMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handleRunRubricRef.current()
    })
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      () => handleSubmitRef.current(),
    )
  }

  const monacoLang = CODING_LANGUAGES.find((l) => l.value === language)?.monaco ?? 'python'

  return (
    <div className="flex flex-col gap-3">
      <ProblemBrief attempt={attempt} />

      {!isAnswered ? (
        <Card variant="default" padding="none" className="flex flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
            <CodingLanguageSelect
              value={language}
              onChange={setLanguage}
              disabled={runCoding.isPending || submit.isPending}
            />
            <span className="font-mono text-[10px] text-text-secondary">
              {code.split('\n').length} строк · {code.length} символов
            </span>
          </div>
          <div className="min-h-[440px]">
            <Editor
              height="480px"
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
              ⌘+Enter · Get rubric · ⌘+Shift+Enter · Submit
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={<Play className="h-3.5 w-3.5" />}
                onClick={handleRunRubric}
                disabled={runCoding.isPending || submit.isPending || code.trim().length === 0}
                loading={runCoding.isPending}
              >
                Get rubric
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSubmit}
                disabled={runCoding.isPending || submit.isPending || code.trim().length === 0}
                loading={submit.isPending}
              >
                Submit
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card variant="default" padding="lg" className="flex flex-col gap-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
            Решение отправлено
          </div>
          <pre className="text-sm text-text-primary whitespace-pre-wrap font-mono overflow-x-auto">
            {attempt.user_answer_md}
          </pre>
        </Card>
      )}

      {/* Rubric verdict — pre-submit dry-run */}
      {!isAnswered && (
        <RubricVerdictPanel
          verdict={verdict}
          isLoading={runCoding.isPending}
          error={runCoding.error}
        />
      )}

      {isJudging && (
        <Card variant="default" padding="md" className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
          <span className="text-sm text-text-secondary">AI оценивает решение…</span>
        </Card>
      )}

      {isJudged && <SubmitVerdictPanel attempt={attempt} />}
    </div>
  )
}

// ── ProblemBrief ────────────────────────────────────────────────────────

function ProblemBrief({ attempt }: { attempt: PipelineAttempt }) {
  const mustMention = attempt.reference_criteria?.must_mention ?? []
  const niceToHave = attempt.reference_criteria?.nice_to_have ?? []

  return (
    <Card variant="default" padding="lg" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
          Задача
        </span>
        {attempt.task_functional_requirements_md && (
          <span className="rounded-full border border-border-strong bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
            functional reqs attached
          </span>
        )}
      </div>
      <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-text-primary">
        {attempt.question_body ?? '—'}
      </div>
      {attempt.task_functional_requirements_md && (
        <div className="rounded-md border border-border bg-surface-1 p-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary mb-1">
            Функциональные требования
          </div>
          <div className="whitespace-pre-wrap font-mono text-xs text-text-primary">
            {attempt.task_functional_requirements_md}
          </div>
        </div>
      )}
      {(mustMention.length > 0 || niceToHave.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {mustMention.length > 0 && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary mb-1">
                Must
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
        </div>
      )}
    </Card>
  )
}

// ── RubricVerdictPanel ──────────────────────────────────────────────────

function RubricVerdictPanel({
  verdict,
  isLoading,
  error,
}: {
  verdict: CodingVerdict | null
  isLoading: boolean
  error: unknown
}) {
  if (isLoading) {
    return (
      <Card variant="default" padding="md" className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
        <span className="text-sm text-text-secondary">AI оценивает rubric…</span>
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
            Rubric failed
          </span>
          <span className="text-xs text-text-secondary break-all">{msg}</span>
        </div>
      </Card>
    )
  }
  if (!verdict) {
    return (
      <Card variant="default" padding="md" className="text-sm text-text-secondary">
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] mb-1">
          Rubric ещё не запускался
        </div>
        <p className="text-xs">
          Напиши решение и нажми <span className="font-mono">Get rubric</span> — LLM
          даст breakdown по 5 critic'ам. Финальная оценка — <span className="font-mono">Submit</span>.
        </p>
      </Card>
    )
  }

  if (verdict.unavailable) {
    return (
      <Card variant="default" padding="md" className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: 'var(--red)' }} />
        <div className="flex flex-col gap-1">
          <span className="font-display text-sm font-bold text-text-primary">
            Оценка временно недоступна
          </span>
          <span className="text-xs text-text-secondary">
            LLM не ответил — попробуй ещё раз. Можно сразу{' '}
            <span className="font-mono">Submit</span> — финальный judge запустится в SubmitAnswer.
          </span>
        </div>
      </Card>
    )
  }

  return (
    <Card variant="default" padding="md" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="font-mono text-2xl font-bold text-text-primary tabular-nums">
          {verdict.score}
          <span className="text-sm text-text-secondary ml-1">/ 5</span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
          rubric score
        </span>
      </div>
      {verdict.rubric_md && (
        <div className="text-sm text-text-primary whitespace-pre-wrap">
          {verdict.rubric_md}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {verdict.strengths.length > 0 && (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary mb-1">
              Strengths
            </div>
            <ul className="list-disc list-inside text-xs text-text-primary space-y-0.5">
              {verdict.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {verdict.weaknesses.length > 0 && (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary mb-1">
              Weaknesses
            </div>
            <ul className="list-disc list-inside text-xs text-text-secondary space-y-0.5">
              {verdict.weaknesses.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {verdict.suggested_lines.length > 0 && (
        <div className="rounded-md border border-border bg-surface-1 p-2 flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
            Review lines:
          </span>
          {verdict.suggested_lines.map((n) => (
            <span
              key={n}
              className="rounded-full border border-border-strong bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-primary tabular-nums"
            >
              L{n}
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── SubmitVerdictPanel — post-submit final verdict ──────────────────────

function SubmitVerdictPanel({ attempt }: { attempt: PipelineAttempt }) {
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
          <span className="font-mono text-sm text-text-primary tabular-nums">
            · {attempt.ai_score}/100
          </span>
        )}
      </div>
      {attempt.ai_feedback_md && (
        <>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
            Feedback
          </div>
          <div className="text-xs text-text-primary whitespace-pre-wrap">
            {attempt.ai_feedback_md}
          </div>
        </>
      )}
      {attempt.ai_missing_points.length > 0 && (
        <>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-secondary">
            Что упустил
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

// ── CodingLanguageSelect ────────────────────────────────────────────────

function CodingLanguageSelect({
  value,
  onChange,
  disabled,
}: {
  value: CodingLanguage
  onChange: (v: CodingLanguage) => void
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as CodingLanguage)}
      disabled={disabled}
      className="rounded-md border border-border-strong bg-surface-1 px-2 py-1 font-mono text-[11px] text-text-primary focus:outline-none focus:ring-1 focus:ring-text-primary/40 disabled:opacity-60"
    >
      {CODING_LANGUAGES.map((l) => (
        <option key={l.value} value={l.value}>
          {l.label}
        </option>
      ))}
    </select>
  )
}
