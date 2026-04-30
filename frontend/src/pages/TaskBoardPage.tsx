// TaskBoardPage — dark Notion-style kanban для AI-coach задач.
// Натянуто на дизайн из /design/index.html, переведено на наши tailwind-токены
// (bg/surface-{1,2,3}/border/text-{primary,secondary,muted}). DnD, drawer
// с комментариями, context-menu, фильтры, footer с прогрессом — всё на месте.
// Modal создания переделан: компактный, без caps-labels, в стиле Linear.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  ArrowRight,
  Brain,
  BookOpen,
  Code2,
  CircleDashed,
  CircleCheck,
  CircleHelp,
  CircleX,
  Eye,
  GripVertical,
  Loader2,
  Network,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { AppShellV2 } from '../components/AppShell'
import { cn } from '../lib/cn'
import {
  useTaskListQuery,
  useMoveTaskStatusMutation,
  useDeleteTaskMutation,
  useTaskCommentsQuery,
  useAddTaskCommentMutation,
  useCreateTaskMutation,
  type Task,
  type TaskStatusCanonical,
  type TaskKindCanonical,
} from '../lib/queries/honeTasks'

// ── Config ─────────────────────────────────────────────────────────────

type ColumnDef = {
  id: TaskStatusCanonical
  name: string
  dotClass: string
  Icon: typeof CircleDashed
}

const COLS: ColumnDef[] = [
  { id: 'todo', name: 'To Do', dotClass: 'bg-violet-400 shadow-[0_0_5px] shadow-violet-400/80', Icon: CircleDashed },
  { id: 'in_progress', name: 'In Progress', dotClass: 'bg-orange-400 shadow-[0_0_5px] shadow-orange-400/80', Icon: Loader2 },
  { id: 'in_review', name: 'In Review', dotClass: 'bg-sky-400 shadow-[0_0_5px] shadow-sky-400/80', Icon: Eye },
  { id: 'done', name: 'Done', dotClass: 'bg-emerald-400 shadow-[0_0_5px] shadow-emerald-400/80', Icon: CircleCheck },
  { id: 'dismissed', name: 'Dismissed', dotClass: 'bg-neutral-500', Icon: CircleX },
]

type KindDef = {
  label: string
  text: string // text-* class for icon
  strip: string // bg-* class for left strip
  Icon: typeof Code2
}

const KINDS: Record<TaskKindCanonical, KindDef> = {
  algo: { label: 'Algorithm', text: 'text-violet-400', strip: 'bg-violet-400', Icon: Code2 },
  sysdesign: { label: 'System Design', text: 'text-cyan-400', strip: 'bg-cyan-400', Icon: Network },
  quiz: { label: 'Quiz', text: 'text-emerald-400', strip: 'bg-emerald-400', Icon: CircleHelp },
  reflection: { label: 'Reflection', text: 'text-amber-400', strip: 'bg-amber-400', Icon: Brain },
  reading: { label: 'Reading', text: 'text-slate-400', strip: 'bg-slate-400', Icon: BookOpen },
  custom: { label: 'Custom', text: 'text-neutral-400', strip: 'bg-neutral-500', Icon: Sparkles },
  unspecified: { label: '—', text: 'text-neutral-400', strip: 'bg-neutral-500', Icon: Sparkles },
}

type FilterMode = 'all' | 'ai' | 'my'

// ── Helpers ────────────────────────────────────────────────────────────

function relativeAge(iso: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diffMs = Date.now() - t
  const m = Math.floor(diffMs / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

function matchesFilter(t: Task, f: FilterMode): boolean {
  if (f === 'ai') return t.source === 'ai'
  if (f === 'my') return t.source === 'user'
  return true
}

// ── Page ───────────────────────────────────────────────────────────────

export default function TaskBoardPage() {
  const tasksQ = useTaskListQuery()
  const [filter, setFilter] = useState<FilterMode>('all')
  const [showDismissed, setShowDismissed] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [openTaskID, setOpenTaskID] = useState<string | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number; taskId: string } | null>(null)
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([])
  const toastIdRef = useRef(0)

  function toast(msg: string) {
    const id = ++toastIdRef.current
    setToasts((p) => [...p, { id, msg }])
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 2500)
  }

  // ESC closes all overlays
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setOpenTaskID(null)
      setCreateOpen(false)
      setCtx(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Click outside ctx menu
  useEffect(() => {
    if (!ctx) return
    function onClick() { setCtx(null) }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [ctx])

  const all = useMemo(() => tasksQ.data ?? [], [tasksQ.data])
  const filtered = useMemo(() => all.filter((t) => matchesFilter(t, filter)), [all, filter])
  const active = filtered.filter((t) => t.status !== 'dismissed').length

  const colsToShow = showDismissed ? COLS : COLS.filter((c) => c.id !== 'dismissed')
  const grouped = useMemo(() => {
    const out: Record<TaskStatusCanonical, Task[]> = {
      todo: [], in_progress: [], in_review: [], done: [], dismissed: [], unspecified: [],
    }
    for (const t of filtered) out[t.status]?.push(t)
    return out
  }, [filtered])

  const totalForProgress = filtered.filter((t) => t.status !== 'dismissed').length
  const doneCount = filtered.filter((t) => t.status === 'done').length
  const pct = totalForProgress ? Math.round((doneCount / totalForProgress) * 100) : 0

  const move = useMoveTaskStatusMutation()

  function onDropToColumn(taskId: string, status: TaskStatusCanonical) {
    const t = all.find((x) => x.id === taskId)
    if (!t || t.status === status) return
    move.mutate({ id: taskId, status })
    const col = COLS.find((c) => c.id === status)
    if (col) toast(`Moved to ${col.name}`)
  }

  return (
    <AppShellV2>
      <div className="mx-auto flex w-full max-w-[1440px] flex-col px-4 py-6 sm:px-8 lg:px-10">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <h1 className="text-[18px] font-bold tracking-tight text-text-primary">Your Tasks</h1>
            <span className="rounded-[10px] bg-surface-3 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-text-secondary">
              {active} active
            </span>
          </div>

          <nav className="hidden items-center gap-1 sm:flex">
            {(['all', 'ai', 'my'] as FilterMode[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-md px-3.5 py-1 text-xs font-medium tracking-wide transition-colors',
                  filter === f
                    ? 'bg-surface-3 text-text-primary'
                    : 'text-text-muted hover:bg-surface-2 hover:text-text-secondary',
                )}
              >
                {f === 'all' ? 'All' : f === 'ai' ? 'AI-only' : 'My-only'}
              </button>
            ))}
          </nav>

          <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-text-muted">
            <span>Show dismissed</span>
            <button
              type="button"
              onClick={() => setShowDismissed((v) => !v)}
              className={cn(
                'relative h-4 w-[30px] rounded-lg transition-colors',
                showDismissed ? 'bg-text-secondary' : 'bg-surface-3',
              )}
              aria-pressed={showDismissed}
            >
              <span
                className={cn(
                  'absolute top-[2px] h-3 w-3 rounded-full transition-all',
                  showDismissed ? 'left-[16px] bg-text-primary' : 'left-[2px] bg-text-muted',
                )}
              />
            </button>
          </label>
        </header>

        {/* States */}
        {tasksQ.isLoading && (
          <div className="flex flex-1 items-center justify-center py-20 text-text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {tasksQ.isError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-text-muted">
            <p className="text-sm text-danger">Не удалось загрузить задачи</p>
            <button
              onClick={() => tasksQ.refetch()}
              className="rounded-md border border-border bg-surface-2 px-3 py-1 text-xs hover:border-border-strong hover:text-text-secondary"
            >
              Повторить
            </button>
          </div>
        )}
        {!tasksQ.isLoading && !tasksQ.isError && filtered.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-text-muted">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2">
              <Sparkles className="h-5 w-5" />
            </div>
            <h2 className="text-base font-semibold text-text-secondary">No tasks yet</h2>
            <p className="max-w-[320px] text-center text-[13px] leading-relaxed">
              AI-coach анализирует твою активность и скоро предложит персональные задачи
            </p>
            <button
              onClick={() => setCreateOpen(true)}
              className="text-xs text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
            >
              Создать первую задачу
            </button>
          </div>
        )}

        {/* Board */}
        {!tasksQ.isLoading && !tasksQ.isError && filtered.length > 0 && (
          <div
            className={cn(
              'grid flex-1 gap-3 max-md:grid-cols-1 md:grid-cols-2',
              showDismissed ? 'lg:grid-cols-5' : 'lg:grid-cols-4',
            )}
          >
            {colsToShow.map((c) => (
              <Column
                key={c.id}
                col={c}
                tasks={grouped[c.id] ?? []}
                onDropTask={(id) => onDropToColumn(id, c.id)}
                onCardClick={(id) => setOpenTaskID(id)}
                onCtxMenu={(e, id) => {
                  e.preventDefault()
                  setCtx({ x: e.clientX, y: e.clientY, taskId: id })
                }}
              />
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-5 flex items-center gap-4 border-t border-border pt-3.5">
          <Clock />
          <div className="h-[2px] flex-1 overflow-hidden rounded-sm bg-surface-3">
            <div
              className="h-full rounded-sm bg-text-secondary transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[11px] tabular-nums text-text-muted">{pct}%</span>
        </div>
      </div>

      {/* FAB */}
      <button
        onClick={() => setCreateOpen(true)}
        aria-label="Add task"
        className="fixed bottom-7 right-7 z-30 flex h-11 w-11 items-center justify-center rounded-xl bg-text-primary text-bg shadow-[0_4px_20px_rgba(0,0,0,0.4)] transition-all hover:-translate-y-0.5 hover:scale-[1.04] hover:shadow-[0_6px_28px_rgba(0,0,0,0.5)] active:translate-y-0 active:scale-[0.98]"
      >
        <Plus className="h-[18px] w-[18px]" />
      </button>

      {/* Context menu */}
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          task={all.find((t) => t.id === ctx.taskId)}
          onClose={() => setCtx(null)}
          onMove={(status) => {
            onDropToColumn(ctx.taskId, status)
            setCtx(null)
          }}
          toast={toast}
        />
      )}

      {/* Drawer */}
      {openTaskID && (
        <TaskDrawer
          taskID={openTaskID}
          task={all.find((t) => t.id === openTaskID)}
          onClose={() => setOpenTaskID(null)}
        />
      )}

      {/* Modal */}
      {createOpen && (
        <CreateTaskModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => toast('Task created')}
        />
      )}

      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-20 right-7 z-40 flex flex-col gap-1.5">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="rounded-md border border-border-strong bg-surface-2 px-3.5 py-2 text-xs text-text-secondary shadow-[0_4px_12px_rgba(0,0,0,0.3)]"
          >
            {t.msg}
          </div>
        ))}
      </div>
    </AppShellV2>
  )
}

// ── Column ─────────────────────────────────────────────────────────────

function Column({
  col,
  tasks,
  onDropTask,
  onCardClick,
  onCtxMenu,
}: {
  col: ColumnDef
  tasks: Task[]
  onDropTask: (taskId: string) => void
  onCardClick: (id: string) => void
  onCtxMenu: (e: ReactMouseEvent, id: string) => void
}) {
  const [over, setOver] = useState(false)

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    setOver(true)
  }
  function onDrop(e: DragEvent) {
    e.preventDefault()
    setOver(false)
    const id = e.dataTransfer.getData('text/plain')
    if (id) onDropTask(id)
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'flex min-h-[380px] flex-col rounded-[10px] border bg-surface-1 transition-colors',
        over ? 'border-border-strong bg-surface-2' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5">
        <div className="flex items-center gap-2">
          <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', col.dotClass)} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
            {col.name}
          </span>
        </div>
        <span className="text-[11px] tabular-nums text-text-muted">{tasks.length}</span>
      </div>

      <div className="scroll-thin flex flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
        {tasks.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-6 text-[11px] text-text-muted opacity-50">
            <col.Icon className="h-[18px] w-[18px]" />
            <span>Drop tasks here</span>
          </div>
        ) : (
          tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              onClick={() => onCardClick(t.id)}
              onCtxMenu={(e) => onCtxMenu(e, t.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Card ───────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onClick,
  onCtxMenu,
}: {
  task: Task
  onClick: () => void
  onCtxMenu: (e: ReactMouseEvent) => void
}) {
  const [dragging, setDragging] = useState(false)
  const k = KINDS[task.kind]
  const KIcon = k.Icon
  const aiPulse = task.status === 'in_review' && task.source === 'ai'

  function onDragStart(e: DragEvent) {
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
    setDragging(true)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragEnd={() => setDragging(false)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-stop]')) return
        onClick()
      }}
      onContextMenu={onCtxMenu}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick() }}
      className={cn(
        'group relative flex cursor-grab rounded-[7px] bg-surface-2 transition-all duration-150 hover:-translate-y-px hover:bg-surface-3 hover:shadow-[0_2px_12px_rgba(0,0,0,0.25)] active:cursor-grabbing animate-in fade-in slide-in-from-top-1',
        dragging && 'scale-[0.97] opacity-35',
      )}
    >
      <div className={cn('w-[3px] rounded-l-[7px] shrink-0', k.strip)} />
      <div className="min-w-0 flex-1 px-3 py-2.5">
        <div className="mb-1 flex items-start gap-1.5">
          <span className="line-clamp-2 flex-1 text-[13px] font-semibold leading-tight text-text-primary">
            {task.title}
          </span>
          <KIcon className={cn('mt-0.5 h-2.5 w-2.5 shrink-0 opacity-70', k.text)} />
          <GripVertical className="mt-0.5 h-2.5 w-2.5 shrink-0 cursor-grab text-text-muted opacity-0 transition-opacity group-hover:opacity-70" />
        </div>
        {task.briefMd && (
          <p className="mb-2 line-clamp-3 text-[11px] leading-snug text-text-muted">{task.briefMd}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {task.skillKey && (
            <span className="rounded-[3px] bg-border-strong px-1.5 py-px text-[9px] font-semibold tracking-wide text-text-secondary">
              {task.skillKey}
            </span>
          )}
          {task.priority > 0 && (
            <div className="flex items-center gap-0.5">
              {Array.from({ length: Math.min(task.priority, 3) }).map((_, i) => (
                <span key={i} className="h-1 w-1 rounded-full bg-text-muted" />
              ))}
            </div>
          )}
          <span className="text-[10px] text-text-muted">{relativeAge(task.createdAt)}</span>
          {task.source === 'ai' ? (
            <span className="rounded-[3px] bg-violet-400/[0.12] px-1.5 py-px text-[8px] font-bold tracking-wider text-violet-400">
              AI
            </span>
          ) : (
            <span className="text-[10px] text-text-muted">you</span>
          )}
          {task.deepLink && (
            <button
              data-stop
              onClick={() => { window.open(task.deepLink, '_blank') }}
              title="Open"
              className="ml-auto flex h-5 w-5 items-center justify-center rounded text-text-muted opacity-0 transition-all hover:bg-text-primary hover:text-bg group-hover:opacity-100"
            >
              <ArrowRight className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      </div>
      {aiPulse && (
        <span className="pointer-events-none absolute inset-0 rounded-[7px] bg-sky-400 opacity-[0.04] motion-safe:animate-pulse" />
      )}
    </div>
  )
}

// ── Context Menu ───────────────────────────────────────────────────────

function ContextMenu({
  x,
  y,
  task,
  onClose,
  onMove,
  toast,
}: {
  x: number
  y: number
  task: Task | undefined
  onClose: () => void
  onMove: (s: TaskStatusCanonical) => void
  toast: (msg: string) => void
}) {
  const del = useDeleteTaskMutation()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useEffect(() => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    let nx = x, ny = y
    if (r.right > window.innerWidth) nx = x - r.width
    if (r.bottom > window.innerHeight) ny = y - r.height
    setPos({ x: nx, y: ny })
  }, [x, y])

  if (!task) return null

  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[300] min-w-[180px] animate-in fade-in zoom-in-95 rounded-lg border border-border-strong bg-surface-2 p-1 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
    >
      {COLS.filter((c) => c.id !== task.status).map((c) => {
        const Icon = c.Icon
        return (
          <button
            key={c.id}
            onClick={() => onMove(c.id)}
            className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-3 hover:text-text-primary"
          >
            <Icon className="h-3 w-3 text-text-muted" />
            Move to {c.name}
          </button>
        )
      })}
      <div className="my-1 mx-2 h-px bg-border" />
      <button
        onClick={() => {
          if (confirm('Удалить задачу?')) {
            del.mutate(task.id)
            toast('Task deleted')
            onClose()
          }
        }}
        className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 className="h-3 w-3" />
        Delete
      </button>
    </div>
  )
}

// ── Clock ──────────────────────────────────────────────────────────────

function Clock() {
  const [t, setT] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="min-w-[56px] text-xs tabular-nums text-text-muted">
      {String(t.getHours()).padStart(2, '0')}:{String(t.getMinutes()).padStart(2, '0')}
    </span>
  )
}

// ── Drawer ─────────────────────────────────────────────────────────────

function TaskDrawer({
  taskID,
  task,
  onClose,
}: {
  taskID: string
  task: Task | undefined
  onClose: () => void
}) {
  const commentsQ = useTaskCommentsQuery(taskID)
  const add = useAddTaskCommentMutation()
  const [body, setBody] = useState('')

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    add.mutate({ taskId: taskID, bodyMd: body }, { onSuccess: () => setBody('') })
  }

  if (!task) return null
  const k = KINDS[task.kind]
  const c = COLS.find((x) => x.id === task.status)

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[400] bg-black/50 transition-opacity"
      />
      <aside className="fixed right-0 top-0 z-[401] flex h-screen w-[420px] max-w-full flex-col border-l border-border bg-surface-1 transition-transform">
        <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <span className="text-xs font-semibold text-text-secondary">{c?.name ?? ''}</span>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-5">
          <div className={cn('mb-3 h-1 w-8 rounded-sm', k.strip)} />
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            {k.label}
          </div>
          <h2 className="mb-4 text-[17px] font-bold leading-tight tracking-tight text-text-primary">
            {task.title}
          </h2>

          <div className="mb-5 flex flex-wrap gap-2 text-[11px] text-text-muted">
            <Meta label="Status" value={c?.name ?? ''} />
            {task.priority > 0 && (
              <Meta
                label="Priority"
                value={
                  <span className="inline-flex items-center gap-0.5 align-middle">
                    {Array.from({ length: Math.min(task.priority, 3) }).map((_, i) => (
                      <span key={i} className="h-1 w-1 rounded-full bg-text-muted" />
                    ))}
                  </span>
                }
              />
            )}
            <Meta label="Created" value={`${relativeAge(task.createdAt)} ago`} />
            <Meta label="Source" value={task.source === 'ai' ? 'AI Coach' : 'You'} />
            {task.skillKey && (
              <Meta
                label="Skill"
                value={
                  <span className="rounded-[3px] bg-border-strong px-1.5 py-px text-[9px] font-semibold text-text-secondary">
                    {task.skillKey}
                  </span>
                }
              />
            )}
          </div>

          <div className="my-4 h-px bg-border" />

          {task.briefMd && (
            <p className="mb-1 whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary">
              {task.briefMd}
            </p>
          )}

          {task.deepLink && (
            <a
              href={task.deepLink}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
            >
              Open <ArrowRight className="h-3 w-3" />
            </a>
          )}

          <div className="my-4 h-px bg-border" />

          <div className="mb-3 text-xs font-semibold text-text-secondary">
            Comments {(commentsQ.data ?? []).length}
          </div>

          {commentsQ.isLoading && (
            <Loader2 className="mx-auto my-3 h-4 w-4 animate-spin text-text-muted" />
          )}

          {(commentsQ.data ?? []).map((cm) => (
            <div key={cm.id} className="mb-3.5 flex gap-2.5">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-3 text-[10px] text-text-muted">
                {cm.authorKind === 'ai' ? '🤖' : '👤'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 text-[11px] font-semibold text-text-secondary">
                  {cm.authorKind === 'ai' ? 'AI Coach' : 'You'}
                  <time className="ml-1.5 font-normal text-text-muted">
                    {cm.createdAt.slice(0, 10)}
                  </time>
                </div>
                <div className="whitespace-pre-wrap text-xs leading-snug text-text-secondary">
                  {cm.bodyMd}
                </div>
              </div>
            </div>
          ))}

          {!commentsQ.isLoading && (commentsQ.data ?? []).length === 0 && (
            <p className="py-3 text-center text-xs text-text-muted">Комментариев пока нет</p>
          )}

          <form onSubmit={onSubmit} className="mt-2 flex gap-2">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add a comment..."
              className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-border-strong"
            />
            <button
              type="submit"
              disabled={!body.trim() || add.isPending}
              className="rounded-md border border-border bg-surface-3 px-3.5 py-2 text-[11px] font-medium text-text-secondary transition-all hover:border-border-strong hover:bg-border-strong hover:text-text-primary disabled:opacity-50"
            >
              {add.isPending ? '…' : 'Send'}
            </button>
          </form>
        </div>
      </aside>
    </>
  )
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 text-[11px]">
      <span className="text-text-muted">{label}:</span>
      <span className="text-text-secondary">{value}</span>
    </div>
  )
}

// ── Create Task Modal — Linear-стиль, компактный ───────────────────────

const CREATE_KINDS: TaskKindCanonical[] = ['algo', 'sysdesign', 'quiz', 'reflection', 'reading', 'custom']

function CreateTaskModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const create = useCreateTaskMutation()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<TaskKindCanonical>('custom')
  const [priority, setPriority] = useState(2)
  const [briefMd, setBriefMd] = useState('')
  const [skillKey, setSkillKey] = useState('')
  const [showMore, setShowMore] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    create.mutate(
      { kind, title: title.trim(), briefMd, skillKey: skillKey || undefined },
      {
        onSuccess: () => {
          onCreated()
          onClose()
        },
      },
    )
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      className="fixed inset-0 z-[500] flex items-start justify-center bg-black/55 px-4 pt-[15vh] backdrop-blur-sm animate-in fade-in"
    >
      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-[520px] flex-col gap-3 rounded-xl border border-border-strong bg-surface-1 p-4 shadow-[0_24px_48px_rgba(0,0,0,0.5)] animate-in zoom-in-95 fade-in"
      >
        {/* Title — большой inline-input, без label */}
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Что нужно сделать?"
          required
          className="w-full bg-transparent text-base font-semibold text-text-primary placeholder:text-text-muted focus:outline-none"
        />

        {/* Brief — auto-grow textarea, тоже без label */}
        <textarea
          value={briefMd}
          onChange={(e) => setBriefMd(e.target.value)}
          placeholder="Описание (опционально)"
          rows={2}
          className="w-full resize-none bg-transparent text-sm leading-relaxed text-text-secondary placeholder:text-text-muted focus:outline-none"
        />

        {/* Kind chips */}
        <div className="flex flex-wrap gap-1">
          {CREATE_KINDS.map((k) => {
            const def = KINDS[k]
            const Icon = def.Icon
            const active = kind === k
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                  active
                    ? 'border-border-strong bg-surface-3 text-text-primary'
                    : 'border-border bg-surface-2 text-text-muted hover:border-border-strong hover:text-text-secondary',
                )}
              >
                <Icon className={cn('h-3 w-3', active ? def.text : '')} />
                {def.label}
              </button>
            )
          })}
        </div>

        {/* Priority — три точки, кликабельные */}
        <div className="flex items-center gap-3 text-[11px] text-text-muted">
          <span>Priority</span>
          <div className="flex items-center gap-1">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPriority(n)}
                title={n === 1 ? 'Low' : n === 2 ? 'Medium' : 'High'}
                className={cn(
                  'h-1.5 w-1.5 rounded-full transition-colors',
                  n <= priority ? 'bg-text-primary' : 'bg-border-strong hover:bg-text-muted',
                )}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="ml-auto rounded text-[11px] text-text-muted hover:text-text-secondary"
          >
            {showMore ? 'Скрыть' : 'Дополнительно'}
          </button>
        </div>

        {showMore && (
          <input
            value={skillKey}
            onChange={(e) => setSkillKey(e.target.value)}
            placeholder="Skill tag (например, Binary Search)"
            className="w-full rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-border-strong"
          />
        )}

        {create.isError && (
          <p className="text-[11px] text-danger">Не удалось создать. Попробуй ещё раз.</p>
        )}

        <div className="mt-1 flex items-center justify-between border-t border-border pt-3">
          <span className="text-[10px] text-text-muted">
            ⌘↵ — отправить · Esc — закрыть
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!title.trim() || create.isPending}
              className="rounded-md bg-text-primary px-4 py-1.5 text-xs font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {create.isPending ? 'Создаём…' : 'Создать'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

