// SharedBoards — multiplayer Excalidraw whiteboards в Hone-стиле.
//
// Архитектура CRDT/WS (без изменений с прежней версии):
//   - Y.Doc на клиенте, sync через /ws/whiteboard/{id} (opaque relay).
//   - Y.Map<'scene'> хранит сериализованный elements-массив; локальный
//     change → Y.Map.set → распространяется через WS. Remote update →
//     observe → excalidrawAPI.updateScene.
//
// UI (этот pass — full redesign):
//   - Sidebar slева как Notes/Whiteboard pattern: list rooms + "+" create
//     + three-dots delete + "Join by ID" в header'е.
//   - Canvas full-bleed справа. Excalidraw default UI спрятан CSS'ом
//     (см. globals.css ::hone-excalidraw-mount overrides).
//   - Floating toolbar Hone-стиля внизу — наши SVG-иконки, glass-blur
//     панель. Подключён к excalidrawAPI.setActiveTool.
//   - Минимальный top-bar справа: «N participants · LIVE» + COPY URL +
//     Open on web. Без жирных кнопок типа default Excalidraw.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { QuotaUsageBar } from '../components/QuotaUsageBar';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';
import { Excalidraw, CaptureUpdateAction } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { useSessionStore } from '../stores/session';
import '@excalidraw/excalidraw/index.css';

import { WEB_BASE_URL } from '../api/config';
import { DraggableToolbar } from '../components/DraggableToolbar';
import {
  createWhiteboardRoom,
  getWhiteboardRoom,
  listMyWhiteboardRooms,
  deleteWhiteboardRoom,
  connectWhiteboardWs,
  getRoomVisibility,
  setRoomVisibility,
  b64ToBytes,
  bytesToB64,
  type WhiteboardRoom,
  type WhiteboardWsStatus,
  type WhiteboardVisibility,
} from '../api/whiteboard';

interface SharedBoardsPageProps {
  initialRoomId?: string | null;
  onConsumeInitial?: () => void;
}

const SIDEBAR_KEY = 'hone:shared-boards:sidebar-w';
const SIDEBAR_COLLAPSED_KEY = 'hone:shared-boards:sidebar-collapsed';
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 460;
const SIDEBAR_DEFAULT = 280;

interface ListState {
  status: 'loading' | 'ok' | 'error';
  rooms: WhiteboardRoom[];
  error: string | null;
}

const INITIAL_LIST: ListState = { status: 'loading', rooms: [], error: null };

export function SharedBoardsPage({ initialRoomId, onConsumeInitial }: SharedBoardsPageProps = {}) {
  const [list, setList] = useState<ListState>(INITIAL_LIST);
  const [selectedId, setSelectedId] = useState<string | null>(initialRoomId ?? null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  });
  const sidebarMountedRef = useRef(false);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
    // Skip на initial mount — иначе resize event сбивает Excalidraw'у его
    // first-measurement через ResizeObserver, и canvas инициализируется с
    // непредсказуемыми dimensions (отсюда был баг "элементы ставятся
    // маленькими"). Дёргаем ресайз только на ПОЛЬЗОВАТЕЛЬСКОМ toggle.
    if (!sidebarMountedRef.current) {
      sidebarMountedRef.current = true;
      return;
    }
    // Excalidraw подписан на window resize и сам refresh'ится — нам нужен
    // только dispatch события. apiRef живёт в RoomCanvas (другой scope) и
    // напрямую отсюда не доступен.
    const t1 = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
    const t2 = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [sidebarCollapsed]);

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

  // Initial list fetch + auto-select first if нет initialRoomId.
  useEffect(() => {
    let cancelled = false;
    const fetchList = () => {
      void listMyWhiteboardRooms()
        .then((rooms) => {
          if (cancelled) return;
          setList({ status: 'ok', rooms, error: null });
          setSelectedId((cur) => cur ?? rooms[0]?.id ?? null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          const ce = ConnectError.from(err);
          setList((prev) =>
            prev.status === 'ok' && prev.rooms.length > 0
              ? prev
              : { status: 'error', rooms: [], error: ce.rawMessage || ce.message },
          );
        });
    };
    fetchList();
    if (onConsumeInitial && initialRoomId) onConsumeInitial();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Handlers ──────────────────────────────────────────────────────────
  const handleCreate = useCallback(async () => {
    try {
      const r = await createWhiteboardRoom('Untitled board');
      setList((prev) => ({ ...prev, status: 'ok', rooms: [r, ...prev.rooms], error: null }));
      setSelectedId(r.id);
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      // Free-tier quota: 1 active shared board. Backend возвращает
      // ResourceExhausted (Code 8) → показываем UpgradePrompt.
      if (ce.code === Code.ResourceExhausted) {
        const { useQuotaStore, quotaExceededMessage } = await import('../stores/quota');
        useQuotaStore.getState().showUpgradePrompt(quotaExceededMessage('board'));
        void useQuotaStore.getState().refresh();
      } else {
        setList((prev) => ({ ...prev, error: ce.rawMessage || ce.message }));
      }
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteWhiteboardRoom(id);
      setList((prev) => ({ ...prev, rooms: prev.rooms.filter((r) => r.id !== id) }));
      setSelectedId((cur) => (cur === id ? null : cur));
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setList((prev) => ({ ...prev, error: ce.rawMessage || ce.message }));
    }
  }, []);

  const handleJoin = useCallback((idOrUrl: string) => {
    const id = extractRoomId(idOrUrl);
    if (id) setSelectedId(id);
  }, []);

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 80,
        paddingBottom: 0,
        display: 'grid',
        // КРИТИЧНО: при collapsed — single-column grid, иначе section с
        // одним in-flow child'ом auto-flow'ится в column 1 (0px wide) и
        // схлопывается до нуля ширины. ExpandSidebarButton — position:
        // absolute, в grid flow не участвует.
        gridTemplateColumns: sidebarCollapsed ? `1fr` : `${sidebarW}px 6px 1fr`,
        animationDuration: '320ms',
      }}
    >
      {!sidebarCollapsed && (
        <Sidebar
          list={list}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onCreate={handleCreate}
          onDelete={handleDelete}
          onJoin={handleJoin}
          onToggleCollapse={() => setSidebarCollapsed(true)}
        />
      )}
      {!sidebarCollapsed && (
        <ResizeHandle
          onMouseDown={(e) => {
            dragRef.current = { x: e.clientX, w: sidebarW };
          }}
        />
      )}
      {sidebarCollapsed && (
        <ExpandSidebarButton onClick={() => setSidebarCollapsed(false)} />
      )}
      <section
        style={{
          position: 'relative',
          minWidth: 0,
          minHeight: 0,
          background: '#000',
        }}
      >
        {selectedId ? (
          <RoomCanvas key={selectedId} roomId={selectedId} />
        ) : (
          <EmptyState onCreate={handleCreate} />
        )}
      </section>
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
  onJoin: (idOrUrl: string) => void;
  onToggleCollapse: () => void;
}

const Sidebar = memo(SidebarImpl);

/** Тихий footer в sidebar: говорит пользователю про auto-cleanup, чтобы
 *  не думали что мы храним всё вечно. См. backend cron-GC по expires_at. */
function RetentionHint({ label }: { label: string }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Boards inactive for 30+ days are removed automatically. Activity (open/edit/share) resets the timer."
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
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: hover ? 'var(--ink-60)' : 'var(--ink-40)',
          transition: 'color 160ms ease',
        }}
      >
        {label}
      </span>
    </div>
  );
}

function SidebarImpl({ list, selectedId, onSelect, onCreate, onDelete, onJoin, onToggleCollapse }: SidebarProps) {
  return (
    <aside
      style={{
        // Без slide-from-left анимации: open и close — оба instant. Раньше
        // была asymmetric: open анимирован, close — instant unmount, что
        // визуально выглядело как «закрывается плавно, открывается резко».
        borderRight: '1px solid rgba(255,255,255,0.06)',
        padding: '0 8px',
        overflowY: 'auto',
      }}
    >
      <SidebarHeader
        count={list.rooms.length}
        status={list.status}
        onCreate={onCreate}
        onToggleCollapse={onToggleCollapse}
      />
      <JoinByIdInput onJoin={onJoin} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 2px' }}>
        {list.rooms.map((r) => (
          <RoomRow
            key={r.id}
            room={r}
            active={selectedId === r.id}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        ))}
      </div>
      <div style={{ padding: '4px 6px' }}>
        <QuotaUsageBar resource="active_shared_boards" />
      </div>
      <RetentionHint label="Auto-cleanup after 30d of inactivity" />
      {list.error && (
        <div
          className="mono"
          style={{ padding: '12px 14px', fontSize: 11, color: '#ff6a6a', letterSpacing: '.12em' }}
        >
          {list.error}
        </div>
      )}
    </aside>
  );
}

function SidebarHeader({
  count,
  status,
  onCreate,
  onToggleCollapse,
}: {
  count: number;
  status: ListState['status'];
  onCreate: () => void;
  onToggleCollapse: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px 14px' }}>
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('hone:nav-home'))}
        className="focus-ring"
        title="Back to Home"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 4,
          borderRadius: 6,
          cursor: 'pointer',
          color: 'var(--ink-60)',
          display: 'inline-flex',
          alignItems: 'center',
          transition: 'color 180ms ease, background-color 180ms ease, transform 180ms ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--ink)';
          e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          e.currentTarget.style.transform = 'translateX(-2px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--ink-60)';
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.transform = 'translateX(0)';
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
        {status === 'loading' ? 'Loading' : status === 'error' ? 'Offline' : `Boards · ${count}`}
      </span>
      <CreateButton onClick={onCreate} />
      <CollapseSidebarButton onClick={onToggleCollapse} />
    </div>
  );
}

function CollapseSidebarButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="focus-ring"
      title="Hide sidebar"
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
        transition: 'background-color 180ms ease, color 180ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
        e.currentTarget.style.color = 'var(--ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--ink-60)';
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
        <path d="M14 10l-2 2 2 2" />
      </svg>
    </button>
  );
}

function ExpandSidebarButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="focus-ring fadein"
      title="Show sidebar"
      style={{
        position: 'absolute',
        top: 92,
        left: 10,
        width: 28,
        height: 28,
        borderRadius: 7,
        background: 'rgba(20,20,22,0.78)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.08)',
        cursor: 'pointer',
        color: 'var(--ink-60)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 30,
        animationDuration: '180ms',
        transition: 'color 160ms ease, background-color 160ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--ink)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--ink-60)';
      }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
        <path d="M12 10l2 2-2 2" />
      </svg>
    </button>
  );
}

function CreateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="focus-ring"
      title="New board"
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
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}

function JoinByIdInput({ onJoin }: { onJoin: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) {
          onJoin(v.trim());
          setV('');
        }
      }}
      style={{ padding: '0 14px 12px', display: 'flex', gap: 6 }}
    >
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Join by ID or URL…"
        style={{
          flex: 1,
          padding: '6px 10px',
          fontSize: 12,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 7,
          color: 'var(--ink)',
          outline: 'none',
        }}
      />
    </form>
  );
}

// ─── RoomRow ──────────────────────────────────────────────────────────────

const RoomRow = memo(RoomRowImpl, (prev, next) =>
  prev.room === next.room &&
  prev.active === next.active &&
  prev.onSelect === next.onSelect &&
  prev.onDelete === next.onDelete,
);

function RoomRowImpl({
  room,
  active,
  onSelect,
  onDelete,
}: {
  room: WhiteboardRoom;
  active: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [copied, setCopied] = useState(false);
  const [visibility, setVisibility] = useState<WhiteboardVisibility | null>(null);
  const [busy, setBusy] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  // Lazy-load visibility on first menu-open (cheap GET).
  useEffect(() => {
    if (!menuOpen || visibility !== null) return;
    void getRoomVisibility(room.id)
      .then((v) => setVisibility(v))
      .catch(() => setVisibility('shared')); // network blip — assume default
  }, [menuOpen, visibility, room.id]);

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

  const shareURL = `${WEB_BASE_URL}/whiteboard/${room.id}`;
  const handleCopyURL = async () => {
    try {
      await navigator.clipboard.writeText(shareURL);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
        setMenuOpen(false);
      }, 1200);
    } catch {
      /* ignore */
    }
  };
  const handleOpenWeb = async () => {
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (bridge) await bridge.shell.openExternal(shareURL);
    else window.open(shareURL, '_blank');
    setMenuOpen(false);
  };
  const handleToggleVisibility = async () => {
    if (visibility === null) return;
    const next: WhiteboardVisibility = visibility === 'private' ? 'shared' : 'private';
    setBusy(true);
    try {
      const v = await setRoomVisibility(room.id, next);
      setVisibility(v);
    } catch {
      /* ignore — могла быть 403 если юзер не owner */
    } finally {
      setBusy(false);
    }
  };

  const participants = room.participants.length;
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
      onClick={() => onSelect(room.id)}
    >
      <BoardIcon />
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
        {room.title || 'Untitled board'}
      </span>
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
        {participants}p
      </span>
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
          transition: 'opacity 180ms ease, background-color 160ms ease',
          flexShrink: 0,
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {menuOpen && (
        <div
          className="fadein"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 'calc(100% - 4px)',
            right: 8,
            zIndex: 30,
            minWidth: 220,
            padding: 6,
            borderRadius: 10,
            background: 'rgba(20,20,22,0.96)',
            backdropFilter: 'blur(18px)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            animationDuration: '140ms',
          }}
        >
          <DropdownLabel>Visibility</DropdownLabel>
          <DropdownItem
            icon={visibility === 'private' ? <LockClosedIcon /> : <UnlockIcon />}
            label={
              visibility === null
                ? 'Loading…'
                : visibility === 'private'
                  ? 'Private — make Shared'
                  : 'Shared — make Private'
            }
            onClick={() => void handleToggleVisibility()}
            disabled={busy || visibility === null}
          />
          <div
            className="mono"
            style={{
              fontSize: 9,
              letterSpacing: '0.12em',
              color: 'var(--ink-40)',
              padding: '2px 10px 6px',
              lineHeight: 1.5,
            }}
          >
            Note: board content is stored unencrypted on the server (real-time
            collab requires shared keys; not E2E yet). Don&apos;t paste secrets here.
          </div>
          <DropdownDivider />
          <DropdownLabel>Sharing</DropdownLabel>
          <DropdownItem
            icon={<LinkIcon />}
            label={copied ? '✓ Copied' : 'Copy URL'}
            onClick={() => void handleCopyURL()}
          />
          <DropdownItem
            icon={<ExternalIcon />}
            label="Open on web"
            onClick={() => void handleOpenWeb()}
          />
          <DropdownDivider />
          <DropdownItem
            icon={<TrashIcon />}
            label={confirmDel ? 'Click again to confirm' : 'Delete board'}
            danger
            onClick={() => {
              if (!confirmDel) {
                setConfirmDel(true);
                window.setTimeout(() => setConfirmDel(false), 2000);
                return;
              }
              setMenuOpen(false);
              onDelete(room.id);
            }}
          />
        </div>
      )}
    </div>
  );
}

function BoardIcon() {
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
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 9h6v6H9z" />
    </svg>
  );
}

// ─── RoomCanvas ───────────────────────────────────────────────────────────

function RoomCanvas({ roomId }: { roomId: string }) {
  const parsedId = useMemo(() => extractRoomId(roomId), [roomId]);
  const [room, setRoom] = useState<WhiteboardRoom | null>(null);
  const [loadError, setLoadError] = useState<{ code: Code | null; msg: string } | null>(null);
  const [wsStatus, setWsStatus] = useState<WhiteboardWsStatus>('connecting');
  const [currentTool, setCurrentTool] = useState<string>('selection');
  const myUserId = useSessionStore((s) => s.userId);
  const awarenessRef = useRef<Awareness | null>(null);
  const sendAwarenessRef = useRef<((u: Uint8Array) => void) | null>(null);

  const ydocRef = useRef<Y.Doc | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const sendRef = useRef<((u: Uint8Array) => void) | null>(null);
  const wsCloseRef = useRef<(() => void) | null>(null);
  const applyingRemoteRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  // Pending elements JSON, ещё не закоммиченный в yScene из-за debounce.
  // На cleanup делаем sync-flush — иначе drawing'и в последние 80ms перед
  // переключением board теряются (debounce таймер cancel'ится без выполнения).
  const pendingElementsRef = useRef<string | null>(null);

  // Load room meta.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setRoom(null);
    getWhiteboardRoom(parsedId)
      .then((r) => {
        if (cancelled) return;
        setRoom(r);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const ce = ConnectError.from(err);
        setLoadError({ code: ce.code, msg: ce.rawMessage || ce.message });
      });
    return () => {
      cancelled = true;
    };
  }, [parsedId]);

  // ─── Forced black canvas ─────────────────────────────────────────────
  // Excalidraw's default `viewBackgroundColor` is `Z.white`. Even with
  // `theme="dark"` and `initialData.appState.viewBackgroundColor: '#000'`,
  // there's a race: API ready → first paint → Yjs `updateScene({elements})`
  // → appState gets reset to defaults → canvas flashes white.
  //
  // Fix: pulse `updateScene({appState:{viewBackgroundColor:'#000'}})` at
  // multiple intervals after mount. Cheap (no-op when already #000), and
  // guarantees black regardless of Yjs/WS arrival timing.
  // Yjs + WebSocket lifecycle (без изменений с прежней реализации).
  useEffect(() => {
    if (!room) return;
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const yScene = ydoc.getMap<string>('scene');

    const persistence = new IndexeddbPersistence(`hone:whiteboard:${room.id}`, ydoc);

    // Awareness — присутствие других участников: имя, цвет, pointer, selection.
    // Excalidraw нативно умеет рендерить cursors через appState.collaborators.
    // Мы маппим Yjs awareness state'ы в их формат и фитим updateScene'ом.
    const awareness = new Awareness(ydoc);
    awarenessRef.current = awareness;
    const me = room.participants.find((p) => p.userId === myUserId);
    const myName = me?.username || (myUserId ?? '').slice(0, 6) || 'guest';
    const myColor = userColor(myUserId ?? room.id);
    awareness.setLocalStateField('user', { name: myName, color: myColor });

    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote' || origin === persistence) return;
      sendRef.current?.(update);
    };
    ydoc.on('update', onUpdate);

    const onAwarenessUpdate = (
      diff: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === 'remote') return;
      const changed = diff.added.concat(diff.updated, diff.removed);
      if (changed.length === 0) return;
      const enc = encodeAwarenessUpdate(awareness, changed);
      sendAwarenessRef.current?.(enc);
    };
    awareness.on('update', onAwarenessUpdate);

    // Маппим awareness в Excalidraw collaborators format (Map<id, {pointer,
    // username, color, ...}>). Без этого их курсоры не рендерятся.
    const onAwarenessChange = () => {
      const api = apiRef.current;
      if (!api) return;
      const collabs = new Map<string, {
        pointer?: { x: number; y: number; tool: 'pointer' | 'laser' };
        username?: string;
        color?: { background: string; stroke: string };
      }>();
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID) return; // не показываем себя
        const u = state.user as { name?: string; color?: string } | undefined;
        const p = state.pointer as { x: number; y: number } | undefined;
        if (!u) return;
        collabs.set(String(clientId), {
          username: u.name || 'guest',
          color: { background: u.color || '#888', stroke: u.color || '#888' },
          pointer: p ? { x: p.x, y: p.y, tool: 'pointer' } : undefined,
        });
      });
      try {
        api.updateScene({
          collaborators: collabs as never,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      } catch { /* ignore */ }
    };
    awareness.on('change', onAwarenessChange);

    const handle = connectWhiteboardWs({
      roomId: room.id,
      onStatus: setWsStatus,
      onEnvelope: (env) => {
        if (env.kind === 'snapshot' || env.kind === 'update') {
          const data = env.data as { update?: string };
          if (data?.update) {
            Y.applyUpdate(ydoc, b64ToBytes(data.update), 'remote');
          }
        } else if (env.kind === 'awareness') {
          // Бэкенд может оборачивать в {user_id, data} или передавать как есть.
          const data = env.data as { data?: { update?: string }; update?: string } | undefined;
          const b64 = data?.data?.update ?? data?.update;
          if (typeof b64 === 'string') {
            try {
              applyAwarenessUpdate(awareness, b64ToBytes(b64), 'remote');
            } catch { /* malformed remote awareness — ignore */ }
          }
        }
      },
    });
    wsCloseRef.current = handle.close;
    sendRef.current = (update: Uint8Array) => {
      handle.send({ kind: 'update', data: { update: bytesToB64(update) } });
    };
    sendAwarenessRef.current = (update: Uint8Array) => {
      handle.send({ kind: 'awareness', data: { update: bytesToB64(update) } });
    };

    const onSceneChange = () => {
      const json = yScene.get('elements');
      if (!json || !apiRef.current) return;
      try {
        const elements = JSON.parse(json);
        applyingRemoteRef.current = true;
        // ТОЛЬКО elements — appState не трогаем, иначе Excalidraw
        // может потерять files (для image elements), tool state и
        // прочую клиентскую meta'у.
        apiRef.current.updateScene({
          elements,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      } catch {
        /* ignore parse errors */
      } finally {
        queueMicrotask(() => {
          applyingRemoteRef.current = false;
        });
      }
    };
    yScene.observe(onSceneChange);

    return () => {
      // КРИТИЧНО: flush pending change ДО закрытия WS / destroy ydoc.
      // Иначе drawing'и в последние 80ms (между last onChange и сменой
      // комнаты) теряются — yScene.set никогда не вызывается, update не
      // улетает на сервер, доска при rejoin пустая.
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const pending = pendingElementsRef.current;
      pendingElementsRef.current = null;
      if (pending !== null && yScene.get('elements') !== pending) {
        // sync set → ydoc.on('update') fires sync → sendRef → ws.send
        // (WS буфер успеет flush'нуться до .close() в стандартных browser
        // WS implementations).
        yScene.set('elements', pending);
      }
      yScene.unobserve(onSceneChange);
      ydoc.off('update', onUpdate);
      awareness.off('update', onAwarenessUpdate);
      awareness.off('change', onAwarenessChange);
      const closeHandle = wsCloseRef.current;
      const destroyDoc = () => {
        try { awareness.destroy(); } catch { /* ignore */ }
        try { ydoc.destroy(); } catch { /* ignore */ }
        try { void persistence.destroy(); } catch { /* ignore */ }
      };
      window.setTimeout(() => {
        closeHandle?.();
        destroyDoc();
      }, 60);
      ydocRef.current = null;
      awarenessRef.current = null;
      wsCloseRef.current = null;
      sendRef.current = null;
      sendAwarenessRef.current = null;
    };
  }, [room, myUserId]);

  const handleExcalidrawChange = useCallback(
    (elements: readonly unknown[]) => {
      if (applyingRemoteRef.current) return;
      const ydoc = ydocRef.current;
      if (!ydoc) return;
      const yScene = ydoc.getMap<string>('scene');
      const json = JSON.stringify(elements);
      pendingElementsRef.current = json;
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        if (yScene.get('elements') === json) {
          pendingElementsRef.current = null;
          return;
        }
        yScene.set('elements', json);
        pendingElementsRef.current = null;
      }, 80);
    },
    [],
  );

  // Toolbar → setActiveTool. Excalidraw type union — список конкретных
  // tool-name'ов.
  const setTool = useCallback(
    (tool:
      | 'selection'
      | 'rectangle'
      | 'diamond'
      | 'ellipse'
      | 'arrow'
      | 'line'
      | 'freedraw'
      | 'text'
      | 'image'
      | 'eraser'
      | 'hand') => {
      const api = apiRef.current;
      if (!api) return;
      api.setActiveTool({ type: tool });
      setCurrentTool(tool);
    },
    [],
  );

  // Copy URL / Open on web переехали в three-dots menu в RoomRow.
  // RoomCanvas теперь только рендерит canvas + LIVE-chip; share-actions
  // в sidebar где они по семантике уместны (per-room контроль).

  if (loadError) {
    return <CenterMessage text={loadErrorLabel(loadError)} />;
  }
  if (!room) {
    return <CenterMessage text="LOADING BOARD…" />;
  }

  const participantsLabel =
    room.participants.length === 1
      ? '1 participant'
      : `${room.participants.length} participants`;

  return (
    <>
      {/* Минимальный LIVE-chip в нижнем правом углу — единственная
          info-плашка на канвасе. Все actions (copy / open / private /
          delete) переехали в three-dots внутри row sidebar'а. */}
      <div
        className="mono"
        style={{
          position: 'absolute',
          bottom: 14,
          right: 24,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 12px',
          background: 'rgba(20,20,22,0.78)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 999,
          fontSize: 10,
          color: 'var(--ink-60)',
          letterSpacing: '.06em',
          zIndex: 25,
          pointerEvents: 'none',
        }}
      >
        <span style={{ color: 'var(--ink-40)' }}>{participantsLabel}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span
          style={{
            color:
              wsStatus === 'open'
                ? 'rgba(127,212,155,0.95)'
                : wsStatus === 'connecting'
                  ? 'var(--ink-40)'
                  : '#ff6a6a',
            fontWeight: 500,
          }}
        >
          {wsStatus === 'open' ? 'LIVE' : wsStatus.toUpperCase()}
        </span>
      </div>

      <div
        className="hone-excalidraw-mount"
        style={{ position: 'absolute', inset: 0 }}
      >
        <Excalidraw
          // theme="dark" — Excalidraw сам управляет dark-mode стайлингом
          // элементов (тёмный фон canvas + светлые штрихи). Мы только
          // глушим в globals.css его CSS-фильтр `invert(93%) hue-rotate`
          // на canvas, который ломал color rendering в нашем тёмном
          // chrome. И всё. Никаких pulse-override'ов viewBackgroundColor —
          // они случайно стирали files/elements при rapid updateScene.
          theme="dark"
          excalidrawAPI={(api) => {
            apiRef.current = api;
            requestAnimationFrame(() => {
              try { api.refresh(); } catch { /* ignore */ }
            });
            window.setTimeout(() => {
              try { api.refresh(); } catch { /* ignore */ }
            }, 100);
            window.setTimeout(() => {
              try { api.refresh(); } catch { /* ignore */ }
            }, 500);
          }}
          onPointerUpdate={(payload) => {
            // Стримим свой pointer в awareness каждый move. y-protocols
            // throttle'ит 'change' event'ы (выпускает только при реальной
            // diff'е), плюс мы шлём только awareness-payload — не Y.Doc
            // updates, так что overhead минимальный.
            const aw = awarenessRef.current;
            if (!aw) return;
            const p = payload?.pointer;
            if (!p) return;
            aw.setLocalStateField('pointer', { x: p.x, y: p.y });
          }}
          onChange={handleExcalidrawChange}
          UIOptions={{
            canvasActions: { saveToActiveFile: false, loadScene: false, export: false },
          }}
        />
      </div>

      <FloatingToolbar
        currentTool={currentTool}
        onSelect={setTool}
        onUploadImage={() => setTool('image')}
        onImportLibraryFile={() => {
          // Local-only import: file picker → JSON.parse → updateLibrary.
          // Library хранится Excalidraw'ом в IndexedDB браузера (см.
          // их `excalidrawLibrary` key). НИЧЕГО не уходит на бэкенд —
          // шаблоны для drag-and-drop'а живут только в этом конкретном
          // app instance, что соответствует требованию «import должен быть
          // в локалке, не storage'ить мусор на беке».
          const api = apiRef.current;
          if (!api) return;
          // Открываем sidebar заранее: после updateLibrary юзер сразу видит
          // импортированные шаблоны без лишних кликов.
          try {
            api.toggleSidebar({ name: 'default', tab: 'library', force: true });
          } catch {
            /* ignore */
          }
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.excalidrawlib,application/json';
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
              // Передаём File напрямую (он Blob): Excalidraw'ская
              // updateLibrary принимает LibraryItemsSource = ... | Blob,
              // парсит .excalidrawlib v1/v2 формат сам. Прямая передача
              // надёжнее чем самим JSON.parse + нормализация — мы не
              // знаем будущих изменений их формата.
              //
              // prompt: false — иначе Excalidraw показывает свой confirm-
              // dialog ("Do you want to import this library?"), который
              // наш CSS override прячет в `welcome-screen-decor` и т.п.
              // Юзер выбрал файл — это уже implicit-confirm.
              //
              // defaultStatus: 'unpublished' — items помечаются как
              // локальные drafts. Library хранится Excalidraw'ом в
              // IndexedDB браузера (key = excalidrawLibrary). НИЧЕГО не
              // уходит на бэкенд.
              await api.updateLibrary({
                libraryItems: file,
                merge: true,
                prompt: false,
                openLibraryMenu: true,
                defaultStatus: 'unpublished',
              });
            } catch (err) {
              console.error('library import failed', err);
            }
          };
          input.click();
        }}
        onBrowseLibraries={() => {
          const url = 'https://libraries.excalidraw.com/';
          const bridge = typeof window !== 'undefined' ? window.hone : undefined;
          if (bridge) void bridge.shell.openExternal(url);
          else window.open(url, '_blank');
        }}
      />
    </>
  );
}

// ─── Floating toolbar ──────────────────────────────────────────────────────

interface ToolbarProps {
  currentTool: string;
  onSelect: (
    tool:
      | 'selection'
      | 'rectangle'
      | 'diamond'
      | 'ellipse'
      | 'arrow'
      | 'line'
      | 'freedraw'
      | 'text'
      | 'image'
      | 'eraser'
      | 'hand',
  ) => void;
  onUploadImage: () => void;
  onImportLibraryFile: () => void;
  onBrowseLibraries: () => void;
}

function FloatingToolbar({
  currentTool,
  onSelect,
  onUploadImage,
  onImportLibraryFile,
  onBrowseLibraries,
}: ToolbarProps) {
  return (
    <DraggableToolbar storageKey="hone:shared-boards:toolbar-pos">
      <ToolBtn active={currentTool === 'hand'} onClick={() => onSelect('hand')} title="Hand (pan)">
        <HandIcon />
      </ToolBtn>
      <ToolBtn active={currentTool === 'selection'} onClick={() => onSelect('selection')} title="Select">
        <SelectIcon />
      </ToolBtn>
      <ToolSep />
      <ToolBtn active={currentTool === 'rectangle'} onClick={() => onSelect('rectangle')} title="Rectangle">
        <RectangleIcon />
      </ToolBtn>
      <ToolBtn active={currentTool === 'diamond'} onClick={() => onSelect('diamond')} title="Diamond">
        <DiamondIcon />
      </ToolBtn>
      <ToolBtn active={currentTool === 'ellipse'} onClick={() => onSelect('ellipse')} title="Ellipse">
        <EllipseIcon />
      </ToolBtn>
      <ToolBtn active={currentTool === 'arrow'} onClick={() => onSelect('arrow')} title="Arrow">
        <ArrowIcon />
      </ToolBtn>
      <ToolBtn active={currentTool === 'line'} onClick={() => onSelect('line')} title="Line">
        <LineIcon />
      </ToolBtn>
      <ToolBtn active={currentTool === 'freedraw'} onClick={() => onSelect('freedraw')} title="Pencil">
        <PencilIcon />
      </ToolBtn>
      <ToolBtn active={currentTool === 'text'} onClick={() => onSelect('text')} title="Text">
        <TextIcon />
      </ToolBtn>
      <ToolBtn active={currentTool === 'image'} onClick={onUploadImage} title="Image">
        <ImageIcon />
      </ToolBtn>
      <ToolBtn active={currentTool === 'eraser'} onClick={() => onSelect('eraser')} title="Eraser">
        <EraserIcon />
      </ToolBtn>
      <ToolSep />
      <LibraryButton
        onImportFile={onImportLibraryFile}
        onBrowse={onBrowseLibraries}
      />
    </DraggableToolbar>
  );
}

function LibraryButton({
  onImportFile,
  onBrowse,
}: {
  onImportFile: () => void;
  onBrowse: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title="Library presets"
        className="focus-ring"
        style={{
          width: 32,
          height: 32,
          display: 'grid',
          placeItems: 'center',
          background: open
            ? 'rgba(255,255,255,0.12)'
            : hover
              ? 'rgba(255,255,255,0.06)'
              : 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: open || hover ? 'var(--ink)' : 'var(--ink-60)',
          borderRadius: 8,
          transition: 'background-color 140ms ease, color 140ms ease',
        }}
      >
        <LibraryIcon />
      </button>
      {open && (
        <div
          className="fadein"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            minWidth: 240,
            padding: 6,
            borderRadius: 12,
            background: 'rgba(20,20,22,0.96)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            animationDuration: '140ms',
            zIndex: 40,
          }}
        >
          <PopoverLabel>Library</PopoverLabel>
          <PopoverItem
            icon={<UploadIcon />}
            label="Import .excalidrawlib"
            sub="Open file from disk"
            onClick={() => {
              setOpen(false);
              onImportFile();
            }}
          />
          <PopoverItem
            icon={<ExternalIcon />}
            label="Browse libraries"
            sub="libraries.excalidraw.com"
            onClick={() => {
              setOpen(false);
              onBrowse();
            }}
          />
        </div>
      )}
    </div>
  );
}

function PopoverLabel({ children }: { children: React.ReactNode }) {
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

function PopoverItem({
  icon,
  label,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  onClick: () => void;
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
        gap: 12,
        width: '100%',
        padding: '9px 10px',
        background: hover ? 'rgba(255,255,255,0.06)' : 'transparent',
        border: 'none',
        borderRadius: 8,
        color: hover ? 'var(--ink)' : 'var(--ink-90)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background-color 140ms ease, color 140ms ease',
      }}
    >
      <span
        style={{
          display: 'inline-grid',
          placeItems: 'center',
          color: 'inherit',
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 13, lineHeight: 1.2 }}>{label}</span>
        {sub && (
          <span
            className="mono"
            style={{
              fontSize: 9,
              letterSpacing: '0.12em',
              color: 'var(--ink-40)',
              marginTop: 2,
            }}
          >
            {sub}
          </span>
        )}
      </span>
    </button>
  );
}

function UploadIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function ToolBtn({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  title: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="focus-ring"
      style={{
        width: 32,
        height: 32,
        display: 'grid',
        placeItems: 'center',
        background: active
          ? 'rgba(255,255,255,0.12)'
          : hover
            ? 'rgba(255,255,255,0.06)'
            : 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: active ? 'var(--ink)' : hover ? 'var(--ink)' : 'var(--ink-60)',
        borderRadius: 8,
        transition: 'background-color 140ms ease, color 140ms ease',
      }}
    >
      {children}
    </button>
  );
}

function ToolSep() {
  return (
    <span
      aria-hidden
      style={{
        width: 1,
        height: 18,
        background: 'rgba(255,255,255,0.08)',
        margin: '0 4px',
      }}
    />
  );
}

const sharedIconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};
function HandIcon() {
  return (
    <svg {...sharedIconProps}>
      <path d="M9 11V5a1.5 1.5 0 0 1 3 0v6" />
      <path d="M12 11V4a1.5 1.5 0 0 1 3 0v7" />
      <path d="M15 11V6a1.5 1.5 0 0 1 3 0v9a6 6 0 0 1-6 6h-1.5a4.5 4.5 0 0 1-3.6-1.8L4.5 16a1.5 1.5 0 0 1 .3-2.1c.6-.4 1.4-.3 1.9.2L9 17V8a1.5 1.5 0 0 1 3 0" />
    </svg>
  );
}
function SelectIcon() {
  return (
    <svg {...sharedIconProps}>
      <path d="M5 3l7 16 2.5-7L21 10z" />
    </svg>
  );
}
function RectangleIcon() {
  return (
    <svg {...sharedIconProps}>
      <rect x="4" y="6" width="16" height="12" rx="1.5" />
    </svg>
  );
}
function DiamondIcon() {
  return (
    <svg {...sharedIconProps}>
      <path d="M12 3l9 9-9 9-9-9z" />
    </svg>
  );
}
function EllipseIcon() {
  return (
    <svg {...sharedIconProps}>
      <ellipse cx="12" cy="12" rx="9" ry="7" />
    </svg>
  );
}
function ArrowIcon() {
  return (
    <svg {...sharedIconProps}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function LineIcon() {
  return (
    <svg {...sharedIconProps}>
      <path d="M5 12h14" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg {...sharedIconProps}>
      <path d="M3 21l3-1 11.3-11.3a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L2 16l1 5z" />
    </svg>
  );
}
function TextIcon() {
  return (
    <svg {...sharedIconProps}>
      <path d="M5 5h14M12 5v14M9 19h6" />
    </svg>
  );
}
function ImageIcon() {
  return (
    <svg {...sharedIconProps}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M21 16l-5-5-9 9" />
    </svg>
  );
}
function EraserIcon() {
  return (
    <svg {...sharedIconProps}>
      <path d="M19 14l-7 7H5l-2-2 11-11 7 7-2 2z" />
      <path d="M14 9l5 5" />
    </svg>
  );
}
function LibraryIcon() {
  return (
    <svg {...sharedIconProps}>
      <path d="M4 19V5a2 2 0 0 1 2-2h7v18H6a2 2 0 0 1-2-2z" />
      <path d="M13 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
      <path d="M8 7h2M8 11h2M16 7h1M16 11h1" />
    </svg>
  );
}

// ─── Misc chrome ──────────────────────────────────────────────────────────

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', cursor: 'col-resize', userSelect: 'none' }}
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

function CenterMessage({ text }: { text: string }) {
  return (
    <div
      className="mono"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        letterSpacing: '.2em',
        color: 'var(--ink-40)',
      }}
    >
      {text}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
      }}
    >
      <div className="mono" style={{ fontSize: 10, letterSpacing: '.24em', color: 'var(--ink-40)' }}>
        SHARED BOARDS
      </div>
      <p style={{ fontSize: 14, color: 'var(--ink-60)', margin: 0 }}>
        No board selected. Pick one or create a new one.
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
        }}
      >
        + New board
      </button>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function userColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 80%, 65%)`;
}

function extractRoomId(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(/\/whiteboard\/([a-f0-9-]{8,})/i);
  if (m) return m[1]!;
  return trimmed;
}

function loadErrorLabel(err: { code: Code | null; msg: string }): string {
  switch (err.code) {
    case Code.NotFound:
      return 'Board not found.';
    case Code.PermissionDenied:
      return 'You are not a participant.';
    case Code.Unauthenticated:
      return 'Sign in to join the board.';
    case Code.FailedPrecondition:
      return 'Board expired.';
    default:
      return err.msg;
  }
}

// ─── Dropdown helpers ─────────────────────────────────────────────────────

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
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 10px',
        background: hover && !disabled
          ? danger
            ? 'rgba(255,80,80,0.10)'
            : 'rgba(255,255,255,0.06)'
          : 'transparent',
        border: 'none',
        borderRadius: 6,
        color: danger ? '#ff6a6a' : disabled ? 'var(--ink-40)' : hover ? 'var(--ink)' : 'var(--ink-90)',
        fontSize: 13,
        cursor: disabled ? 'default' : 'pointer',
        textAlign: 'left',
        opacity: disabled ? 0.6 : 1,
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
function ExternalIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6M10 14L21 3" />
    </svg>
  );
}
function LockClosedIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function UnlockIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2" />
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
