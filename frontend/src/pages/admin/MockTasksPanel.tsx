// MockTasksPanel — task CRUD with structured reference editor + per-task
// follow-up questions. Phase A.2 of ADR-002.
//
// 2-column layout. Left: filterable list of tasks (chip filters for stage
// + language + active). Right: editor with three tabs — Body / Reference /
// Questions. The "+ New task" button opens a minimal modal (just stage,
// language, difficulty, title); rest is filled on the detail page.

import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/Button'
import { FormField } from '../../components/FormField'
import { ErrorBox, PanelSkeleton } from './shared'
import { ReferenceCriteriaEditor } from './ReferenceCriteriaEditor'
import {
  mockAdminErrorMessage,
  useBulkImportTasksMutation,
  useCreateTaskMutation,
  useCreateTaskQuestionMutation,
  useCreateTestCaseMutation,
  useDeleteTaskQuestionMutation,
  useDeleteTestCaseMutation,
  useStrictnessQuery,
  useTaskQuery,
  useTasksQuery,
  useTestCasesQuery,
  useUpdateTaskMutation,
  useUpdateTaskQuestionMutation,
  useUpdateTestCaseMutation,
  type BulkTaskImportItem,
  type MockTask,
  type ReferenceCriteria,
  type StageKind,
  type TaskLanguage,
  type TaskQuestion,
  type TestCase,
} from '../../lib/queries/mockAdmin'
import { useAIModelsQuery } from '../../lib/queries/ai'

const STAGE_KINDS: StageKind[] = ['hr', 'algo', 'coding', 'sysdesign', 'behavioral']
const LANGS: TaskLanguage[] = ['go', 'python', 'sql', 'any']
type EditorTab = 'body' | 'reference' | 'questions' | 'tests'

export function MockTasksPanel() {
  const [stage, setStage] = useState<StageKind | undefined>(undefined)
  const [language, setLanguage] = useState<TaskLanguage | undefined>(undefined)
  const [activeOnly, setActiveOnly] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)

  const list = useTasksQuery({
    stage,
    language,
    active: activeOnly ? true : undefined,
  })

  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-7 lg:flex-row">
      <aside className="flex w-full flex-col gap-3 lg:w-80">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-bold text-text-primary">Задачи</h2>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              className="rounded-md border border-border bg-surface-1 px-2 py-1 font-mono text-[10px] uppercase text-text-secondary hover:text-text-primary"
            >
              bulk
            </button>
            <Button size="sm" onClick={() => setCreating(true)}>
              + New task
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-1 p-3">
          <ChipRow
            label="stage"
            options={STAGE_KINDS}
            value={stage}
            onChange={setStage}
          />
          <ChipRow
            label="language"
            options={LANGS}
            value={language}
            onChange={setLanguage}
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
            />
            <span className="font-mono text-[11px] text-text-secondary">только active</span>
          </label>
        </div>

        {list.isPending ? (
          <PanelSkeleton rows={4} />
        ) : list.error ? (
          <ErrorBox message={mockAdminErrorMessage(list.error)} />
        ) : list.data && list.data.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {list.data.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors ${
                    selectedId === t.id
                      ? 'border-text-primary bg-surface-2'
                      : 'border-border bg-surface-1 hover:border-border-strong'
                  }`}
                >
                  <span className="truncate text-[13px] font-semibold text-text-primary">
                    {t.title}
                  </span>
                  <span className="flex items-center gap-1.5 font-mono text-[10px] text-text-muted">
                    <Pill>{t.stage_kind}</Pill>
                    <Pill>{t.language}</Pill>
                    <DifficultyDots n={t.difficulty} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-surface-1 px-3 py-5 text-center font-mono text-[11px] text-text-muted">
            Нет задач — создай первую.
          </div>
        )}
      </aside>

      <main className="flex-1">
        {bulkOpen && <BulkImportDialog onClose={() => setBulkOpen(false)} />}
        {creating && <CreateTaskModal onClose={() => setCreating(false)} onCreated={(id) => { setSelectedId(id); setCreating(false) }} />}
        {selectedId ? (
          <TaskDetailEditor key={selectedId} taskId={selectedId} />
        ) : (
          !creating && (
            <div className="grid h-full place-items-center rounded-lg border border-dashed border-border bg-surface-1 px-6 py-16 text-center font-mono text-[12px] text-text-muted">
              Выбери задачу слева или создай новую.
            </div>
          )
        )}
      </main>
    </div>
  )
}

function ChipRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: T[]
  value: T | undefined
  onChange: (v: T | undefined) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted">
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange(undefined)}
        className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
          value === undefined
            ? 'border-text-primary bg-text-primary/10 text-text-primary'
            : 'border-border text-text-secondary'
        }`}
      >
        all
      </button>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(value === o ? undefined : o)}
          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${
            value === o
              ? 'border-text-primary bg-text-primary/10 text-text-primary'
              : 'border-border text-text-secondary'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-border bg-bg/40 px-1.5 py-0.5 font-mono text-[9px]">
      {children}
    </span>
  )
}

function DifficultyDots({ n }: { n: number }) {
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i < n ? 'bg-text-primary' : 'bg-surface-3'
          }`}
        />
      ))}
    </span>
  )
}

function CreateTaskModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const create = useCreateTaskMutation()
  const [stage, setStage] = useState<StageKind>('algo')
  const [language, setLanguage] = useState<TaskLanguage>('any')
  const [difficulty, setDifficulty] = useState('3')
  const [title, setTitle] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      const r = await create.mutateAsync({
        stage_kind: stage,
        language,
        difficulty: Number(difficulty) || 3,
        title: title.trim(),
      })
      onCreated(r.id)
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border-strong bg-surface-1 p-5"
      >
        <h3 className="font-display text-sm font-bold text-text-primary">Новая задача</h3>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">stage</span>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as StageKind)}
            className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[13px] text-text-primary"
          >
            {STAGE_KINDS.filter((k) => k !== 'hr' && k !== 'behavioral').map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">language</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as TaskLanguage)}
            className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[13px] text-text-primary"
          >
            {LANGS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </label>
        <FormField
          label="difficulty (1..5)"
          type="number"
          min={1}
          max={5}
          value={difficulty}
          onChange={(e) => setDifficulty(e.currentTarget.value)}
        />
        <FormField
          label="title"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          required
        />
        {err && <div className="text-[12px] text-danger">{err}</div>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Отмена</Button>
          <Button type="submit" size="sm" loading={create.isPending}>Создать</Button>
        </div>
      </form>
    </div>
  )
}

function TaskDetailEditor({ taskId }: { taskId: string }) {
  const taskQ = useTaskQuery(taskId)
  const create = useCreateTaskMutation()
  const [tab, setTab] = useState<EditorTab>('body')

  if (taskQ.isPending) return <PanelSkeleton rows={5} />
  if (taskQ.error || !taskQ.data) return <ErrorBox message={mockAdminErrorMessage(taskQ.error)} />

  const task = taskQ.data

  // Clone — duplicate task with "+ clone" suffix in title. Useful for
  // seeding series of similar tasks (e.g. 5 hash-map variants).
  const onClone = async () => {
    try {
      await create.mutateAsync({
        stage_kind: task.stage_kind,
        language: task.language,
        difficulty: task.difficulty,
        title: `${task.title} · clone`,
        body_md: task.body_md ?? '',
        sample_io_md: task.sample_io_md ?? '',
        reference_criteria: task.reference_criteria ?? undefined,
        reference_solution_md: task.reference_solution_md ?? '',
        functional_requirements_md: task.functional_requirements_md ?? '',
        time_limit_min: task.time_limit_min ?? undefined,
        ai_strictness_profile_id: task.ai_strictness_profile_id ?? undefined,
        llm_model: task.llm_model ?? '',
      })
    } catch {
      /* surfaced via mutation state */
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate font-display text-sm font-bold text-text-primary">{task.title}</h3>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void onClone()}
            disabled={create.isPending}
            className="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[10px] uppercase text-text-secondary hover:text-text-primary disabled:opacity-60"
          >
            {create.isPending ? 'cloning…' : 'clone'}
          </button>
          <span className="font-mono text-[10px] text-text-muted">{task.id}</span>
        </div>
      </div>

      <div className="flex gap-1.5 border-b border-border">
        {(['body', 'reference', 'questions', 'tests'] as EditorTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${
              tab === t
                ? 'border-text-primary text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'body' && <BodyTab task={task} />}
      {tab === 'reference' && <ReferenceTab task={task} />}
      {tab === 'questions' && <QuestionsTab task={task} />}
      {tab === 'tests' && <TestsTab task={task} />}
    </div>
  )
}

function BodyTab({ task }: { task: MockTask }) {
  const update = useUpdateTaskMutation()
  const strictness = useStrictnessQuery()
  const aiModels = useAIModelsQuery('mock')
  const [title, setTitle] = useState(task.title)
  const [stage, setStage] = useState<StageKind>(task.stage_kind)
  const [language, setLanguage] = useState<TaskLanguage>(task.language)
  const [difficulty, setDifficulty] = useState(String(task.difficulty))
  const [bodyMd, setBodyMd] = useState(task.body_md ?? '')
  const [sampleIo, setSampleIo] = useState(task.sample_io_md ?? '')
  const [funcReq, setFuncReq] = useState(task.functional_requirements_md ?? '')
  const [timeLimit, setTimeLimit] = useState(task.time_limit_min ? String(task.time_limit_min) : '')
  const [strictnessId, setStrictnessId] = useState(task.ai_strictness_profile_id ?? '')
  const [llmModel, setLlmModel] = useState(task.llm_model ?? '')
  const [err, setErr] = useState<string | null>(null)

  async function doSave() {
    setErr(null)
    try {
      await update.mutateAsync({
        id: task.id,
        body: {
          title: title.trim(),
          stage_kind: stage,
          language,
          difficulty: Number(difficulty) || task.difficulty,
          body_md: bodyMd,
          sample_io_md: sampleIo,
          functional_requirements_md: stage === 'sysdesign' ? funcReq : undefined,
          time_limit_min: timeLimit ? Number(timeLimit) : undefined,
          ai_strictness_profile_id: strictnessId || undefined,
          llm_model: llmModel || '',
        },
      })
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    await doSave()
  }
  // Cmd+S / Ctrl+S — save on hotkey. Doubles seeding speed when typing
  // body markdown without reaching for the Save button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void doSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, stage, language, difficulty, bodyMd, sampleIo, funcReq, timeLimit, strictnessId, llmModel])

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <FormField label="title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">stage</span>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as StageKind)}
            className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[13px] text-text-primary"
          >
            {STAGE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">language</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as TaskLanguage)}
            className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[13px] text-text-primary"
          >
            {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <FormField
          label="difficulty"
          type="number"
          min={1}
          max={5}
          value={difficulty}
          onChange={(e) => setDifficulty(e.currentTarget.value)}
        />
      </div>

      <MarkdownArea label="body_md" value={bodyMd} onChange={setBodyMd} minRows={12} />
      <MarkdownArea label="sample_io_md" value={sampleIo} onChange={setSampleIo} minRows={6} />
      {stage === 'sysdesign' && (
        <MarkdownArea label="functional_requirements_md" value={funcReq} onChange={setFuncReq} minRows={6} />
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <FormField
          label="time_limit_min"
          type="number"
          value={timeLimit}
          onChange={(e) => setTimeLimit(e.currentTarget.value)}
        />
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">strictness</span>
          <select
            value={strictnessId}
            onChange={(e) => setStrictnessId(e.target.value)}
            className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[13px] text-text-primary"
          >
            <option value="">— default —</option>
            {(strictness.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">llm_model</span>
          <select
            value={llmModel}
            onChange={(e) => setLlmModel(e.target.value)}
            className="rounded-md border border-border bg-bg/40 px-2 py-1.5 text-[13px] text-text-primary"
          >
            <option value="">— inherit —</option>
            {(aiModels.data?.items ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} {m.tier === 'premium' ? '★' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {err && <div className="text-[12px] text-danger">{err}</div>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={update.isPending}>Сохранить</Button>
      </div>
    </form>
  )
}

function ReferenceTab({ task }: { task: MockTask }) {
  const update = useUpdateTaskMutation()
  const [criteria, setCriteria] = useState<ReferenceCriteria>(task.reference_criteria ?? {})
  const [solution, setSolution] = useState(task.reference_solution_md ?? '')
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setErr(null)
    try {
      await update.mutateAsync({
        id: task.id,
        body: {
          reference_criteria: criteria,
          reference_solution_md: solution,
        },
      })
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ReferenceCriteriaEditor value={criteria} onChange={setCriteria} />
      <MarkdownArea
        label="reference_solution_md"
        value={solution}
        onChange={setSolution}
        minRows={10}
      />
      {err && <div className="text-[12px] text-danger">{err}</div>}
      <div className="flex justify-end">
        <Button size="sm" onClick={save} loading={update.isPending}>Сохранить</Button>
      </div>
    </div>
  )
}

function QuestionsTab({ task }: { task: MockTask }) {
  const create = useCreateTaskQuestionMutation()
  const [newBody, setNewBody] = useState('')
  const [newSort, setNewSort] = useState('0')
  const [err, setErr] = useState<string | null>(null)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!newBody.trim()) return
    try {
      await create.mutateAsync({
        taskId: task.id,
        body: { body: newBody.trim(), sort_order: Number(newSort) || 0 },
      })
      setNewBody('')
      setNewSort('0')
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  const questions = (task.questions ?? []).slice().sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="flex flex-col gap-3">
      {questions.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-surface-2 px-3 py-4 text-center font-mono text-[11px] text-text-muted">
          Нет follow-up вопросов.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {questions.map((q) => (
            <TaskQuestionRow key={q.id} taskId={task.id} q={q} />
          ))}
        </ul>
      )}

      <form
        onSubmit={add}
        className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
          + добавить вопрос
        </div>
        <FormField
          label="body"
          value={newBody}
          onChange={(e) => setNewBody(e.currentTarget.value)}
        />
        <FormField
          label="sort_order"
          type="number"
          value={newSort}
          onChange={(e) => setNewSort(e.currentTarget.value)}
        />
        {err && <div className="text-[12px] text-danger">{err}</div>}
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={create.isPending}>Добавить</Button>
        </div>
      </form>
    </div>
  )
}

function TaskQuestionRow({ taskId, q }: { taskId: string; q: TaskQuestion }) {
  const update = useUpdateTaskQuestionMutation()
  const del = useDeleteTaskQuestionMutation()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState(q.body)
  const [expected, setExpected] = useState(q.expected_answer_md ?? '')
  const [criteria, setCriteria] = useState<ReferenceCriteria>(q.reference_criteria ?? {})
  const [sort, setSort] = useState(String(q.sort_order))
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setErr(null)
    try {
      await update.mutateAsync({
        id: q.id,
        taskId,
        body: {
          body: body.trim(),
          expected_answer_md: expected,
          reference_criteria: criteria,
          sort_order: Number(sort) || 0,
        },
      })
      setOpen(false)
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  return (
    <li
      className="rounded-md border border-border bg-surface-2 p-3"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) setOpen(false)
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-text-primary">{q.body}</div>
          <div className="mt-0.5 font-mono text-[9px] text-text-muted">sort={q.sort_order}</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-text-secondary"
          >
            {open ? '−' : 'edit'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('Удалить вопрос?')) del.mutate({ id: q.id, taskId })
            }}
            className="rounded border border-danger/40 px-2 py-0.5 font-mono text-[10px] text-danger"
          >
            ✕
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <FormField label="body" value={body} onChange={(e) => setBody(e.currentTarget.value)} />
          <MarkdownArea
            label="expected_answer_md"
            value={expected}
            onChange={setExpected}
            minRows={4}
          />
          <ReferenceCriteriaEditor value={criteria} onChange={setCriteria} />
          <FormField
            label="sort_order"
            type="number"
            value={sort}
            onChange={(e) => setSort(e.currentTarget.value)}
          />
          {err && <div className="text-[12px] text-danger">{err}</div>}
          <div className="flex justify-end">
            <Button size="sm" onClick={save} loading={update.isPending}>Сохранить</Button>
          </div>
        </div>
      )}
    </li>
  )
}

function MarkdownArea({
  label,
  value,
  onChange,
  minRows = 6,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  minRows?: number
}) {
  const chars = useMemo(() => value.length, [value])
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={minRows}
        className="resize-y whitespace-pre-wrap rounded-md border border-border bg-bg/40 px-3 py-2 font-mono text-[12px] text-text-primary outline-none transition-colors focus:border-text-primary"
        style={{ minHeight: minRows >= 12 ? 300 : undefined }}
      />
      <div className="self-end font-mono text-[9px] text-text-muted">{chars} chars</div>
    </div>
  )
}

// ── tests tab ──────────────────────────────────────────────────────────

function TestsTab({ task }: { task: MockTask }) {
  const list = useTestCasesQuery(task.id)
  const create = useCreateTestCaseMutation(task.id)
  const update = useUpdateTestCaseMutation(task.id)
  const del = useDeleteTestCaseMutation(task.id)
  const [draft, setDraft] = useState<{ input: string; expected: string; hidden: boolean }>(
    { input: '', expected: '', hidden: false },
  )
  const [err, setErr] = useState<string | null>(null)

  const cases = list.data ?? []

  async function add() {
    setErr(null)
    if (!draft.input.trim() || !draft.expected.trim()) {
      setErr('input and expected_output are required')
      return
    }
    try {
      await create.mutateAsync({
        input: draft.input,
        expected_output: draft.expected,
        is_hidden: draft.hidden,
        ordinal: cases.length,
      })
      setDraft({ input: '', expected: '', hidden: false })
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-text-muted">
        Test cases for the Judge0 sandbox. Each row is one stdin/stdout
        pair — task is judged as pass when every visible case matches
        exactly (after trim). `is_hidden` rows still count toward the
        verdict but are not shown in the candidate's failure summary.
      </p>

      {list.isPending && <PanelSkeleton rows={2} />}
      {list.error && <ErrorBox message={mockAdminErrorMessage(list.error)} />}

      {cases.length > 0 && (
        <ul className="flex flex-col gap-2">
          {cases.map((tc) => (
            <TestCaseRow
              key={tc.id}
              tc={tc}
              onSave={(body) => update.mutateAsync({ id: tc.id, body })}
              onDelete={() => del.mutateAsync(tc.id)}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-1 p-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
          Add case
        </div>
        <textarea
          value={draft.input}
          placeholder="stdin"
          rows={3}
          onChange={(e) => setDraft({ ...draft, input: e.currentTarget.value })}
          className="rounded-md border border-border bg-bg/40 p-2 font-mono text-[12px] text-text-primary"
        />
        <textarea
          value={draft.expected}
          placeholder="expected stdout"
          rows={2}
          onChange={(e) => setDraft({ ...draft, expected: e.currentTarget.value })}
          className="rounded-md border border-border bg-bg/40 p-2 font-mono text-[12px] text-text-primary"
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={draft.hidden}
            onChange={(e) => setDraft({ ...draft, hidden: e.currentTarget.checked })}
          />
          <span className="font-mono text-[11px] text-text-secondary">is_hidden</span>
        </label>
        {err && <div className="text-[12px] text-danger">{err}</div>}
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void add()} loading={create.isPending}>
            + Add case
          </Button>
        </div>
      </div>
    </div>
  )
}

function TestCaseRow({
  tc,
  onSave,
  onDelete,
}: {
  tc: TestCase
  onSave: (body: { input: string; expected_output: string; is_hidden: boolean; ordinal: number }) => Promise<unknown>
  onDelete: () => Promise<unknown>
}) {
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState(tc.input)
  const [expected, setExpected] = useState(tc.expected_output)
  const [hidden, setHidden] = useState(tc.is_hidden)

  if (!editing) {
    return (
      <li className="flex items-start gap-3 rounded-md border border-border bg-surface-1 p-3">
        <span className="font-mono text-[10px] text-text-muted">#{tc.ordinal}</span>
        <div className="flex-1 min-w-0">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-text-primary">
            {tc.input}
          </pre>
          <div className="my-1 font-mono text-[9px] uppercase text-text-muted">→</div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-text-secondary">
            {tc.expected_output}
          </pre>
          {tc.is_hidden && (
            <span className="mt-1 inline-block rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] uppercase text-text-muted">
              hidden
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-secondary hover:text-text-primary"
          >
            edit
          </button>
          <button
            type="button"
            onClick={() => void onDelete()}
            className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-secondary hover:text-danger"
          >
            del
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-surface-1 p-3">
      <textarea
        value={input}
        rows={3}
        onChange={(e) => setInput(e.currentTarget.value)}
        className="rounded-md border border-border bg-bg/40 p-2 font-mono text-[12px] text-text-primary"
      />
      <textarea
        value={expected}
        rows={2}
        onChange={(e) => setExpected(e.currentTarget.value)}
        className="rounded-md border border-border bg-bg/40 p-2 font-mono text-[12px] text-text-primary"
      />
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={hidden}
          onChange={(e) => setHidden(e.currentTarget.checked)}
        />
        <span className="font-mono text-[11px] text-text-secondary">is_hidden</span>
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-md border border-border bg-surface-2 px-2 py-1 font-mono text-[10px] text-text-secondary"
        >
          cancel
        </button>
        <Button
          size="sm"
          onClick={async () => {
            await onSave({
              input,
              expected_output: expected,
              is_hidden: hidden,
              ordinal: tc.ordinal,
            })
            setEditing(false)
          }}
        >
          save
        </Button>
      </div>
    </li>
  )
}

// ── bulk import dialog ────────────────────────────────────────────────

// BulkImportDialog — dry-run-first JSON paste. Two-step UX:
//   1. Paste → click "Validate" → parser builds preview list with
//      per-row errors. Nothing hits backend.
//   2. Click "Import" only enabled when preview has at least one valid
//      row. Backend runs best-effort (per-row errors come back too).
export function BulkImportDialog({ onClose }: { onClose: () => void }) {
  const mut = useBulkImportTasksMutation()
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<{ index: number; title: string; valid: boolean; reason?: string }[] | null>(null)
  const [parsed, setParsed] = useState<BulkTaskImportItem[] | null>(null)
  const [results, setResults] = useState<{ index: number; task_id?: string; error?: string; test_cases_added: number }[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Esc to close — same shortcut as elsewhere in the admin.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function validateRow(item: unknown, idx: number): { ok: true; row: BulkTaskImportItem; preview: { index: number; title: string; valid: true } } | { ok: false; preview: { index: number; title: string; valid: false; reason: string } } {
    if (typeof item !== 'object' || item === null) {
      return { ok: false, preview: { index: idx, title: '(not an object)', valid: false, reason: 'item must be an object' } }
    }
    const it = item as Partial<BulkTaskImportItem>
    const title = (it.title ?? '').toString()
    if (!title.trim()) {
      return { ok: false, preview: { index: idx, title: '(no title)', valid: false, reason: 'title is required' } }
    }
    if (!it.stage_kind) {
      return { ok: false, preview: { index: idx, title, valid: false, reason: 'stage_kind is required' } }
    }
    if (!it.language) {
      return { ok: false, preview: { index: idx, title, valid: false, reason: 'language is required' } }
    }
    if (typeof it.difficulty !== 'number') {
      return { ok: false, preview: { index: idx, title, valid: false, reason: 'difficulty must be a number 1..5' } }
    }
    return { ok: true, row: it as BulkTaskImportItem, preview: { index: idx, title, valid: true } }
  }

  function validate() {
    setErr(null)
    setResults(null)
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (e) {
      setErr('Invalid JSON: ' + (e instanceof Error ? e.message : String(e)))
      setPreview(null)
      setParsed(null)
      return
    }
    const arr = Array.isArray(raw) ? raw : (raw as { tasks?: unknown[] }).tasks
    if (!Array.isArray(arr) || arr.length === 0) {
      setErr('Expected a non-empty array of tasks (or {tasks: [...]} envelope)')
      setPreview(null)
      setParsed(null)
      return
    }
    const previews: { index: number; title: string; valid: boolean; reason?: string }[] = []
    const okRows: BulkTaskImportItem[] = []
    arr.forEach((item, idx) => {
      const v = validateRow(item, idx)
      previews.push(v.preview)
      if (v.ok) okRows.push(v.row)
    })
    setPreview(previews)
    setParsed(okRows)
  }

  async function runImport() {
    if (!parsed || parsed.length === 0) return
    setErr(null)
    try {
      const out = await mut.mutateAsync(parsed)
      setResults(out.results)
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

  const totalRows = preview?.length ?? 0
  const validRows = preview?.filter((p) => p.valid).length ?? 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-lg border border-border-strong bg-surface-1 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-text-primary">Bulk import tasks</h3>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[11px] text-text-muted hover:text-text-primary"
          >
            esc
          </button>
        </div>
        <p className="font-mono text-[11px] text-text-muted">
          Paste a JSON array (or {'{'} tasks: [...] {'}'} envelope) of task objects.
          Each item may carry an inline <code>test_cases</code> array.
          Click <b>Validate</b> first — nothing hits backend until preview is clean.
        </p>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value)
            setPreview(null) // dirty input invalidates preview
            setParsed(null)
            setResults(null)
          }}
          rows={12}
          placeholder='[{"stage_kind":"algo","language":"python","difficulty":1,"title":"Two Sum","body_md":"...","active":true,"test_cases":[{"input":"2,7\n9","expected_output":"0 1"}]}]'
          className="w-full rounded-md border border-border bg-bg/40 p-2 font-mono text-[12px] text-text-primary"
        />
        {err && <div className="text-[12px] text-danger">{err}</div>}

        {preview && (
          <div className="rounded-md border border-border bg-surface-2 p-3 font-mono text-[11px]">
            <div className="mb-2 flex items-baseline justify-between text-text-secondary">
              <span>
                Preview: {validRows} valid / {totalRows} total
              </span>
              {validRows < totalRows && (
                <span className="text-text-muted">{totalRows - validRows} с ошибками</span>
              )}
            </div>
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {preview.map((p) => (
                <li key={p.index} className={p.valid ? 'text-text-secondary' : 'text-danger'}>
                  #{p.index} {p.valid ? '✓' : '✗'} {p.title}
                  {p.reason && <span className="ml-1 text-text-muted">— {p.reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {results && (
          <div className="rounded-md border border-border bg-surface-2 p-3 font-mono text-[11px]">
            <div className="mb-2 text-text-secondary">
              Imported {results.filter((r) => r.task_id).length} / {results.length}.
            </div>
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {results.map((r) => (
                <li key={r.index} className="text-text-muted">
                  #{r.index}{' '}
                  {r.task_id ? (
                    <span className="text-text-secondary">
                      ✓ {r.task_id.slice(0, 8)} · {r.test_cases_added} cases
                    </span>
                  ) : (
                    <span className="text-danger">✗ {r.error}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[11px] text-text-secondary"
          >
            close
          </button>
          <button
            type="button"
            onClick={validate}
            disabled={!text.trim()}
            className="rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-[11px] text-text-primary hover:bg-surface-3 disabled:opacity-50"
          >
            Validate
          </button>
          <Button
            size="sm"
            onClick={() => void runImport()}
            loading={mut.isPending}
            disabled={!parsed || parsed.length === 0}
          >
            Import {validRows > 0 ? `(${validRows})` : ''}
          </Button>
        </div>
      </div>
    </div>
  )
}
