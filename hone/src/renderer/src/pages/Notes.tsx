// Notes — two-column list/editor поверх реальных RPC + markdown render
// + ⌘J connections panel.
//
// Phase 5b scope:
//   - list / get / create / update (debounced 600ms) / delete
//   - preview toggle в editor'е: Edit (textarea) / Preview (marked)
//   - ⌘J открывает панель справа, запускает getNoteConnections stream
//     для активной заметки, показывает top-10 similarity-matches
//
// Connections-панель оверлейная (не меняет сетку), закрывается Esc /
// повторным ⌘J / клик по backdrop'у. Panel фетчит строго для того note
// который открыт в момент нажатия ⌘J (не пере-фетчит на каждый select).
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';

import { AskNotesModal } from '../components/AskNotesModal';
import { Kbd } from '../components/primitives/Kbd';
import { MarkdownView } from '../components/MarkdownView';
import { RichMarkdownEditor } from '../components/RichMarkdownEditor';
import {
  listNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  getNoteConnectionsStream,
  type Note,
  type NoteConnection,
  type NoteSummary,
} from '../api/hone';

interface ListState {
  status: 'loading' | 'ok' | 'error';
  notes: NoteSummary[];
  error: string | null;
  errorCode: Code | null;
}

const INITIAL_LIST: ListState = { status: 'loading', notes: [], error: null, errorCode: null };

type EditorMode = 'edit' | 'preview';

const SIDEBAR_KEY = 'hone:notes:sidebar-w';
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 460;
const SIDEBAR_DEFAULT = 280;

export interface NotesPageProps {
  /**
   * Когда DailyBriefPanel жмёт review_note chip, App кладёт сюда note_id.
   * Notes на mount подхватит и установит selectedId, затем дёрнет
   * onConsumeInitial чтобы не повторять при следующем re-render.
   */
  initialSelectedId?: string | null;
  onConsumeInitial?: () => void;
}

export function NotesPage({ initialSelectedId, onConsumeInitial }: NotesPageProps = {}) {
  const [list, setList] = useState<ListState>(INITIAL_LIST);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [askOpen, setAskOpen] = useState(false);
  const [active, setActive] = useState<Note | null>(null);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [mode, setMode] = useState<EditorMode>('edit');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const [sidebarW, setSidebarW] = useState<number>(() => {
    if (typeof window === 'undefined') return SIDEBAR_DEFAULT;
    const raw = window.localStorage.getItem(SIDEBAR_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n)) return SIDEBAR_DEFAULT;
    return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, n));
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_KEY, String(sidebarW));
    } catch {
      /* ignore */
    }
  }, [sidebarW]);
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      setSidebarW(
        Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, dragRef.current.w + dx)),
      );
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Initial list.
  useEffect(() => {
    let cancelled = false;
    listNotes()
      .then((res) => {
        if (cancelled) return;
        setList({ status: 'ok', notes: res.notes, error: null, errorCode: null });
        if (res.notes.length > 0 && !selectedId) {
          setSelectedId(res.notes[0]?.id ?? null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const ce = ConnectError.from(err);
        setList({
          status: 'error',
          notes: [],
          error: ce.rawMessage || ce.message,
          errorCode: ce.code,
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selection change.
  useEffect(() => {
    if (!selectedId) {
      setActive(null);
      return;
    }
    let cancelled = false;
    setActiveError(null);
    getNote(selectedId)
      .then((n) => {
        if (cancelled) return;
        setActive(n);
        setDraftTitle(n.title);
        setDraftBody(n.bodyMd);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const ce = ConnectError.from(err);
        setActiveError(ce.rawMessage || ce.message);
        setActive(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const persistDraft = useMemo(
    () =>
      function () {
        if (!active) return;
        const id = active.id;
        const title = draftTitle;
        const body = draftBody;
        updateNote(id, title, body)
          .then((n) => {
            setActive(n);
            setList((prev) => ({
              ...prev,
              notes: prev.notes.map((row) =>
                row.id === id
                  ? { ...row, title: n.title, updatedAt: n.updatedAt, sizeBytes: n.sizeBytes }
                  : row,
              ),
            }));
          })
          .catch((err: unknown) => {
            const ce = ConnectError.from(err);
            setActiveError(ce.rawMessage || ce.message);
          });
      },
    [active, draftTitle, draftBody],
  );

  useEffect(() => {
    if (!active) return;
    if (draftTitle === active.title && draftBody === active.bodyMd) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => persistDraft(), 600);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [draftTitle, draftBody, active, persistDraft]);

  // Single-shot consume initialSelectedId on mount.
  useEffect(() => {
    if (initialSelectedId) {
      setSelectedId(initialSelectedId);
      onConsumeInitial?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⌘J global hotkey (когда мы на notes-странице) — toggle connections.
  // ⌘⇧L — open AskNotes RAG modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setAskOpen(true);
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        if (!active) return;
        setConnectionsOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const handleCreate = async (title: string, body: string) => {
    try {
      const n = await createNote(title || 'Untitled', body);
      setList((prev) => ({
        ...prev,
        notes: [
          { id: n.id, title: n.title, updatedAt: n.updatedAt, sizeBytes: n.sizeBytes },
          ...prev.notes,
        ],
      }));
      setSelectedId(n.id);
      setCreating(false);
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setActiveError(ce.rawMessage || ce.message);
    }
  };

  const handleDelete = async () => {
    if (!active) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 2500);
      return;
    }
    const id = active.id;
    try {
      await deleteNote(id);
      setList((prev) => ({ ...prev, notes: prev.notes.filter((n) => n.id !== id) }));
      const remaining = list.notes.filter((n) => n.id !== id);
      setSelectedId(remaining.length > 0 ? (remaining[0]?.id ?? null) : null);
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setActiveError(ce.rawMessage || ce.message);
    } finally {
      setConfirmingDelete(false);
    }
  };

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 80,
        paddingBottom: 120,
        display: 'grid',
        gridTemplateColumns: `${sidebarW}px 6px 1fr`,
        animationDuration: '320ms',
      }}
    >
      <aside
        className="slide-from-left"
        style={{
          animationDuration: '320ms',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          padding: '0 10px',
          overflowY: 'auto',
        }}
      >
        <div style={{ padding: '6px 14px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-40)', flex: 1 }}>
            {list.status === 'loading'
              ? 'Loading…'
              : list.status === 'error'
                ? 'Notes offline'
                : `${list.notes.length} note${list.notes.length === 1 ? '' : 's'}`}
          </span>
          <Kbd>⌘P</Kbd>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="focus-ring"
          style={{
            width: 'calc(100% - 12px)',
            margin: '0 6px 10px',
            padding: '8px 12px',
            borderRadius: 7,
            border: '1px solid rgba(255,255,255,0.06)',
            fontSize: 12.5,
            color: 'var(--ink-60)',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ opacity: 0.6 }}>+</span> New note
          <span style={{ marginLeft: 'auto' }}>
            <Kbd>⌘N</Kbd>
          </span>
        </button>
        {list.notes.map((n) => {
          const activeRow = selectedId === n.id;
          return (
            <button
              key={n.id}
              onClick={() => setSelectedId(n.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '11px 14px',
                margin: '1px 0',
                borderRadius: 7,
                color: activeRow ? 'var(--ink)' : 'var(--ink-60)',
                background: activeRow ? 'rgba(255,255,255,0.05)' : 'transparent',
                fontSize: 13.5,
              }}
            >
              {n.title || 'Untitled'}
            </button>
          );
        })}
      </aside>

      <div
        onMouseDown={(e) => {
          dragRef.current = { x: e.clientX, w: sidebarW };
        }}
        style={{
          position: 'relative',
          cursor: 'col-resize',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 2,
            top: 0,
            bottom: 0,
            width: 2,
            background: dragRef.current ? 'rgba(255,255,255,0.18)' : 'transparent',
            transition: 'background-color var(--t-fast)',
          }}
        />
      </div>

      <section style={{ padding: '10px 56px 0 56px', position: 'relative', overflowY: 'auto', minWidth: 0 }}>
        {creating ? (
          <CreateNoteForm onCancel={() => setCreating(false)} onSubmit={handleCreate} />
        ) : list.status === 'error' ? (
          <ErrorPane message={list.error ?? ''} code={list.errorCode} />
        ) : !active && list.status === 'ok' && list.notes.length === 0 ? (
          <p style={{ color: 'var(--ink-40)', fontSize: 14 }}>
            No notes yet. Press <Kbd>⌘N</Kbd> to add the first one.
          </p>
        ) : !active ? (
          <div
            className="fadein"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '60%',
              color: 'var(--ink-40)',
              gap: 10,
            }}
          >
            <p style={{ fontSize: 14, margin: 0 }}>
              {activeError ?? 'Pick a note or hit'} <Kbd>⌘N</Kbd>
            </p>
          </div>
        ) : (
          <ActiveNoteEditor
            key={active.id}
            title={draftTitle}
            body={draftBody}
            mode={mode}
            onModeChange={setMode}
            onTitleChange={setDraftTitle}
            onBodyChange={setDraftBody}
            onDelete={handleDelete}
            confirmingDelete={confirmingDelete}
          />
        )}
        {activeError && (
          <p
            className="mono"
            style={{
              position: 'absolute',
              bottom: 8,
              left: 56,
              fontSize: 10,
              color: 'var(--ink-40)',
            }}
          >
            {activeError}
          </p>
        )}
        <div
          className="mono"
          style={{
            position: 'absolute',
            bottom: 8,
            right: 56,
            fontSize: 10,
            color: 'var(--ink-40)',
          }}
        >
          ⌘J for connections
        </div>
      </section>

      {connectionsOpen && active && (
        <ConnectionsPanel
          noteId={active.id}
          onClose={() => setConnectionsOpen(false)}
          onPick={(id) => {
            // Клик по соединению типа note — переключаем выбор. Остальные
            // kinds пока просто закрывают панель (будут deep-link'и в v2).
            setSelectedId(id);
            setConnectionsOpen(false);
          }}
        />
      )}
      {askOpen && (
        <AskNotesModal
          onClose={() => setAskOpen(false)}
          onOpenNote={(noteId) => setSelectedId(noteId)}
        />
      )}
    </div>
  );
}

interface CreateNoteFormProps {
  onCancel: () => void;
  onSubmit: (title: string, body: string) => void;
}

function CreateNoteForm({ onCancel, onSubmit }: CreateNoteFormProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  return (
    <div>
      <input
        ref={titleRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title…"
        style={{
          width: '100%',
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: '-0.015em',
          padding: '4px 0',
          background: 'transparent',
          color: 'var(--ink)',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Markdown body…"
        rows={14}
        className="mono"
        style={{
          width: '100%',
          marginTop: 24,
          fontSize: 13,
          lineHeight: 1.75,
          color: 'var(--ink-90)',
          background: 'transparent',
          resize: 'none',
        }}
      />
      <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
        <button
          onClick={onCancel}
          className="focus-ring mono"
          style={{
            padding: '8px 14px',
            fontSize: 11,
            letterSpacing: '.1em',
            color: 'var(--ink-60)',
            borderRadius: 8,
          }}
        >
          CANCEL
        </button>
        <button
          onClick={() => onSubmit(title.trim(), body.trim())}
          className="focus-ring"
          style={{
            padding: '9px 16px',
            fontSize: 13,
            fontWeight: 500,
            borderRadius: 999,
            background: '#fff',
            color: '#000',
          }}
        >
          Save note
        </button>
      </div>
    </div>
  );
}

interface ActiveEditorProps {
  title: string;
  body: string;
  mode: EditorMode;
  onModeChange: (m: EditorMode) => void;
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onDelete: () => void;
  confirmingDelete: boolean;
}

function ActiveNoteEditor({
  title,
  body,
  mode,
  onModeChange,
  onTitleChange,
  onBodyChange,
  onDelete,
  confirmingDelete,
}: ActiveEditorProps) {
  return (
    <div className="fadein" style={{ animationDuration: '220ms' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          style={{
            flex: 1,
            fontSize: 26,
            fontWeight: 500,
            letterSpacing: '-0.015em',
            padding: 0,
            background: 'transparent',
            color: 'var(--ink)',
            border: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <ModeToggle mode={mode} onChange={onModeChange} />
          <button
            onClick={onDelete}
            className="focus-ring mono"
            style={{
              padding: '5px 10px',
              fontSize: 10,
              letterSpacing: '.12em',
              color: confirmingDelete ? 'var(--red)' : 'var(--ink-40)',
              borderRadius: 6,
            }}
          >
            {confirmingDelete ? 'CLICK AGAIN' : 'DELETE'}
          </button>
        </div>
      </div>
      {mode === 'edit' ? (
        <div style={{ marginTop: 26 }}>
          <RichMarkdownEditor
            value={body}
            onChange={onBodyChange}
            placeholder="Start writing — select text for formatting, ⌘B / ⌘I / ⌘K"
          />
        </div>
      ) : (
        <div style={{ marginTop: 26 }}>
          <MarkdownView source={body} />
        </div>
      )}
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: EditorMode; onChange: (m: EditorMode) => void }) {
  const btn = (label: EditorMode, displayed: string) => (
    <button
      onClick={() => onChange(label)}
      className="focus-ring mono"
      style={{
        padding: '5px 10px',
        fontSize: 10,
        letterSpacing: '.12em',
        color: mode === label ? 'var(--ink)' : 'var(--ink-40)',
        background: mode === label ? 'rgba(255,255,255,0.05)' : 'transparent',
        borderRadius: 6,
      }}
    >
      {displayed}
    </button>
  );
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {btn('edit', 'EDIT')}
      {btn('preview', 'PREVIEW')}
    </div>
  );
}

interface ConnectionsPanelProps {
  noteId: string;
  onClose: () => void;
  onPick: (id: string) => void;
}

function ConnectionsPanel({ noteId, onClose, onPick }: ConnectionsPanelProps) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [items, setItems] = useState<NoteConnection[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const acc: NoteConnection[] = [];
    setStatus('loading');
    setItems([]);
    getNoteConnectionsStream(noteId, (c) => {
      if (cancelled) return;
      acc.push(c);
      setItems([...acc]);
    })
      .then(() => {
        if (!cancelled) setStatus('ok');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const ce = ConnectError.from(e);
        setErr(ce.rawMessage || ce.message);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 55,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          height: '100%',
          background: 'rgba(8,8,8,0.96)',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          padding: '90px 28px 40px',
          overflowY: 'auto',
        }}
      >
        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '.24em', color: 'var(--ink-40)' }}
        >
          CONNECTIONS {status === 'loading' && '· STREAMING…'}
        </div>
        <h3
          style={{
            margin: '10px 0 24px',
            fontSize: 22,
            fontWeight: 400,
            letterSpacing: '-0.015em',
          }}
        >
          What this note relates to.
        </h3>

        {status === 'error' && (
          <p style={{ fontSize: 13, color: 'var(--ink-60)' }}>
            {err?.includes('embedding') ? 'Embeddings not available yet.' : err}
          </p>
        )}
        {status === 'ok' && items.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--ink-60)' }}>
            Nothing above the similarity floor yet. Write a few more notes.
          </p>
        )}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((c, i) => (
            <li
              key={`${c.kind}:${c.targetId}:${i}`}
              style={{
                padding: '12px 0',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}
            >
              <button
                onClick={() => (c.kind === 'note' ? onPick(c.targetId) : undefined)}
                className="focus-ring"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  cursor: c.kind === 'note' ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 13.5, color: 'var(--ink)' }}>
                    {c.displayTitle || '(untitled)'}
                  </span>
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: 'var(--ink-40)', flexShrink: 0 }}
                  >
                    {c.kind.toUpperCase()} · {(c.similarity * 100).toFixed(0)}%
                  </span>
                </div>
                {c.snippet && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      color: 'var(--ink-60)',
                      lineHeight: 1.5,
                    }}
                  >
                    {c.snippet}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div
          className="mono"
          style={{
            marginTop: 20,
            fontSize: 10,
            color: 'var(--ink-40)',
            letterSpacing: '.12em',
          }}
        >
          ESC TO CLOSE
        </div>
      </aside>
    </div>
  );
}

function ErrorPane({ message, code }: { message: string; code: Code | null }) {
  let headline = 'Notes offline.';
  if (code === Code.Unauthenticated) headline = 'Sign in to view notes.';
  return (
    <div>
      <p style={{ fontSize: 14, color: 'var(--ink-60)' }}>{headline}</p>
      {message && (
        <p className="mono" style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-40)' }}>
          {message}
        </p>
      )}
    </div>
  );
}
