import { useState } from 'react';
import type { TaskCard, TaskKind } from '../../api/tasks';
import { TaskCardView } from './TaskCardView';
import type { ColumnDef } from './lib/columns';

interface ColumnProps {
  col: ColumnDef;
  tasks: TaskCard[];
  onDropTask: (taskId: string) => void;
  onCardClick: (id: string) => void;
  onCtxMenu: (e: React.MouseEvent, id: string) => void;
  onOpenKindPicker: (taskId: string, current: TaskKind, x: number, y: number) => void;
}

export function Column({ col, tasks, onDropTask, onCardClick, onCtxMenu, onOpenKindPicker }: ColumnProps): JSX.Element {
  const [over, setOver] = useState(false);
  return (
    <section
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => {
        // Only clear if leaving the column entirely (not entering a child).
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/task-id');
        if (id) onDropTask(id);
      }}
      style={{
        background: over ? 'var(--surface-2)' : 'var(--surface)',
        // Polish — 1.5px red stripe (#FF3B30) along top edge when dragOver.
        // Conforms feedback_color_rule.md: red as a stripe, not bg.
        borderTop: over ? '1.5px solid #FF3B30' : '1px solid rgba(255,255,255,0.045)',
        borderRight: `1px solid ${over ? 'var(--ink-20)' : 'rgba(255,255,255,0.045)'}`,
        borderBottom: `1px solid ${over ? 'var(--ink-20)' : 'rgba(255,255,255,0.045)'}`,
        borderLeft: `1px solid ${over ? 'var(--ink-20)' : 'rgba(255,255,255,0.045)'}`,
        borderRadius: 10, display: 'flex', flexDirection: 'column',
        minHeight: 380, transition: 'background-color var(--motion-dur-medium) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard)',
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
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-60)' }}>
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
            <TaskCardView
              key={t.id}
              task={t}
              onClick={() => onCardClick(t.id)}
              onCtxMenu={(e) => onCtxMenu(e, t.id)}
              onOpenKindPicker={onOpenKindPicker}
            />
          ))
        )}
      </div>
    </section>
  );
}
