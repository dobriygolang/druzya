import { useEffect, useState } from 'react';

import { useT } from '@d9-i18n';

import type { TaskCard, TaskKind } from '../../api/tasks';
import { KINDS, KindIcon } from './lib/kinds';
import { readTitleOverrides, writeTitleOverride, relativeAge } from './lib/helpers';

interface TaskCardViewProps {
  task: TaskCard;
  onClick: () => void;
  onCtxMenu: (e: React.MouseEvent) => void;
  onOpenKindPicker: (taskId: string, current: TaskKind, x: number, y: number) => void;
}

export function TaskCardView({ task, onClick, onCtxMenu, onOpenKindPicker }: TaskCardViewProps): JSX.Element {
  const t = useT();
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  // Title state — initial = override if present, иначе server title.
  const [localTitle, setLocalTitle] = useState<string>(() => {
    const ov = readTitleOverrides();
    return ov[task.id] ?? task.title;
  });
  // Sync с сервером когда тот меняет title'и (например на refresh) и
  // у нас нет override для этой карточки.
  useEffect(() => {
    const ov = readTitleOverrides();
    if (!(task.id in ov)) setLocalTitle(task.title);
  }, [task.id, task.title]);
  const k = KINDS[task.kind];
  const aiPulse = task.status === 'in_review' && task.source === 'ai';

  const commitTitle = (next: string): void => {
    const trimmed = next.trim();
    if (!trimmed) {
      // Пустой title — cancel edit, восстанавливаем последнее значение.
      setEditing(false);
      return;
    }
    setLocalTitle(trimmed);
    writeTitleOverride(task.id, trimmed);
    setEditing(false);
  };

  return (
    <article
      // data-task-id — anchor для AICursor overlay'а: компонент ищет
      // карточку через document.querySelector('[data-task-id="..."]')
      // и центрирует курсор в её bounding-box. Без этого атрибута SSE
      // сработает (event придёт), но визуально курсор не переместится.
      data-task-id={task.id}
      // draggable отключаем во время edit'а — иначе Электрон/Chromium
      // снимает focus с <input> при mousedown и Enter/Escape не доедут.
      draggable={!editing}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/task-id', task.id);
        e.dataTransfer.effectAllowed = 'move';
        // Polish — custom ghost: clone current card, fade + scale, attach
        // off-screen, hand to dataTransfer.setDragImage. Browser renders
        // the clone instead of the default fullsize screenshot, then
        // garbage-collects it after dragend tick.
        const src = e.currentTarget as HTMLElement;
        const ghost = src.cloneNode(true) as HTMLElement;
        ghost.style.position = 'absolute';
        ghost.style.top = '-1000px';
        ghost.style.left = '-1000px';
        ghost.style.width = `${src.offsetWidth}px`;
        ghost.style.opacity = '0.85';
        ghost.style.transform = 'rotate(-1.5deg) scale(0.98)';
        ghost.style.boxShadow = '0 6px 24px rgba(0,0,0,0.45)';
        ghost.style.pointerEvents = 'none';
        ghost.style.background = 'var(--surface-2)';
        document.body.appendChild(ghost);
        try {
          e.dataTransfer.setDragImage(ghost, 20, 14);
        } catch {
          // Some browsers/Electron versions throw on detached nodes — fail
          // silently and fall back to default ghost.
        }
        // Clean up after the browser has snapshotted the node.
        window.setTimeout(() => { ghost.remove(); }, 0);
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onClick={(e) => {
        if (editing) return; // не открываем drawer пока редактируем title
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
        transition: 'background-color var(--motion-dur-small) var(--motion-ease-standard), box-shadow var(--motion-dur-medium) var(--motion-ease-standard), transform var(--motion-dur-medium) var(--motion-ease-standard)',
      }}
    >
      <span style={{ width: 3, borderRadius: '7px 0 0 7px', flexShrink: 0, background: k.color }} />
      <div style={{ flex: 1, padding: '10px 12px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
          {editing ? (
            <input
              data-stop
              autoFocus
              defaultValue={localTitle}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => commitTitle(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTitle(e.currentTarget.value);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false); // отменяем без сохранения
                }
              }}
              style={{
                flex: 1,
                fontSize: 13,
                fontWeight: 600,
                lineHeight: 1.4,
                color: 'var(--ink)',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--ink-40)',
                outline: 'none',
                padding: 0,
                fontFamily: 'inherit',
                minWidth: 0,
              }}
            />
          ) : (
            <span
              onDoubleClick={(e) => {
                // Double-click = edit; останавливаем propagation чтобы
                // drawer onClick не сработал.
                e.stopPropagation();
                setEditing(true);
              }}
              title={t('hone.taskboard.dblclick_rename_title')}
              style={{
                flex: 1,
                fontSize: 13,
                fontWeight: 600,
                lineHeight: 1.4,
                color: 'var(--ink)',
                cursor: 'text',
              }}
            >
              {localTitle}
            </span>
          )}
          {/* Phase J / H3 — kind chip is now a button: click → KindPicker
              for manual override. data-stop prevents the card-level click
              from opening the drawer. */}
          <button
            data-stop
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onOpenKindPicker(task.id, task.kind, r.right + 4, r.top);
            }}
            aria-label={`Kind: ${KINDS[task.kind].label}${task.manualKindOverride ? ' (manually set)' : ''}. Click to change.`}
            title={task.manualKindOverride ? 'Kind set manually · click to change' : 'Auto-tagged · click to override'}
            style={{
              marginTop: 1,
              padding: 2,
              border: 'none',
              borderRadius: 4,
              background: 'transparent',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              flexShrink: 0,
              opacity: 0.85,
            }}
          >
            <KindIcon kind={task.kind} size={12} />
            {task.manualKindOverride && (
              <span
                aria-hidden
                style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: '#FF3B30',
                  flexShrink: 0,
                }}
                title="Manually set (won't auto-recategorise)"
              />
            )}
          </button>
        </div>
        {task.briefMd && (
          <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: 'var(--ink-40)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: 8 }}>
            {task.briefMd}
          </p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {task.skillKey && (
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', padding: '1px 6px', borderRadius: 3, background: 'rgba(255,255,255,0.06)', color: 'var(--ink-60)' }}>
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
            <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', padding: '1px 5px', borderRadius: 3, background: 'rgba(255,255,255,0.10)', color: 'rgb(var(--ink))' }}>
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
                marginLeft: 'auto', minWidth: 28, minHeight: 28, width: 28, height: 28, borderRadius: 5, border: 'none',
                background: 'rgba(255,255,255,0.06)', color: 'var(--ink-40)',
                fontSize: 10, cursor: 'pointer', opacity: hover ? 1 : 0,
                transition: 'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)', display: 'flex', alignItems: 'center', justifyContent: 'center',
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
