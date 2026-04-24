// Notes — two-column list/editor поверх реальных RPC.
//
// Лево: ListNotes (keyset cursor — пока pull только первой страницы; для
// корпуса <100 заметок этого хватает, кнопка «more» появится когда будет
// нужна). Право: GetNote → editor с локальным debounced UpdateNote.
//
// Create — открывает inline-форму над списком (title + body), сохраняет
// один раз и закрывает форму. Delete — кнопка в editor'е, требует confirm
// через двойной click (без модалки — ритуал минимальный).
//
// Phase 5b ограничения (известные): нет markdown-рендера (показываем raw
// в pre), нет поиска/⌘P, нет ⌘J connections-панели. Эти приедут отдельным
// циклом.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';

import { Kbd } from '../components/primitives/Kbd';
import {
  listNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  type Note,
  type NoteSummary,
} from '../api/hone';

interface ListState {
  status: 'loading' | 'ok' | 'error';
  notes: NoteSummary[];
  error: string | null;
  errorCode: Code | null;
}

const INITIAL_LIST: ListState = { status: 'loading', notes: [], error: null, errorCode: null };

export function NotesPage() {
  const [list, setList] = useState<ListState>(INITIAL_LIST);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [active, setActive] = useState<Note | null>(null);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Локальные «working» копии для editor'а: позволяют тайпать без roundtrip.
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // Initial list load.
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
    // selectedId намеренно не в deps — мы хотим bootstrap'нуть его один
    // раз, дальше пользователь сам управляет выделением.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selection change → fetch full note.
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
                row.id === id ? { ...row, title: n.title, updatedAt: n.updatedAt, sizeBytes: n.sizeBytes } : row,
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

  // Debounce saves: 600ms после последнего keypress в title/body.
  useEffect(() => {
    if (!active) return;
    if (draftTitle === active.title && draftBody === active.bodyMd) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => persistDraft(), 600);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [draftTitle, draftBody, active, persistDraft]);

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
        gridTemplateColumns: '280px 1fr',
      }}
    >
      <aside
        style={{
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

      <section style={{ padding: '10px 56px 0 56px', position: 'relative', overflowY: 'auto' }}>
        {creating ? (
          <CreateNoteForm onCancel={() => setCreating(false)} onSubmit={handleCreate} />
        ) : list.status === 'error' ? (
          <ErrorPane message={list.error ?? ''} code={list.errorCode} />
        ) : !active && list.status === 'ok' && list.notes.length === 0 ? (
          <p style={{ color: 'var(--ink-40)', fontSize: 14 }}>
            No notes yet. Press <Kbd>⌘N</Kbd> to add the first one.
          </p>
        ) : !active ? (
          <p style={{ color: 'var(--ink-40)', fontSize: 14 }}>{activeError ?? 'Loading note…'}</p>
        ) : (
          <ActiveNoteEditor
            title={draftTitle}
            body={draftBody}
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
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onDelete: () => void;
  confirmingDelete: boolean;
}

function ActiveNoteEditor({
  title,
  body,
  onTitleChange,
  onBodyChange,
  onDelete,
  confirmingDelete,
}: ActiveEditorProps) {
  return (
    <div>
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
      <textarea
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        rows={20}
        className="mono"
        style={{
          width: '100%',
          marginTop: 26,
          fontSize: 13,
          lineHeight: 1.75,
          color: 'var(--ink-90)',
          background: 'transparent',
          resize: 'none',
        }}
      />
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
