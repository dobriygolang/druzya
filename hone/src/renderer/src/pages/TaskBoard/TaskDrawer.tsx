import React, { useEffect, useState } from 'react';
import {
  listTaskComments,
  addTaskComment,
  type TaskCard,
  type TaskComment,
} from '../../api/tasks';
import { KINDS } from './lib/kinds';
import { COLUMNS } from './lib/columns';
import { relativeAge } from './lib/helpers';

interface TaskDrawerProps {
  taskId: string;
  task: TaskCard | undefined;
  onClose: () => void;
}

export function TaskDrawer({ taskId, task, onClose }: TaskDrawerProps): JSX.Element | null {
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
          animation: 'drawerIn var(--motion-dur-large) var(--motion-ease-emphasized)',
        }}
      >
        <header style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--ink-20)', flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-60)' }}>{c?.label ?? ''}</span>
          <button
            onClick={onClose}
            aria-label="Close task details"
            style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'none', color: 'var(--ink-40)', cursor: 'pointer', fontSize: 16 }}
          >
            ×
          </button>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <div style={{ width: 32, height: 4, borderRadius: 2, background: k.color, marginBottom: 12 }} />
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-40)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
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
