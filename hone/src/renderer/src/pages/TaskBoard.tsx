// TaskBoard — Notion-style kanban that replaces the legacy Today page.
//
// 4 columns: To-do / In progress / In review / Done. Cards are dragged
// with native HTML5 DnD; "Start" / "Submit for review" / "Mark done"
// buttons cover keyboard / touch users. The AI cursor SSE stream is
// rendered as an overlay (<AICursor>) so settle/regress feel "live".
//
// Source of truth is the backend GET /api/v1/hone/tasks; we re-fetch on
// every status change so the optimistic update is reconciled with what
// the coach listener may have done in parallel.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listTasks,
  createTask,
  moveTaskStatus,
  deleteTask,
  subscribeCursorEvents,
  type TaskCard,
  type TaskKind,
  type TaskStatus,
  type CursorEvent,
} from '../api/tasks';
import { AICursor } from '../components/AICursor';
import { useSessionStore } from '../stores/session';

const COLUMNS: ReadonlyArray<{ status: TaskStatus; label: string; accent: string }> = [
  { status: 'todo', label: 'To-do', accent: '#a78bfa' },
  { status: 'in_progress', label: 'In progress', accent: '#f59e0b' },
  { status: 'in_review', label: 'In review', accent: '#06b6d4' },
  { status: 'done', label: 'Complete', accent: '#22c55e' },
];

const KIND_GLYPH: Record<TaskKind, string> = {
  algo: '🧮',
  sysdesign: '🏛️',
  quiz: '❓',
  reflection: '📓',
  reading: '📖',
  custom: '✏️',
};

export function TaskBoardPage(): JSX.Element {
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [cursorEvents, setCursorEvents] = useState<CursorEvent[]>([]);
  const cursorEventsRef = useRef<CursorEvent[]>([]);

  const accessToken = useSessionStore((s) => s.accessToken);

  const refresh = useCallback(async () => {
    try {
      const next = await listTasks();
      setTasks(next);
    } catch {
      /* network blip — keep stale list */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refetch whenever the AI cursor finished a sequence (card.move event).
  useEffect(() => {
    if (!accessToken) return;
    const close = subscribeCursorEvents(accessToken, (e) => {
      cursorEventsRef.current = [...cursorEventsRef.current, e].slice(-32);
      setCursorEvents(cursorEventsRef.current);
      if (e.kind === 'card.move') {
        // Slight debounce so the animation finishes before the data refetch.
        window.setTimeout(() => void refresh(), 600);
      }
    });
    return () => close();
  }, [accessToken, refresh]);

  const grouped = useMemo(() => {
    const m: Record<TaskStatus, TaskCard[]> = {
      todo: [], in_progress: [], in_review: [], done: [], dismissed: [],
    };
    for (const t of tasks) m[t.status]?.push(t);
    return m;
  }, [tasks]);

  const handleMove = async (taskId: string, status: TaskStatus): Promise<void> => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status } : t)),
    );
    try {
      await moveTaskStatus(taskId, status);
    } catch {
      void refresh();
    }
  };

  const handleDelete = async (taskId: string): Promise<void> => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    try {
      await deleteTask(taskId);
    } catch {
      void refresh();
    }
  };

  const handleCreate = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const title = draftTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      const c = await createTask({ kind: 'custom', title });
      setTasks((prev) => [c, ...prev]);
      setDraftTitle('');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="fadein"
      style={{ position: 'absolute', inset: 0, padding: '32px 40px', overflowY: 'auto' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
          TaskBoard
        </h1>
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8 }}>
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Add custom task…"
            disabled={creating}
            style={{
              padding: '8px 12px',
              fontSize: 13,
              border: '1px solid var(--ink-20)',
              borderRadius: 6,
              minWidth: 240,
              background: 'transparent',
              color: 'var(--ink)',
            }}
          />
          <button
            type="submit"
            disabled={creating || !draftTitle.trim()}
            style={{
              padding: '8px 14px',
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 6,
              border: '1px solid var(--ink-20)',
              background: 'var(--ink)',
              color: 'var(--bg)',
              cursor: creating || !draftTitle.trim() ? 'default' : 'pointer',
              opacity: creating || !draftTitle.trim() ? 0.5 : 1,
            }}
          >
            Add
          </button>
        </form>
      </div>

      {loading ? (
        <p style={{ color: 'var(--ink-40)' }}>Loading…</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 16,
            alignItems: 'start',
          }}
        >
          {COLUMNS.map((col) => (
            <Column
              key={col.status}
              label={col.label}
              accent={col.accent}
              status={col.status}
              tasks={grouped[col.status]}
              onMove={handleMove}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <AICursor events={cursorEvents} />
    </div>
  );
}

interface ColumnProps {
  label: string;
  accent: string;
  status: TaskStatus;
  tasks: TaskCard[];
  onMove: (taskId: string, status: TaskStatus) => void;
  onDelete: (taskId: string) => void;
}

function Column({ label, accent, status, tasks, onMove, onDelete }: ColumnProps): JSX.Element {
  const onDragOver = (e: React.DragEvent): void => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/task-id');
    if (taskId) onMove(taskId, status);
  };
  return (
    <section
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'var(--surface-1, rgba(255,255,255,0.02))',
        border: '1px solid var(--ink-20)',
        borderRadius: 10,
        padding: 12,
        minHeight: 200,
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{ width: 8, height: 8, borderRadius: '50%', background: accent }}
          aria-hidden
        />
        <strong style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {label}
        </strong>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-40)' }}>
          {tasks.length}
        </span>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {tasks.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--ink-40)', margin: '12px 4px' }}>—</p>
        ) : (
          tasks.map((t) => <TaskCardView key={t.id} task={t} onMove={onMove} onDelete={onDelete} />)
        )}
      </div>
    </section>
  );
}

interface TaskCardViewProps {
  task: TaskCard;
  onMove: (taskId: string, status: TaskStatus) => void;
  onDelete: (taskId: string) => void;
}

function TaskCardView({ task, onMove, onDelete }: TaskCardViewProps): JSX.Element {
  const onDragStart = (e: React.DragEvent): void => {
    e.dataTransfer.setData('text/task-id', task.id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const next: TaskStatus | null =
    task.status === 'todo'
      ? 'in_progress'
      : task.status === 'in_progress'
        ? 'in_review'
        : task.status === 'in_review'
          ? 'done'
          : null;
  return (
    <article
      data-task-id={task.id}
      draggable
      onDragStart={onDragStart}
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--ink-20)',
        borderRadius: 8,
        padding: '10px 12px',
        cursor: 'grab',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span aria-hidden style={{ fontSize: 13 }}>
          {KIND_GLYPH[task.kind]}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{task.title}</span>
      </div>
      {task.briefMd && (
        <p
          style={{
            margin: 0,
            fontSize: 11,
            color: 'var(--ink-60)',
            lineHeight: 1.4,
          }}
        >
          {task.briefMd}
        </p>
      )}
      {task.deepLink && (
        <a
          href={task.deepLink}
          style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-40)' }}
        >
          → solve
        </a>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        {next && (
          <button
            onClick={() => onMove(task.id, next)}
            style={{
              fontSize: 10,
              padding: '3px 8px',
              borderRadius: 4,
              border: '1px solid var(--ink-20)',
              background: 'transparent',
              color: 'var(--ink-60)',
              cursor: 'pointer',
            }}
          >
            {next === 'in_progress' ? 'Start' : next === 'in_review' ? 'Submit' : 'Done'}
          </button>
        )}
        <button
          onClick={() => onDelete(task.id)}
          style={{
            fontSize: 10,
            padding: '3px 8px',
            borderRadius: 4,
            border: '1px solid transparent',
            background: 'transparent',
            color: 'var(--ink-40)',
            marginLeft: 'auto',
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>
    </article>
  );
}
