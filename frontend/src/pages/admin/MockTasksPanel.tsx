// MockTasksPanel — task CRUD with structured reference editor + per-task
// follow-up questions. Phase A.2 of ADR-002.
//
// 2-column layout. Left: filterable list of tasks (chip filters for stage
// + language + active). Right: editor with three tabs — Body / Reference /
// Questions. The "+ New task" button opens a minimal modal (just stage,
// language, difficulty, title); rest is filled on the detail page.

import { useMemo, useState } from 'react'
import { Button } from '../../components/Button'
import { FormField } from '../../components/FormField'
import { ErrorBox, PanelSkeleton } from './shared'
import { ReferenceCriteriaEditor } from './ReferenceCriteriaEditor'
import {
  mockAdminErrorMessage,
  useCreateTaskMutation,
  useCreateTaskQuestionMutation,
  useDeleteTaskQuestionMutation,
  useStrictnessQuery,
  useTaskQuery,
  useTasksQuery,
  useUpdateTaskMutation,
  useUpdateTaskQuestionMutation,
  type MockTask,
  type ReferenceCriteria,
  type StageKind,
  type TaskLanguage,
  type TaskQuestion,
} from '../../lib/queries/mockAdmin'

const STAGE_KINDS: StageKind[] = ['hr', 'algo', 'coding', 'sysdesign', 'behavioral']
const LANGS: TaskLanguage[] = ['go', 'python', 'sql', 'any']
type EditorTab = 'body' | 'reference' | 'questions'

export function MockTasksPanel() {
  const [stage, setStage] = useState<StageKind | undefined>(undefined)
  const [language, setLanguage] = useState<TaskLanguage | undefined>(undefined)
  const [activeOnly, setActiveOnly] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const list = useTasksQuery({
    stage,
    language,
    active: activeOnly ? true : undefined,
  })

  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-7 lg:flex-row">
      <aside className="flex w-full flex-col gap-3 lg:w-80">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-text-primary">Задачи</h2>
          <Button size="sm" onClick={() => setCreating(true)}>
            + New task
          </Button>
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
  const [tab, setTab] = useState<EditorTab>('body')

  if (taskQ.isPending) return <PanelSkeleton rows={5} />
  if (taskQ.error || !taskQ.data) return <ErrorBox message={mockAdminErrorMessage(taskQ.error)} />

  const task = taskQ.data

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold text-text-primary truncate">{task.title}</h3>
        <span className="font-mono text-[10px] text-text-muted">{task.id}</span>
      </div>

      <div className="flex gap-1.5 border-b border-border">
        {(['body', 'reference', 'questions'] as EditorTab[]).map((t) => (
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
    </div>
  )
}

function BodyTab({ task }: { task: MockTask }) {
  const update = useUpdateTaskMutation()
  const strictness = useStrictnessQuery()
  const [title, setTitle] = useState(task.title)
  const [stage, setStage] = useState<StageKind>(task.stage_kind)
  const [language, setLanguage] = useState<TaskLanguage>(task.language)
  const [difficulty, setDifficulty] = useState(String(task.difficulty))
  const [bodyMd, setBodyMd] = useState(task.body_md ?? '')
  const [sampleIo, setSampleIo] = useState(task.sample_io_md ?? '')
  const [funcReq, setFuncReq] = useState(task.functional_requirements_md ?? '')
  const [timeLimit, setTimeLimit] = useState(task.time_limit_min ? String(task.time_limit_min) : '')
  const [strictnessId, setStrictnessId] = useState(task.ai_strictness_profile_id ?? '')
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
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
        },
      })
    } catch (e) {
      setErr(mockAdminErrorMessage(e))
    }
  }

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

      <div className="grid gap-3 sm:grid-cols-2">
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
