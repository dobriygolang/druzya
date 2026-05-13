import { useState } from 'react';
import type { CueSession } from '../../api/hone';
import { formatCueRowDate } from './utils';

// CueSessionRow — компактная sidebar row для backend-driven Cue session'а.
// Не drop-target, не draggable (Cue sessions — read-only система). Hover
// показывает delete-точку — full delete без подтверждения, потому что
// session — лог встречи, его дубликат всегда можно ре-импортировать
// заново через `druz9://notes/import`.
export function CueSessionRow({
  session, active, onSelect, onDelete,
}: {
  session: CueSession;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);
  const dt = session.startedAt ?? session.importedAt;
  const dateStr = dt ? formatCueRowDate(dt) : '';
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSelect}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        margin: '0 6px',
        borderRadius: 6,
        cursor: 'pointer',
        background: active ? 'rgba(79,195,247,0.14)' : (hover ? 'rgba(255,255,255,0.04)' : 'transparent'),
        border: active ? '1px solid rgba(79,195,247,0.22)' : '1px solid transparent',
        transition: 'background 120ms, border-color 120ms',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="rgba(79,195,247,0.9)" strokeWidth="1.3" strokeLinejoin="round">
        <path d="M6 1L10.33 3.5V8.5L6 11L1.67 8.5V3.5L6 1Z" />
      </svg>
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 12.5,
          color: 'var(--ink-90)',
        }}
      >
        {session.title || 'Cue meeting'}
      </span>
      {dateStr && (
        <span style={{ fontSize: 10.5, color: 'var(--ink-40)' }}>{dateStr}</span>
      )}
      {hover && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm('Delete this Cue session?')) onDelete();
          }}
          title="Delete session"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--ink-40)',
            cursor: 'pointer',
            padding: '0 2px',
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export function NotesRetentionHint() {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Notes inactive for 90+ days are archived. Edits or opens reset the timer. Encrypted notes are never auto-deleted."
      style={{
        marginTop: 14,
        padding: '10px 14px 14px',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'help',
      }}
    >
      <svg
        width={11}
        height={11}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: hover ? 'var(--ink-60)' : 'var(--ink-40)', flexShrink: 0, transition: 'color 160ms ease' }}
      >
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 14" />
      </svg>
      <span
        className="mono"
        style={{
          fontSize: 9,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: hover ? 'var(--ink-60)' : 'var(--ink-40)',
          transition: 'color var(--motion-dur-small) var(--motion-ease-standard)',
        }}
      >
        Auto-archive after 90d
      </span>
    </div>
  );
}
