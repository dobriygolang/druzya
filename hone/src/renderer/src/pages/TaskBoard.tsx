// TaskBoard — Notion-style kanban в Hone (electron renderer).
//
// Дизайн натянут с design/index.html: цветной strip per-kind, kind-icon,
// priority dots, age, AI/user badge, side-drawer с комментариями,
// context-menu по правому клику, FAB → modal (Linear-стиль), footer с
// прогрессом и часами. Цвета через --ink/--bg/--surface CSS-vars.
//
// Топ-паддинг 64px чтобы под traffic-lights / draggable header не
// уезжали title и FAB.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  listTasks,
  createTask,
  moveTaskStatus,
  deleteTask,
  listTaskComments,
  addTaskComment,
  subscribeCursorEvents,
  type TaskCard,
  type TaskComment,
  type TaskKind,
  type TaskStatus,
  type CursorEvent,
} from '../api/tasks';
import { AICursor } from '../components/AICursor';
import { useSessionStore } from '../stores/session';
import { useTrackStore } from '../stores/track';

// ── Config ─────────────────────────────────────────────────────────────

interface ColumnDef {
  status: TaskStatus;
  label: string;
  accent: string;
}

// B/W only per feedback_color_rule.md — accent через opacity-стратификацию,
// не цветами. Активные columns — высокий contrast, dismissed — приглушённый.
const COLUMNS: ReadonlyArray<ColumnDef> = [
  { status: 'todo', label: 'To Do', accent: 'rgba(255,255,255,0.85)' },
  { status: 'in_progress', label: 'In Progress', accent: 'rgba(255,255,255,0.7)' },
  { status: 'in_review', label: 'In Review', accent: 'rgba(255,255,255,0.55)' },
  { status: 'done', label: 'Done', accent: 'rgba(255,255,255,0.4)' },
  { status: 'dismissed', label: 'Dismissed', accent: 'rgba(255,255,255,0.2)' },
];

interface KindDef {
  label: string;
  color: string;
  // SVG path (24x24, stroke-based, lucide-style). Single path keeps card-icon
  // rendering cheap and consistent с минимализмом hone.
  path: string;
}

// B/W rule: kind taxonomy несётся иконкой + label, цвет нулевой (ink-ramp).
// Identity: technical, no gamification — kanban не должен выглядеть как
// radio-color-coded.
const KINDS: Record<TaskKind, KindDef> = {
  algo:      { label: 'Algorithm',     color: 'rgba(255,255,255,0.65)', path: 'M16 18l6-6-6-6 M8 6l-6 6 6 6 M14.5 4l-5 16' },
  sysdesign: { label: 'System Design', color: 'rgba(255,255,255,0.55)', path: 'M9 19v-3 M15 19v-3 M9 8V5 M15 8V5 M5 11h14 M5 11v3a2 2 0 002 2h10a2 2 0 002-2v-3 M7 5h10' },
  quiz:      { label: 'Quiz',          color: 'rgba(255,255,255,0.75)', path: 'M12 22a10 10 0 100-20 10 10 0 000 20z M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3 M12 17h.01' },
  reflection:{ label: 'Reflection',    color: 'rgba(255,255,255,0.60)', path: 'M9.5 2A2.5 2.5 0 0112 4.5 2.5 2.5 0 0114.5 2 2.5 2.5 0 0117 4.5c0 .55-.18 1.06-.49 1.47A2.5 2.5 0 0118 8.5a2.5 2.5 0 01-1.5 2.29A2.5 2.5 0 0118 13.5a2.5 2.5 0 01-2.5 2.5h-.05A2.5 2.5 0 0113 18.5 2.5 2.5 0 0110.5 16H10A2.5 2.5 0 017.5 13.5 2.5 2.5 0 016 11 2.5 2.5 0 017.5 8.5 2.5 2.5 0 016 6 2.5 2.5 0 019.5 2z' },
  reading:   { label: 'Reading',       color: 'rgba(255,255,255,0.50)', path: 'M2 4h7a3 3 0 013 3v14a2 2 0 00-2-2H2V4z M22 4h-7a3 3 0 00-3 3v14a2 2 0 012-2h8V4z' },
  custom:    { label: 'Custom',        color: 'rgba(255,255,255,0.58)', path: 'M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z' },
};

// KindIcon — единая SVG-обёртка для всех мест где раньше был эмодзи.
function KindIcon({ kind, size = 14, color }: { kind: TaskKind; size?: number; color?: string }): JSX.Element {
  const def = KINDS[kind];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? def.color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <path d={def.path} />
    </svg>
  );
}

type TabKey = 'my' | 'week';

// ── Helpers ────────────────────────────────────────────────────────────

function relativeAge(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const m = Math.floor((Date.now() - t) / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── Page ───────────────────────────────────────────────────────────────

export function TaskBoardPage(): JSX.Element {
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('my');
  const [createOpen, setCreateOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; taskId: string } | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const toastRef = useRef(0);
  const cursorEventsRef = useRef<CursorEvent[]>([]);
  const [cursorEvents, setCursorEvents] = useState<CursorEvent[]>([]);
  const accessToken = useSessionStore((s) => s.accessToken);

  function toast(msg: string): void {
    const id = ++toastRef.current;
    setToasts((p) => [...p, { id, msg }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 2500);
  }

  const refresh = useCallback(async () => {
    try {
      setTasks(await listTasks());
    } catch {
      /* keep stale */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // ESC для закрытия оверлеев
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setOpenTaskId(null);
      setCreateOpen(false);
      setCtx(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Скрытие ctx-меню при клике вне
  useEffect(() => {
    if (!ctx) return;
    const onClick = (): void => setCtx(null);
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [ctx]);

  // SSE cursor stream
  useEffect(() => {
    if (!accessToken) return;
    const close = subscribeCursorEvents(accessToken, (e) => {
      cursorEventsRef.current = [...cursorEventsRef.current, e].slice(-32);
      setCursorEvents(cursorEventsRef.current);
      if (e.kind === 'card.move') window.setTimeout(() => void refresh(), 600);
    });
    return () => close();
  }, [accessToken, refresh]);

  // Active study mode filter — задачи с skill_key вне выбранного track'а
  // скрываем. Mode 'general' = passthrough.
  const itemMatchesActive = useTrackStore((s) => s.itemMatchesActive);
  const loadAtlasTracks = useTrackStore((s) => s.loadAtlasTracks);
  useEffect(() => {
    void loadAtlasTracks();
  }, [loadAtlasTracks]);

  // Filter pipeline
  const visibleTasks = useMemo(() => {
    let arr = tasks.filter((t) => itemMatchesActive(t.skillKey ?? ''));
    if (tab === 'week') {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      arr = arr.filter((t) => {
        const ts = Date.parse(t.updatedAt || t.createdAt);
        return Number.isFinite(ts) && ts >= cutoff;
      });
    }
    return arr;
  }, [tasks, tab, itemMatchesActive]);

  const colsToShow = COLUMNS.filter((c) => c.status !== 'dismissed');

  const grouped = useMemo(() => {
    const m: Record<TaskStatus, TaskCard[]> = {
      todo: [], in_progress: [], in_review: [], done: [], dismissed: [],
    };
    for (const t of visibleTasks) m[t.status]?.push(t);
    return m;
  }, [visibleTasks]);

  async function handleMove(taskId: string, status: TaskStatus): Promise<void> {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
    try {
      await moveTaskStatus(taskId, status);
      const col = COLUMNS.find((c) => c.status === status);
      if (col) toast(`Moved to ${col.label}`);
    } catch {
      void refresh();
    }
  }

  async function handleDelete(taskId: string): Promise<void> {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    try {
      await deleteTask(taskId);
      toast('Task deleted');
    } catch {
      void refresh();
    }
  }

  async function handleCreate(input: {
    kind: TaskKind;
    title: string;
    briefMd: string;
    skillKey: string;
    priority: number;
  }): Promise<void> {
    try {
      const c = await createTask({
        kind: input.kind,
        title: input.title,
        briefMd: input.briefMd || undefined,
        skillKey: input.skillKey || undefined,
      });
      setTasks((prev) => [c, ...prev]);
      toast('Task created');
    } catch {
      toast('Failed to create');
    }
  }

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        padding: '64px 32px 28px', // 64px top — under draggable chrome / traffic lights
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header — минимальный, только tabs */}
      <header style={hdrStyle}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['my', 'week'] as TabKey[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                fontSize: 11, padding: '5px 12px', borderRadius: 6,
                border: '1px solid var(--ink-20)',
                background: tab === t ? 'var(--ink)' : 'transparent',
                color: tab === t ? 'var(--bg)' : 'var(--ink-60)',
                cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'uppercase',
                fontWeight: 500,
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {t === 'my' ? 'My' : 'This week'}
            </button>
          ))}
        </div>

      </header>

      {/* States */}
      {loading && (
        <p style={{ color: 'var(--ink-40)', textAlign: 'center', marginTop: 80 }}>Loading…</p>
      )}

      {!loading && visibleTasks.length === 0 && (
        <div style={emptyStyle}>
          <div style={emptyIconStyle}>✨</div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-60)', margin: 0 }}>
            No tasks yet
          </h2>
          <p style={{ fontSize: 13, maxWidth: 320, textAlign: 'center', lineHeight: 1.6, margin: 0 }}>
            AI-coach анализирует твою активность и скоро предложит персональные задачи
          </p>
          <button
            onClick={() => setCreateOpen(true)}
            style={{
              fontSize: 12, color: 'var(--ink-60)', cursor: 'pointer',
              textDecoration: 'underline', textUnderlineOffset: 2,
              background: 'none', border: 'none',
            }}
          >
            Создать первую задачу
          </button>
        </div>
      )}

      {/* Board */}
      {!loading && visibleTasks.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${colsToShow.length}, minmax(0, 1fr))`,
            gap: 12, flex: 1, alignItems: 'start', minHeight: 0,
          }}
        >
          {colsToShow.map((c) => (
            <Column
              key={c.status}
              col={c}
              tasks={grouped[c.status] ?? []}
              onDropTask={(id) => void handleMove(id, c.status)}
              onCardClick={(id) => setOpenTaskId(id)}
              onCtxMenu={(e, id) => {
                e.preventDefault();
                setCtx({ x: e.clientX, y: e.clientY, taskId: id });
              }}
            />
          ))}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setCreateOpen(true)}
        aria-label="Add task"
        style={{
          position: 'fixed', bottom: 28, right: 28, width: 44, height: 44, borderRadius: 12,
          background: 'var(--ink)', color: 'var(--bg)', border: 'none', fontSize: 22,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)', zIndex: 100, fontWeight: 300,
          lineHeight: 1, paddingBottom: 4,
        }}
      >
        +
      </button>

      {/* Toasts */}
      <div style={{ position: 'fixed', bottom: 80, right: 28, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 600, pointerEvents: 'none' }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              padding: '8px 14px', background: 'var(--surface-2)',
              border: '1px solid var(--ink-20)', borderRadius: 6,
              fontSize: 12, color: 'var(--ink-60)',
              animation: 'fadein 0.2s ease',
            }}
          >
            {t.msg}
          </div>
        ))}
      </div>

      {/* Context menu */}
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          task={tasks.find((t) => t.id === ctx.taskId)}
          onMove={(s) => { void handleMove(ctx.taskId, s); setCtx(null); }}
          onDelete={() => { void handleDelete(ctx.taskId); setCtx(null); }}
          onClose={() => setCtx(null)}
        />
      )}

      {/* Drawer */}
      {openTaskId && (
        <TaskDrawer
          taskId={openTaskId}
          task={tasks.find((t) => t.id === openTaskId)}
          onClose={() => setOpenTaskId(null)}
        />
      )}

      {/* Modal */}
      {createOpen && (
        <CreateTaskModal
          onClose={() => setCreateOpen(false)}
          onSubmit={async (input) => {
            await handleCreate(input);
            setCreateOpen(false);
          }}
        />
      )}

      <AICursor events={cursorEvents} />
    </div>
  );
}

// ── Styles (объекты вынесены, чтобы JSX был читаемее) ──────────────────

const hdrStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  marginBottom: 24, flexWrap: 'wrap', gap: 12,
};

const emptyStyle: CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', gap: 16,
  color: 'var(--ink-40)', padding: '80px 0',
};

const emptyIconStyle: CSSProperties = {
  width: 56, height: 56, borderRadius: 14, background: 'var(--surface-2)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
};


// ── Column ─────────────────────────────────────────────────────────────

interface ColumnProps {
  col: ColumnDef;
  tasks: TaskCard[];
  onDropTask: (taskId: string) => void;
  onCardClick: (id: string) => void;
  onCtxMenu: (e: React.MouseEvent, id: string) => void;
}

function Column({ col, tasks, onDropTask, onCardClick, onCtxMenu }: ColumnProps): JSX.Element {
  const [over, setOver] = useState(false);
  return (
    <section
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/task-id');
        if (id) onDropTask(id);
      }}
      style={{
        background: over ? 'var(--surface-2)' : 'var(--surface)',
        border: `1px solid ${over ? 'var(--ink-20)' : 'rgba(255,255,255,0.045)'}`,
        borderRadius: 10, display: 'flex', flexDirection: 'column',
        minHeight: 380, transition: 'background 0.2s',
      }}
    >
      <header style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 7, height: 7, borderRadius: '50%', background: col.accent,
              boxShadow: `0 0 5px ${col.accent}`, flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--ink-60)' }}>
            {col.label}
          </span>
        </div>
        <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-40)' }}>
          {tasks.length}
        </span>
      </header>
      <div style={{ flex: 1, padding: '4px 8px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {tasks.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-40)', fontSize: 11, opacity: 0.45, padding: '24px 0' }}>
            —
          </div>
        ) : (
          tasks.map((t) => (
            <TaskCardView key={t.id} task={t} onClick={() => onCardClick(t.id)} onCtxMenu={(e) => onCtxMenu(e, t.id)} />
          ))
        )}
      </div>
    </section>
  );
}

// ── Card ───────────────────────────────────────────────────────────────

interface TaskCardViewProps {
  task: TaskCard;
  onClick: () => void;
  onCtxMenu: (e: React.MouseEvent) => void;
}

function TaskCardView({ task, onClick, onCtxMenu }: TaskCardViewProps): JSX.Element {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const k = KINDS[task.kind];
  const aiPulse = task.status === 'in_review' && task.source === 'ai';

  return (
    <article
      // data-task-id — anchor для AICursor overlay'а: компонент ищет
      // карточку через document.querySelector('[data-task-id="..."]')
      // и центрирует курсор в её bounding-box. Без этого атрибута SSE
      // сработает (event придёт), но визуально курсор не переместится.
      data-task-id={task.id}
      draggable
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/task-id', task.id);
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-stop]')) return;
        onClick();
      }}
      onContextMenu={onCtxMenu}
      style={{
        display: 'flex', borderRadius: 7,
        background: hover ? 'var(--surface-2)' : 'rgba(255,255,255,0.025)',
        cursor: dragging ? 'grabbing' : 'grab',
        position: 'relative',
        opacity: dragging ? 0.35 : 1,
        transform: dragging ? 'scale(0.97)' : hover ? 'translateY(-1px)' : 'none',
        boxShadow: hover ? '0 2px 12px rgba(0,0,0,0.25)' : 'none',
        transition: 'background 0.15s, box-shadow 0.2s, transform 0.2s',
      }}
    >
      <span style={{ width: 3, borderRadius: '7px 0 0 7px', flexShrink: 0, background: k.color }} />
      <div style={{ flex: 1, padding: '10px 12px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, lineHeight: 1.4, color: 'var(--ink)' }}>
            {task.title}
          </span>
          <span style={{ marginTop: 1, opacity: 0.8, display: 'inline-flex' }}>
            <KindIcon kind={task.kind} size={12} />
          </span>
        </div>
        {task.briefMd && (
          <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: 'var(--ink-40)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: 8 }}>
            {task.briefMd}
          </p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {task.skillKey && (
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.3px', padding: '1px 6px', borderRadius: 3, background: 'rgba(255,255,255,0.06)', color: 'var(--ink-60)' }}>
              {task.skillKey}
            </span>
          )}
          {task.priority > 0 && (
            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              {Array.from({ length: Math.min(task.priority, 3) }).map((_, i) => (
                <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--ink-40)' }} />
              ))}
            </div>
          )}
          <span style={{ fontSize: 10, color: 'var(--ink-40)' }}>{relativeAge(task.createdAt)}</span>
          {task.source === 'ai' ? (
            <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.4px', padding: '1px 5px', borderRadius: 3, background: 'rgba(255,255,255,0.10)', color: 'rgb(var(--ink))' }}>
              AI
            </span>
          ) : (
            <span style={{ fontSize: 10, color: 'var(--ink-40)' }}>you</span>
          )}
          {task.deepLink && (
            <button
              data-stop
              onClick={() => window.open(task.deepLink, '_blank')}
              title="Open"
              style={{
                marginLeft: 'auto', width: 22, height: 22, borderRadius: 5, border: 'none',
                background: 'rgba(255,255,255,0.06)', color: 'var(--ink-40)',
                fontSize: 10, cursor: 'pointer', opacity: hover ? 1 : 0,
                transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              →
            </button>
          )}
        </div>
      </div>
      {aiPulse && (
        <span
          style={{
            position: 'absolute', inset: 0, borderRadius: 7, pointerEvents: 'none',
            animation: 'aiPulseHone 2.5s ease-in-out infinite',
          }}
        />
      )}
      <style>{`@keyframes aiPulseHone {
        0%, 100% { background: rgba(56,189,248,0); }
        50% { background: rgba(56,189,248,0.04); }
      }`}</style>
    </article>
  );
}

// ── Context Menu ───────────────────────────────────────────────────────

interface ContextMenuProps {
  x: number;
  y: number;
  task: TaskCard | undefined;
  onMove: (s: TaskStatus) => void;
  onDelete: () => void;
  onClose: () => void;
}

function ContextMenu({ x, y, task, onMove, onDelete }: ContextMenuProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let nx = x, ny = y;
    if (r.right > window.innerWidth) nx = x - r.width;
    if (r.bottom > window.innerHeight) ny = y - r.height;
    setPos({ x: nx, y: ny });
  }, [x, y]);

  if (!task) return null;
  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 300,
        background: 'var(--surface-2)', border: '1px solid var(--ink-20)',
        borderRadius: 8, padding: 4, minWidth: 180,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)', animation: 'fadein 0.12s ease',
      }}
    >
      {COLUMNS.filter((c) => c.status !== task.status).map((c) => (
        <button key={c.status} onClick={() => onMove(c.status)} style={ctxBtnStyle}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.accent, marginRight: 4 }} />
          Move to {c.label}
        </button>
      ))}
      <div style={{ height: 1, background: 'var(--ink-20)', margin: '4px 8px' }} />
      <button
        onClick={() => { if (confirm('Удалить задачу?')) onDelete(); }}
        style={{ ...ctxBtnStyle, color: '#ff5555' }}
      >
        🗑 Delete
      </button>
    </div>
  );
}

const ctxBtnStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
  fontSize: 12, color: 'var(--ink-60)', cursor: 'pointer', borderRadius: 5,
  border: 'none', background: 'none', width: '100%', fontFamily: 'inherit',
  textAlign: 'left',
};

// ── Drawer ─────────────────────────────────────────────────────────────

interface TaskDrawerProps {
  taskId: string;
  task: TaskCard | undefined;
  onClose: () => void;
}

function TaskDrawer({ taskId, task, onClose }: TaskDrawerProps): JSX.Element | null {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    void listTaskComments(taskId).then((c) => { if (alive) setComments(c); }).catch(() => {});
    return () => { alive = false; };
  }, [taskId]);

  if (!task) return null;
  const k = KINDS[task.kind];
  const c = COLUMNS.find((x) => x.status === task.status);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    try {
      const created = await addTaskComment(taskId, body.trim());
      setComments((p) => [...p, created]);
      setBody('');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 400 }}
      />
      <aside
        style={{
          position: 'fixed', top: 0, right: 0, width: 420, maxWidth: '100vw', height: '100vh',
          background: 'var(--surface)', borderLeft: '1px solid var(--ink-20)', zIndex: 401,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'drawerIn 0.3s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        <header style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--ink-20)', flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-60)' }}>{c?.label ?? ''}</span>
          <button
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'none', color: 'var(--ink-40)', cursor: 'pointer', fontSize: 16 }}
          >
            ×
          </button>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <div style={{ width: 32, height: 4, borderRadius: 2, background: k.color, marginBottom: 12 }} />
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-40)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
            {k.label}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.35, marginBottom: 16, letterSpacing: '-0.2px' }}>
            {task.title}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            <Meta label="Status" value={c?.label ?? ''} />
            <Meta label="Created" value={`${relativeAge(task.createdAt)} ago`} />
            <Meta label="Source" value={task.source === 'ai' ? 'AI Coach' : 'You'} />
            {task.skillKey && <Meta label="Skill" value={task.skillKey} />}
          </div>

          <div style={{ height: 1, background: 'var(--ink-20)', margin: '16px 0' }} />

          {task.briefMd && (
            <p style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--ink-60)', margin: 0 }}>
              {task.briefMd}
            </p>
          )}

          {task.deepLink && (
            <a href={task.deepLink} style={{ display: 'inline-block', marginTop: 12, fontSize: 12, color: 'var(--ink-60)', textDecoration: 'underline' }}>
              Открыть →
            </a>
          )}

          <div style={{ height: 1, background: 'var(--ink-20)', margin: '16px 0' }} />
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-60)', marginBottom: 12 }}>
            Comments {comments.length}
          </div>

          {comments.map((cm) => (
            <div key={cm.id} style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--ink-40)', flexShrink: 0 }}>
                {cm.authorKind === 'ai' ? '🤖' : '👤'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-60)', marginBottom: 2 }}>
                  {cm.authorKind === 'ai' ? 'AI Coach' : 'Ты'}
                  <time style={{ fontWeight: 400, color: 'var(--ink-40)', marginLeft: 6 }}>
                    {cm.createdAt.slice(0, 10)}
                  </time>
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--ink-60)' }}>{cm.bodyMd}</div>
              </div>
            </div>
          ))}

          {comments.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--ink-40)', textAlign: 'center', padding: '12px 0' }}>
              Комментариев пока нет
            </p>
          )}

          <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add a comment..."
              style={{
                flex: 1, padding: '8px 12px', background: 'var(--surface-2)',
                border: '1px solid var(--ink-20)', borderRadius: 6, color: 'var(--ink)',
                fontFamily: 'inherit', fontSize: 12, outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={!body.trim() || sending}
              style={{
                padding: '8px 14px', background: 'var(--surface-2)',
                border: '1px solid var(--ink-20)', borderRadius: 6, color: 'var(--ink-60)',
                fontFamily: 'inherit', fontSize: 11, fontWeight: 500, cursor: 'pointer',
                opacity: !body.trim() || sending ? 0.5 : 1,
              }}
            >
              {sending ? '…' : 'Send'}
            </button>
          </form>
        </div>
      </aside>
      <style>{`@keyframes drawerIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={{ fontSize: 11, color: 'var(--ink-40)', display: 'flex', alignItems: 'center', gap: 4 }}>
      {label}: <span style={{ color: 'var(--ink-60)' }}>{value}</span>
    </div>
  );
}

// ── Modal: Linear-стиль, компактный ────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
  onSubmit: (input: { kind: TaskKind; title: string; briefMd: string; skillKey: string; priority: number }) => Promise<void>;
}

const CREATE_KINDS: TaskKind[] = ['algo', 'sysdesign', 'quiz', 'reflection', 'reading', 'custom'];

function CreateTaskModal({ onClose, onSubmit }: CreateModalProps): JSX.Element {
  const [title, setTitle] = useState('');
  const [briefMd, setBriefMd] = useState('');
  const [kind, setKind] = useState<TaskKind>('custom');
  const [priority, setPriority] = useState(2);
  const [skillKey, setSkillKey] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  // Exit-анимация: ставим closing=true, ждём пока CSS-keyframes доиграют,
  // потом дёргаем onClose у родителя — иначе компонент unmount'ится сразу
  // и анимацию никто не увидит.
  function startClose(): void {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 180);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({ kind, title: title.trim(), briefMd, skillKey, priority });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) startClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '15vh', paddingLeft: 16, paddingRight: 16,
        animation: closing ? 'modalOverlayOut 0.18s ease forwards' : 'modalOverlayIn 0.22s ease',
      }}
    >
      <form
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); startClose(); return; }
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { void submit(e); }
        }}
        style={{
          width: 520, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 12,
          background: 'var(--surface)', border: '1px solid var(--ink-20)',
          borderRadius: 12, padding: 18, boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
          animation: closing
            ? 'modalOut 0.18s cubic-bezier(0.4,0,0.2,1) forwards'
            : 'modalIn 0.26s cubic-bezier(0.16,1,0.3,1)',
          willChange: 'transform, opacity',
        }}
      >
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Что нужно сделать?"
          required
          style={{
            background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--ink)', fontSize: 16, fontWeight: 600,
            fontFamily: 'inherit', padding: 0,
          }}
        />
        <textarea
          value={briefMd}
          onChange={(e) => setBriefMd(e.target.value)}
          placeholder="Описание (опционально)"
          rows={2}
          style={{
            background: 'transparent', border: 'none', outline: 'none', resize: 'none',
            color: 'var(--ink-60)', fontSize: 14, lineHeight: 1.5,
            fontFamily: 'inherit', padding: 0,
          }}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {CREATE_KINDS.map((k) => {
            const def = KINDS[k];
            const on = kind === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className="tb-kind-chip"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 11px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                  border: `1px solid ${on ? 'var(--ink-20)' : 'rgba(255,255,255,0.045)'}`,
                  background: on ? 'var(--surface-2)' : 'transparent',
                  color: on ? 'var(--ink)' : 'var(--ink-40)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <KindIcon kind={k} size={13} color={on ? def.color : 'currentColor'} />
                {def.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--ink-40)' }}>
          <span>Priority</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPriority(n)}
                title={n === 1 ? 'Low' : n === 2 ? 'Medium' : 'High'}
                style={{
                  width: 6, height: 6, borderRadius: '50%', border: 'none',
                  background: n <= priority ? 'var(--ink)' : 'var(--ink-20)',
                  cursor: 'pointer', padding: 0,
                }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-40)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {showMore ? 'Скрыть' : 'Дополнительно'}
          </button>
        </div>

        {showMore && (
          <input
            value={skillKey}
            onChange={(e) => setSkillKey(e.target.value)}
            placeholder="Skill tag (например, Binary Search)"
            style={{
              padding: '7px 10px', background: 'var(--surface-2)',
              border: '1px solid var(--ink-20)', borderRadius: 6,
              color: 'var(--ink)', fontFamily: 'inherit', fontSize: 12, outline: 'none',
            }}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--ink-20)', paddingTop: 12, marginTop: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--ink-40)' }}>
            ⌘↵ — отправить · Esc — закрыть
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={startClose}
              className="tb-modal-btn-ghost"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!title.trim() || submitting}
              className="tb-modal-btn-primary"
            >
              {submitting ? 'Создаём…' : 'Создать'}
            </button>
          </div>
        </div>
      </form>
      <style>{`
        @keyframes modalOverlayIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modalOverlayOut { from { opacity: 1; } to { opacity: 0; } }
        @keyframes modalIn {
          from { opacity: 0; transform: translateY(-12px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes modalOut {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to { opacity: 0; transform: translateY(-8px) scale(0.97); }
        }
        .tb-modal-btn-ghost {
          padding: 7px 14px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          background: var(--surface-2);
          border: 1px solid var(--ink-20);
          color: var(--ink-60);
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
        }
        .tb-modal-btn-ghost:hover {
          background: rgba(255,255,255,0.05);
          color: var(--ink);
          border-color: var(--ink-40);
        }
        .tb-modal-btn-ghost:active { transform: scale(0.97); }
        .tb-modal-btn-primary {
          padding: 7px 18px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          background: var(--ink);
          color: var(--bg);
          border: none;
          cursor: pointer;
          font-family: inherit;
          transition: opacity 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
          box-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }
        .tb-modal-btn-primary:hover:not(:disabled) {
          opacity: 0.92;
          box-shadow: 0 4px 14px rgba(255,255,255,0.12);
          transform: translateY(-1px);
        }
        .tb-modal-btn-primary:active:not(:disabled) { transform: scale(0.97) translateY(0); }
        .tb-modal-btn-primary:disabled { opacity: 0.4; cursor: default; }
        .tb-kind-chip { transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.1s ease; }
        .tb-kind-chip:hover { border-color: var(--ink-20); color: var(--ink); }
        .tb-kind-chip:active { transform: scale(0.97); }
      `}</style>
    </div>
  );
}
