// Notes — Notion-like two-column editor.
//
// UX (Phase C-4):
//   - "+" в sidebar: instant-create новой заметки на сервере, открывает её в
//     editor'е сразу (без модальной формы). Title начинается «Untitled»,
//     body пустой; юзер сразу пишет.
//   - Right panel — title + body, без preview/edit toggle (always-edit
//     стиль Notion). MarkdownView и /preview-режим ушли — pure WYSIWYG-ish
//     edit через RichMarkdownEditor.
//   - Three-dots на каждой row sidebar'а появляется при hover, click →
//     dropdown {Publish to web | Delete Note}. Никакой DELETE-кнопки в
//     заголовке editor'а.
//   - Last updated HH:MM:SS показывается в правом нижнем углу editor'а
//     при hover на заметку (через мышь над editor'ом).
//   - Autosave: debounced 600ms на keystroke + immediate flush на
//     blur/unmount/route-change/window-blur. Никаких «save» кнопок.
//   - Hover-эффекты: смена background на rows, accent на «+», fade на
//     three-dots. Все transitions через --t-fast (180ms).
//
// ⌘J connections panel и ⌘⇧L AskNotes — оставлены без изменений.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';

import { AskNotesModal } from '../components/AskNotesModal';
import { Kbd } from '../components/primitives/Kbd';
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
import {
  publishNote,
  unpublishNote,
  getPublishStatus,
  type PublishStatus,
} from '../api/storage';

interface ListState {
  status: 'loading' | 'ok' | 'error';
  notes: NoteSummary[];
  error: string | null;
  errorCode: Code | null;
}

const INITIAL_LIST: ListState = { status: 'loading', notes: [], error: null, errorCode: null };

const SIDEBAR_KEY = 'hone:notes:sidebar-w';
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 460;
const SIDEBAR_DEFAULT = 280;

export interface NotesPageProps {
  initialSelectedId?: string | null;
  onConsumeInitial?: () => void;
}

export function NotesPage({ initialSelectedId, onConsumeInitial }: NotesPageProps = {}) {
  const [list, setList] = useState<ListState>(INITIAL_LIST);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [askOpen, setAskOpen] = useState(false);
  const [active, setActive] = useState<Note | null>(null);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  // Sidebar resize.
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
      setSidebarW(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, dragRef.current.w + dx)));
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

  // Initial list fetch.
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

  // Load active note on selection change.
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

  // ─── Persistence ────────────────────────────────────────────────────────

  // We keep the latest draft in a ref so flushNow() reads the current value
  // даже когда вызывается из beforeunload / unmount (closure-captured state
  // там устарел).
  const draftRef = useRef({ title: '', body: '', activeId: '' });
  draftRef.current = {
    title: draftTitle,
    body: draftBody,
    activeId: active?.id ?? '',
  };
  const lastSavedRef = useRef({ title: '', body: '' });
  useEffect(() => {
    if (active) lastSavedRef.current = { title: active.title, body: active.bodyMd };
  }, [active]);

  const flushNow = useCallback(async () => {
    const { activeId, title, body } = draftRef.current;
    if (!activeId) return;
    if (lastSavedRef.current.title === title && lastSavedRef.current.body === body) return;
    try {
      const n = await updateNote(activeId, title, body);
      lastSavedRef.current = { title: n.title, body: n.bodyMd };
      setActive((cur) => (cur && cur.id === n.id ? n : cur));
      setList((prev) => ({
        ...prev,
        notes: prev.notes.map((row) =>
          row.id === activeId
            ? { ...row, title: n.title, updatedAt: n.updatedAt, sizeBytes: n.sizeBytes }
            : row,
        ),
      }));
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setActiveError(ce.rawMessage || ce.message);
    }
  }, []);

  // Debounced autosave on keystroke (600ms idle).
  useEffect(() => {
    if (!active) return;
    if (draftTitle === active.title && draftBody === active.bodyMd) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flushNow(), 600);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [draftTitle, draftBody, active, flushNow]);

  // Immediate flush on window blur (alt-tab) и beforeunload (close/reload).
  useEffect(() => {
    const onBlur = () => void flushNow();
    const onBeforeUnload = () => {
      // Best-effort sync save через keepalive — fetch'и в beforeunload
      // обрезаются браузером, но updateNote проходит через Connect и
      // обычно успевает на ~50ms. Не идеально, но приемлемо для MVP.
      void flushNow();
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Финальный flush на unmount (route-change Notes → Today).
      void flushNow();
    };
  }, [flushNow]);

  // Single-shot consume initialSelectedId on mount.
  useEffect(() => {
    if (initialSelectedId) {
      setSelectedId(initialSelectedId);
      onConsumeInitial?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⌘J connections / ⌘⇧L AskNotes / ⌘N create.
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
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void handleCreate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ─── Actions ────────────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    // Flush текущей заметки перед переключением.
    await flushNow();
    try {
      const n = await createNote('Untitled', '');
      setList((prev) => ({
        ...prev,
        notes: [
          { id: n.id, title: n.title, updatedAt: n.updatedAt, sizeBytes: n.sizeBytes },
          ...prev.notes,
        ],
      }));
      setSelectedId(n.id);
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setActiveError(ce.rawMessage || ce.message);
    }
  }, [flushNow]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteNote(id);
        setList((prev) => ({ ...prev, notes: prev.notes.filter((n) => n.id !== id) }));
        if (selectedId === id) {
          // Pick the first remaining row, if any.
          const next = list.notes.find((n) => n.id !== id);
          setSelectedId(next?.id ?? null);
        }
      } catch (err: unknown) {
        const ce = ConnectError.from(err);
        setActiveError(ce.rawMessage || ce.message);
      }
    },
    [list.notes, selectedId],
  );

  const handlePublish = useCallback(async (id: string) => {
    try {
      await flushNow(); // публикуем именно последнюю версию
      const status = await publishNote(id);
      if (status.url) {
        try {
          await navigator.clipboard.writeText(status.url);
          setToast('Public link copied');
        } catch {
          setToast(`Public: ${status.url}`);
        }
        window.setTimeout(() => setToast(null), 2400);
      }
    } catch {
      setToast('Publish failed');
      window.setTimeout(() => setToast(null), 2400);
    }
  }, [flushNow]);

  const handleUnpublish = useCallback(async (id: string) => {
    try {
      await unpublishNote(id);
      setToast('Unpublished');
      window.setTimeout(() => setToast(null), 2200);
    } catch {
      setToast('Unpublish failed');
      window.setTimeout(() => setToast(null), 2400);
    }
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 80,
        paddingBottom: 80,
        display: 'grid',
        gridTemplateColumns: `${sidebarW}px 6px 1fr`,
        animationDuration: '320ms',
      }}
    >
      <Sidebar
        list={list}
        selectedId={selectedId}
        onSelect={(id) => {
          void flushNow();
          setSelectedId(id);
        }}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onPublish={handlePublish}
        onUnpublish={handleUnpublish}
      />

      <ResizeHandle
        onMouseDown={(e) => {
          dragRef.current = { x: e.clientX, w: sidebarW };
        }}
      />

      <Editor
        list={list}
        active={active}
        activeError={activeError}
        draftTitle={draftTitle}
        draftBody={draftBody}
        onTitleChange={setDraftTitle}
        onBodyChange={setDraftBody}
        onCreate={handleCreate}
      />

      {connectionsOpen && active && (
        <ConnectionsPanel
          noteId={active.id}
          onClose={() => setConnectionsOpen(false)}
          onPick={(id) => {
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

      {toast && <Toast text={toast} />}
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────

interface SidebarProps {
  list: ListState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onPublish: (id: string) => void;
  onUnpublish: (id: string) => void;
}

function Sidebar({ list, selectedId, onSelect, onCreate, onDelete, onPublish, onUnpublish }: SidebarProps) {
  return (
    <aside
      className="slide-from-left"
      style={{
        animationDuration: '320ms',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        padding: '0 8px',
        overflowY: 'auto',
      }}
    >
      <SidebarHeader
        count={list.notes.length}
        status={list.status}
        onCreate={onCreate}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 2px' }}>
        {list.notes.map((n) => (
          <NoteRow
            key={n.id}
            note={n}
            active={selectedId === n.id}
            onSelect={() => onSelect(n.id)}
            onDelete={() => onDelete(n.id)}
            onPublish={() => onPublish(n.id)}
            onUnpublish={() => onUnpublish(n.id)}
          />
        ))}
      </div>
    </aside>
  );
}

function SidebarHeader({
  count,
  status,
  onCreate,
}: {
  count: number;
  status: ListState['status'];
  onCreate: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px 14px',
      }}
    >
      <button
        onClick={() => window.history.back()}
        className="focus-ring"
        title="Back"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 4,
          borderRadius: 6,
          cursor: 'pointer',
          color: 'var(--ink-60)',
          display: 'inline-flex',
          alignItems: 'center',
          transition: 'color 180ms ease, background-color 180ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--ink)';
          e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--ink-60)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <span
        className="mono"
        style={{
          flex: 1,
          fontSize: 10,
          letterSpacing: '0.2em',
          color: 'var(--ink-40)',
          textTransform: 'uppercase',
        }}
      >
        {status === 'loading' ? 'Loading' : status === 'error' ? 'Offline' : `Notes · ${count}`}
      </span>
      <CreateButton onClick={onCreate} />
    </div>
  );
}

function CreateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="focus-ring"
      title="New note (⌘N)"
      style={{
        width: 26,
        height: 26,
        borderRadius: 7,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--ink-60)',
        display: 'grid',
        placeItems: 'center',
        transition: 'background-color 180ms ease, color 180ms ease, transform 180ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
        e.currentTarget.style.color = 'var(--ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--ink-60)';
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = 'scale(0.92)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}

// ─── NoteRow with three-dots menu ─────────────────────────────────────────

interface NoteRowProps {
  note: NoteSummary;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
}

function NoteRow({ note, active, onSelect, onDelete, onPublish, onUnpublish }: NoteRowProps) {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [pubStatus, setPubStatus] = useState<PublishStatus | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // Lazy-load publish status on first hover (cheap idempotent fetch).
  useEffect(() => {
    if (!hover || pubStatus) return;
    let live = true;
    void getPublishStatus(note.id)
      .then((s) => {
        if (live) setPubStatus(s);
      })
      .catch(() => {
        /* silent */
      });
    return () => {
      live = false;
    };
  }, [hover, pubStatus, note.id]);

  // Close menu on outside click / Esc.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const lastUpd = useMemo(() => formatTime(note.updatedAt), [note.updatedAt]);

  return (
    <div
      ref={rowRef}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        if (!menuOpen) setConfirmDel(false);
      }}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px 8px 12px',
        margin: '1px 0',
        borderRadius: 7,
        background: active
          ? 'rgba(255,255,255,0.07)'
          : hover
            ? 'rgba(255,255,255,0.04)'
            : 'transparent',
        transition: 'background-color 160ms ease',
        cursor: 'pointer',
      }}
      onClick={() => onSelect()}
    >
      <NoteIcon />
      <span
        style={{
          flex: 1,
          fontSize: 13.5,
          color: active ? 'var(--ink)' : 'var(--ink-60)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          transition: 'color 160ms ease',
        }}
      >
        {note.title || 'Untitled'}
      </span>

      {/* Last updated tooltip — fade in при hover, fade out плавно */}
      <span
        className="mono"
        style={{
          fontSize: 10,
          color: 'var(--ink-40)',
          opacity: hover && !menuOpen ? 1 : 0,
          transition: 'opacity 180ms ease',
          pointerEvents: 'none',
          flexShrink: 0,
        }}
      >
        {lastUpd}
      </span>

      {/* Three-dots — также fade-in при hover */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((o) => !o);
        }}
        className="focus-ring"
        title="More"
        style={{
          width: 22,
          height: 22,
          display: 'grid',
          placeItems: 'center',
          background: menuOpen ? 'rgba(255,255,255,0.08)' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--ink-60)',
          borderRadius: 5,
          opacity: hover || menuOpen ? 1 : 0,
          transition: 'opacity 180ms ease, background-color 160ms ease, color 160ms ease',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--ink)';
          if (!menuOpen) e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--ink-60)';
          if (!menuOpen) e.currentTarget.style.background = 'transparent';
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>

      {menuOpen && (
        <RowDropdown
          published={!!pubStatus?.published}
          onPublish={() => {
            setMenuOpen(false);
            onPublish();
          }}
          onUnpublish={() => {
            setMenuOpen(false);
            onUnpublish();
            setPubStatus({ published: false });
          }}
          onDelete={() => {
            if (!confirmDel) {
              setConfirmDel(true);
              window.setTimeout(() => setConfirmDel(false), 2000);
              return;
            }
            setMenuOpen(false);
            onDelete();
          }}
          confirmingDelete={confirmDel}
        />
      )}
    </div>
  );
}

function NoteIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--ink-40)', flexShrink: 0 }}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

interface RowDropdownProps {
  published: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
  onDelete: () => void;
  confirmingDelete: boolean;
}

function RowDropdown({ published, onPublish, onUnpublish, onDelete, confirmingDelete }: RowDropdownProps) {
  return (
    <div
      className="fadein"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 'calc(100% - 4px)',
        right: 8,
        zIndex: 30,
        minWidth: 200,
        padding: 6,
        borderRadius: 10,
        background: 'rgba(20,20,22,0.96)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        animationDuration: '140ms',
      }}
    >
      <DropdownLabel>Publishing</DropdownLabel>
      <DropdownItem
        icon={<LinkIcon />}
        label={published ? 'Copy public link' : 'Publish to web'}
        onClick={onPublish}
      />
      {published && (
        <DropdownItem
          icon={<UnlinkIcon />}
          label="Unpublish"
          onClick={onUnpublish}
        />
      )}
      <DropdownDivider />
      <DropdownItem
        icon={<TrashIcon />}
        label={confirmingDelete ? 'Click again to confirm' : 'Delete Note'}
        onClick={onDelete}
        danger
      />
    </div>
  );
}

function DropdownLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mono"
      style={{
        fontSize: 9,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--ink-40)',
        padding: '6px 10px 4px',
      }}
    >
      {children}
    </div>
  );
}

function DropdownItem({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 10px',
        background: hover ? (danger ? 'rgba(255,80,80,0.10)' : 'rgba(255,255,255,0.06)') : 'transparent',
        border: 'none',
        borderRadius: 6,
        color: danger ? '#ff6a6a' : hover ? 'var(--ink)' : 'var(--ink-90)',
        fontSize: 13,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background-color 140ms ease, color 140ms ease',
      }}
    >
      <span style={{ display: 'inline-flex', color: 'inherit' }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function DropdownDivider() {
  return (
    <div
      style={{
        margin: '4px 6px',
        height: 1,
        background: 'rgba(255,255,255,0.06)',
      }}
    />
  );
}

function LinkIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function UnlinkIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.71 1.71" />
      <path d="M5.16 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.72-1.71" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

// ─── Editor pane ──────────────────────────────────────────────────────────

interface EditorProps {
  list: ListState;
  active: Note | null;
  activeError: string | null;
  draftTitle: string;
  draftBody: string;
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onCreate: () => void;
}

function Editor({ list, active, activeError, draftTitle, draftBody, onTitleChange, onBodyChange, onCreate }: EditorProps) {
  const [hover, setHover] = useState(false);
  return (
    <section
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        padding: '24px 80px 24px 80px',
        overflowY: 'auto',
        minWidth: 0,
      }}
    >
      {list.status === 'error' ? (
        <ErrorPane message={list.error ?? ''} code={list.errorCode} />
      ) : !active && list.status === 'ok' && list.notes.length === 0 ? (
        <EmptyState onCreate={onCreate} />
      ) : !active ? (
        <EmptyState onCreate={onCreate} dim />
      ) : (
        <ActiveEditor
          key={active.id}
          title={draftTitle}
          body={draftBody}
          onTitleChange={onTitleChange}
          onBodyChange={onBodyChange}
        />
      )}

      {/* Bottom-right indicators */}
      {active && (
        <div
          className="mono"
          style={{
            position: 'absolute',
            bottom: 14,
            right: 24,
            fontSize: 10,
            color: 'var(--ink-40)',
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            opacity: hover ? 1 : 0.4,
            transition: 'opacity 220ms ease',
          }}
        >
          <span>⌘J for connections</span>
          <span>Last updated: {formatTime(active.updatedAt)}</span>
        </div>
      )}

      {activeError && (
        <p
          className="mono"
          style={{
            position: 'absolute',
            bottom: 30,
            left: 80,
            fontSize: 10,
            color: '#ff6a6a',
          }}
        >
          {activeError}
        </p>
      )}
    </section>
  );
}

function ActiveEditor({
  title,
  body,
  onTitleChange,
  onBodyChange,
}: {
  title: string;
  body: string;
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
}) {
  return (
    <div className="fadein" style={{ animationDuration: '180ms', maxWidth: 760, margin: '0 auto' }}>
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Untitled"
        autoFocus={!title}
        style={{
          width: '100%',
          fontSize: 36,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          padding: '4px 0 12px',
          background: 'transparent',
          color: 'var(--ink)',
          border: 'none',
          outline: 'none',
        }}
      />
      <div style={{ marginTop: 8 }}>
        <RichMarkdownEditor
          value={body}
          onChange={onBodyChange}
          placeholder="Write your thoughts…"
        />
      </div>
    </div>
  );
}

function EmptyState({ onCreate, dim = false }: { onCreate: () => void; dim?: boolean }) {
  return (
    <div
      className="fadein"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 400,
        gap: 14,
        opacity: dim ? 0.7 : 1,
      }}
    >
      <p style={{ fontSize: 14, color: 'var(--ink-40)', margin: 0 }}>
        {dim ? 'Pick a note or' : 'No notes yet —'} press <Kbd>⌘N</Kbd> to write.
      </p>
      <button
        onClick={onCreate}
        className="focus-ring"
        style={{
          padding: '9px 18px',
          fontSize: 13,
          fontWeight: 500,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'var(--ink-90)',
          cursor: 'pointer',
          transition: 'background-color 180ms ease, color 180ms ease, transform 180ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
          e.currentTarget.style.color = 'var(--ink)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          e.currentTarget.style.color = 'var(--ink-90)';
        }}
      >
        + New note
      </button>
    </div>
  );
}

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
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
          background: hover ? 'rgba(255,255,255,0.15)' : 'transparent',
          transition: 'background-color 180ms ease',
        }}
      />
    </div>
  );
}

function Toast({ text }: { text: string }) {
  return (
    <div
      className="fadein"
      style={{
        position: 'fixed',
        bottom: 32,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 80,
        padding: '10px 16px',
        background: 'rgba(20,20,22,0.96)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10,
        color: 'var(--ink)',
        fontSize: 13,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        animationDuration: '180ms',
      }}
    >
      {text}
    </div>
  );
}

// ─── Connections panel (unchanged from previous) ──────────────────────────

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
        <div className="mono" style={{ fontSize: 10, letterSpacing: '.24em', color: 'var(--ink-40)' }}>
          CONNECTIONS {status === 'loading' && '· STREAMING…'}
        </div>
        <h3 style={{ margin: '10px 0 24px', fontSize: 22, fontWeight: 400, letterSpacing: '-0.015em' }}>
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
            <li key={`${c.kind}:${c.targetId}:${i}`} style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
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
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-40)', flexShrink: 0 }}>
                    {c.kind.toUpperCase()} · {(c.similarity * 100).toFixed(0)}%
                  </span>
                </div>
                {c.snippet && (
                  <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-60)', lineHeight: 1.5 }}>
                    {c.snippet}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="mono" style={{ marginTop: 20, fontSize: 10, color: 'var(--ink-40)', letterSpacing: '.12em' }}>
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

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatTime(d: string | Date | null | undefined): string {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (!Number.isFinite(dt.getTime())) return '';
  const today = new Date();
  const sameDay =
    dt.getFullYear() === today.getFullYear() &&
    dt.getMonth() === today.getMonth() &&
    dt.getDate() === today.getDate();
  if (sameDay) {
    return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  return dt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
