// Editor — collaborative code rooms.
//
// Два стейта:
//   - Rooms hub: список моих комнат + «New room» форма (language, type).
//   - Активная комната: CodeMirror 6 с Y.Doc bound'нутым к WebSocket'у.
//
// Yjs transport: backend шлёт/принимает `op` с raw Yjs updates (base64).
// Клиент поддерживает Y.Doc → Y.Text привязан к CodeMirror через
// y-codemirror.next (yCollab). Каждое изменение текста → updateV2 event
// → отправляем на сервер. Входящий op → applyUpdateV2.
//
// Share button: копирует `https://druz9.online/editor/<id>` в clipboard
// + открывает в браузере через shell.openExternal. Web использует тот же
// backend state — room консистентен.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { QuotaUsageBar } from '../components/QuotaUsageBar';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness';
import { EditorState, Compartment, Prec } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { indentOnInput, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import { oneDark } from '@codemirror/theme-one-dark';
import { yCollab } from 'y-codemirror.next';

import { useSessionStore } from '../stores/session';
import { WEB_BASE_URL } from '../api/config';
import {
  createRoom,
  getRoom,
  connectEditorWs,
  runCode,
  b64ToBytes,
  bytesToB64,
  getEditorRoomVisibility,
  setEditorRoomVisibility,
  Language,
  type EditorRoom,
  type EditorWsStatus,
  type RunResult,
  type EditorVisibility,
} from '../api/editor';

interface EditorPageProps {
  initialRoomId?: string | null;
  onConsumeInitial?: () => void;
}

// honeCodeHighlight — кастомная HighlightStyle поверх oneDark. Цвета
// близки к VSCode Dark+ / Goland Darcula:
//   - keyword (func, var, return, if, for) — соломенный bold (Goland-style)
//   - type (string, int, struct) — голубой
//   - string — оранжево-tan (VSCode-orange)
//   - comment — приглушённый зелёный
//   - number — мягкий blue-green
//   - function name — лимонно-жёлтый
//   - builtin — фиолетовый
const honeCodeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier, t.definitionKeyword], color: '#c678dd', fontWeight: '600' },
  { tag: [t.typeName, t.className, t.namespace], color: '#56b6c2' },
  { tag: t.string, color: '#e5c07b' },
  { tag: t.regexp, color: '#e06c75' },
  { tag: t.number, color: '#d19a66' },
  { tag: t.bool, color: '#d19a66' },
  { tag: t.null, color: '#d19a66' },
  { tag: t.literal, color: '#d19a66' },
  { tag: t.comment, color: '#7f848e', fontStyle: 'italic' },
  { tag: t.lineComment, color: '#7f848e', fontStyle: 'italic' },
  { tag: t.blockComment, color: '#7f848e', fontStyle: 'italic' },
  { tag: t.docComment, color: '#7f848e', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#61afef' },
  { tag: [t.variableName, t.propertyName], color: '#e5e5e5' },
  { tag: [t.standard(t.variableName), t.special(t.variableName)], color: '#c678dd' },
  { tag: t.operator, color: '#abb2bf' },
  { tag: t.punctuation, color: '#abb2bf' },
  { tag: t.bracket, color: '#abb2bf' },
  { tag: t.tagName, color: '#e06c75' },
  { tag: t.attributeName, color: '#d19a66' },
  { tag: t.invalid, color: '#ff6a6a' },
]);

// honeEditorTheme — override oneDark'овых elements: фон чисто чёрный,
// gutter более приглушённый, scrollbar тонкий.
function honeEditorTheme() {
  return EditorView.theme(
    {
      '&': { height: '100%', fontSize: '13.5px', backgroundColor: '#000' },
      '.cm-scroller': {
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        background: '#000',
      },
      '.cm-content': { padding: '14px 0', caretColor: '#fff' },
      // Gutter (line numbers) — pure black, no border, transparent active
      // line. Mirror web frontend's editorThemeWeb (см.
      // frontend/src/pages/EditorRoomSharePage.tsx) — host/guest должны
      // выглядеть одинаково.
      '.cm-gutters': {
        background: '#000',
        border: 'none',
        color: 'rgba(255,255,255,0.25)',
      },
      '.cm-activeLineGutter': { background: 'transparent', color: 'var(--ink-60)' },
      '.cm-activeLine': { background: 'rgba(255,255,255,0.02)' },
      '.cm-cursor': { borderLeftColor: '#fff', borderLeftWidth: '1.5px' },
      '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(255,255,255,0.16)' },
      '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(255,255,255,0.2)' },
      '&.cm-focused': { outline: 'none' },
      // y-codemirror.next remote-cursor styles + name labels.
      // Каретка пира — vertical line с цветом из awareness (inline style).
      // Нашлёпка с именем — псевдо-element, рендерится только во время
      // движения курсора (y-codemirror добавляет .cm-ySelectionInfo).
      '.cm-ySelection': { backgroundColor: 'rgba(255,255,255,0.18)' },
      '.cm-ySelectionCaret': {
        position: 'relative',
        borderLeft: '2px solid',
        borderRight: '2px solid',
        marginLeft: '-1px',
        marginRight: '-1px',
        boxSizing: 'border-box',
        display: 'inline',
      },
      '.cm-ySelectionCaretDot': {
        borderRadius: '50%',
        position: 'absolute',
        width: 6,
        height: 6,
        top: -3,
        left: -3,
        backgroundColor: 'inherit',
        border: '1px solid #000',
      },
      // Override y-codemirror default: их встроенный CSS делает opacity:0
      // и показывает label только на hover/movement. Юзер просил «всегда
      // видно». !important перебивает их inline-injected styles (порядок
      // загрузки CSS не гарантирован).
      '.cm-ySelectionInfo': {
        position: 'absolute',
        top: -1.4,
        left: -1,
        fontSize: '10px',
        fontFamily: 'ui-monospace, monospace',
        fontWeight: 500,
        lineHeight: 'normal',
        userSelect: 'none',
        color: '#000',
        paddingLeft: '4px',
        paddingRight: '4px',
        zIndex: 101,
        transform: 'translateY(-100%)',
        backgroundColor: 'inherit',
        whiteSpace: 'nowrap',
        opacity: '1 !important',
        transition: 'none !important',
      },
    },
    { dark: true },
  );
}

function langExt(lang: Language) {
  switch (lang) {
    case Language.GO:
      return [go()];
    case Language.PYTHON:
      return [python()];
    case Language.JAVASCRIPT:
    case Language.TYPESCRIPT:
      return [javascript({ typescript: lang === Language.TYPESCRIPT, jsx: false })];
    default:
      return [];
  }
}

function languageLabel(lang: Language): string {
  switch (lang) {
    case Language.GO:
      return 'Go';
    case Language.PYTHON:
      return 'Python';
    case Language.JAVASCRIPT:
      return 'JavaScript';
    case Language.TYPESCRIPT:
      return 'TypeScript';
    default:
      return '—';
  }
}

// Note: seed-template был удалён по просьбе юзера — свежие комнаты теперь
// открываются с пустым ytext, юзер пишет с нуля. Раньше тут была функция
// templateForLanguage(), и FRESHLY_CREATED set'ом помечалась только что
// созданная комната чтобы owner вставил «Hello, Hone!» через ytext.insert.

export function EditorPage({ initialRoomId, onConsumeInitial }: EditorPageProps = {}) {
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(initialRoomId ?? null);
  const [recent, setRecent] = useState<RecentEntry[]>(() => loadRecent());

  // Sidebar resize.
  const SIDEBAR_KEY = 'hone:code-rooms:sidebar-w';
  const SIDEBAR_COLLAPSED_KEY = 'hone:code-rooms:sidebar-collapsed';
  const SIDEBAR_MIN = 220;
  const SIDEBAR_MAX = 460;
  const SIDEBAR_DEFAULT = 280;
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
    if (!sidebarMountedRef.current) {
      sidebarMountedRef.current = true;
      return;
    }
    const t1 = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
    const t2 = window.setTimeout(() => window.dispatchEvent(new Event('resize')), 80);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [sidebarCollapsed]);
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

  useEffect(() => {
    if (initialRoomId && onConsumeInitial) onConsumeInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshRecent = () => setRecent(loadRecent());

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
        // одним in-flow child'ом auto-flow'ится в column 1 и схлопывается
        // до нуля ширины (EditorExpandSidebarButton — position:absolute,
        // в grid flow не участвует).
        gridTemplateColumns: sidebarCollapsed ? `1fr` : `${sidebarW}px 6px 1fr`,
        animationDuration: '320ms',
        background: '#000',
      }}
    >
      {!sidebarCollapsed && (
        <CodeRoomsSidebar
          recent={recent}
          selectedRoomId={selectedRoomId}
          onOpen={(id) => {
            rememberEditorRoom(id);
            setSelectedRoomId(id);
            refreshRecent();
          }}
          onCreated={(id) => {
            rememberEditorRoom(id);
            setSelectedRoomId(id);
            refreshRecent();
          }}
          onForget={(id) => {
            forgetEditorRoom(id);
            refreshRecent();
            setSelectedRoomId((cur) => (cur === id ? null : cur));
          }}
          onToggleCollapse={() => setSidebarCollapsed(true)}
        />
      )}

      {!sidebarCollapsed && (
        <ResizeHandleRoomList
          onMouseDown={(e) => {
            dragRef.current = { x: e.clientX, w: sidebarW };
          }}
        />
      )}
      {sidebarCollapsed && (
        <EditorExpandSidebarButton onClick={() => setSidebarCollapsed(false)} />
      )}

      <section
        style={{
          position: 'relative',
          minWidth: 0,
          minHeight: 0,
          background: '#000',
          overflow: 'hidden',
        }}
      >
        {selectedRoomId ? (
          <RoomView
            key={selectedRoomId}
            roomId={selectedRoomId}
            onBack={() => setSelectedRoomId(null)}
          />
        ) : (
          <CodeRoomsEmptyState />
        )}
      </section>
    </div>
  );
}

// ─── Sidebar (replaces centered RoomsList landing) ────────────────────────

function EditorExpandSidebarButton({ onClick }: { onClick: () => void }) {
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

function CodeRoomsSidebar({
  recent,
  selectedRoomId,
  onOpen,
  onCreated,
  onForget,
  onToggleCollapse,
}: {
  recent: RecentEntry[];
  selectedRoomId: string | null;
  onOpen: (id: string) => void;
  onCreated: (id: string) => void;
  onForget: (id: string) => void;
  onToggleCollapse: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [joinId, setJoinId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (lang: Language) => {
    setCreating(true);
    setError(null);
    try {
      const r = await createRoom({ type: 'practice', language: lang });
      onCreated(r.id);
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      // Phase 2 quota: free-tier лимит на active shared rooms.
      if (ce.code === Code.ResourceExhausted) {
        const { useQuotaStore, quotaExceededMessage } = await import('../stores/quota');
        useQuotaStore.getState().showUpgradePrompt(quotaExceededMessage('room'));
        void useQuotaStore.getState().refresh();
      } else {
        setError(ce.rawMessage || ce.message);
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <aside
      // slide-from-left анимация удалена для симметрии open/close.
      style={{
        animationDuration: '320ms',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        padding: '0 8px',
        overflowY: 'auto',
      }}
    >
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
          Code rooms · {recent.length}
        </span>
        <button
          onClick={onToggleCollapse}
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
      </div>

      <div className="mono" style={{ fontSize: 9, letterSpacing: '.18em', color: 'var(--ink-40)', padding: '4px 14px 6px' }}>
        NEW ROOM
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 12px 14px' }}>
        {[
          { lang: Language.GO, label: 'Go' },
          { lang: Language.PYTHON, label: 'Py' },
          { lang: Language.JAVASCRIPT, label: 'JS' },
          { lang: Language.TYPESCRIPT, label: 'TS' },
        ].map(({ lang, label }) => (
          <button
            key={label}
            disabled={creating}
            onClick={() => void handleCreate(lang)}
            className="focus-ring"
            style={{
              padding: '6px 10px',
              borderRadius: 7,
              background: 'rgba(255,255,255,0.04)',
              color: 'var(--ink-90)',
              border: '1px solid rgba(255,255,255,0.08)',
              fontSize: 12,
              cursor: creating ? 'default' : 'pointer',
              transition: 'background-color 140ms ease, color 140ms ease',
            }}
            onMouseEnter={(e) => {
              if (creating) return;
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.color = 'var(--ink)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.color = 'var(--ink-90)';
            }}
          >
            + {label}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const id = extractRoomId(joinId);
          if (id) {
            onOpen(id);
            setJoinId('');
          }
        }}
        style={{ padding: '0 14px 14px', display: 'flex', gap: 6 }}
      >
        <input
          value={joinId}
          onChange={(e) => setJoinId(e.target.value)}
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

      {recent.length > 0 && (
        <>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '.18em', color: 'var(--ink-40)', padding: '4px 14px 6px' }}>
            RECENT
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 2px 14px' }}>
            {recent.map((r) => (
              <CodeRoomRow
                key={r.id}
                entry={r}
                active={selectedRoomId === r.id}
                onOpen={onOpen}
                onForget={onForget}
              />
            ))}
          </div>
        </>
      )}

      {error && (
        <div
          className="mono"
          style={{ padding: '0 14px 12px', fontSize: 11, color: '#ff6a6a', letterSpacing: '.12em' }}
        >
          {error}
        </div>
      )}
      <div style={{ padding: '4px 6px' }}>
        <QuotaUsageBar resource="active_shared_rooms" />
      </div>
      <CodeRoomsRetentionHint />
    </aside>
  );
}

function CodeRoomsRetentionHint() {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Code rooms expire 7 days after last activity. Replays are kept for 30 days, then purged."
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
        Auto-cleanup after 7d idle
      </span>
    </div>
  );
}

function CodeRoomRow({
  entry,
  active,
  onOpen,
  onForget,
}: {
  entry: RecentEntry;
  active: boolean;
  onOpen: (id: string) => void;
  onForget: (id: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [visibility, setVisibility] = useState<EditorVisibility | null>(null);
  const [visBusy, setVisBusy] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  // Lazy-load visibility on first menu-open (cheap GET, idempotent).
  useEffect(() => {
    if (!menuOpen || visibility !== null) return;
    void getEditorRoomVisibility(entry.id)
      .then((v) => setVisibility(v))
      .catch(() => setVisibility('shared')); // network blip — assume default
  }, [menuOpen, visibility, entry.id]);

  const handleToggleVisibility = async () => {
    if (visibility === null) return;
    const next: EditorVisibility = visibility === 'private' ? 'shared' : 'private';
    setVisBusy(true);
    try {
      const v = await setEditorRoomVisibility(entry.id, next);
      setVisibility(v);
    } catch {
      /* ignore — могла быть 403 если юзер не owner */
    } finally {
      setVisBusy(false);
    }
  };

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

  const shareURL = `${WEB_BASE_URL}/editor/${entry.id}`;
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

  return (
    <div
      ref={rowRef}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onOpen(entry.id)}
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
    >
      <CodeIcon />
      <span
        className="mono"
        style={{
          flex: 1,
          fontSize: 11.5,
          color: active ? 'var(--ink)' : 'var(--ink-60)',
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {entry.id.slice(0, 8)}…{entry.id.slice(-4)}
      </span>
      <span
        style={{
          fontSize: 10,
          color: 'var(--ink-40)',
          opacity: hover && !menuOpen ? 1 : 0,
          transition: 'opacity 180ms ease',
          flexShrink: 0,
        }}
      >
        {timeAgo(entry.openedAt)}
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
        <CodeRowDropdown
          copied={copied}
          visibility={visibility}
          visBusy={visBusy}
          onToggleVisibility={() => void handleToggleVisibility()}
          onCopyURL={() => void handleCopyURL()}
          onOpenWeb={() => void handleOpenWeb()}
          onForget={() => {
            setMenuOpen(false);
            onForget(entry.id);
          }}
        />
      )}
    </div>
  );
}

function CodeRowDropdown({
  copied,
  visibility,
  visBusy,
  onToggleVisibility,
  onCopyURL,
  onOpenWeb,
  onForget,
}: {
  copied: boolean;
  visibility: EditorVisibility | null;
  visBusy: boolean;
  onToggleVisibility: () => void;
  onCopyURL: () => void;
  onOpenWeb: () => void;
  onForget: () => void;
}) {
  return (
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
      <CodeMenuLabel>Visibility</CodeMenuLabel>
      <CodeMenuItem
        icon={visibility === 'private' ? <LockClosedSvg /> : <UnlockSvg />}
        label={
          visibility === null
            ? 'Loading…'
            : visibility === 'private'
              ? 'Private — make Shared'
              : 'Shared — make Private'
        }
        onClick={onToggleVisibility}
        disabled={visBusy || visibility === null}
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
        Note: code is stored unencrypted on the server (real-time collab
        requires shared keys; not E2E yet). Don&apos;t paste secrets here.
      </div>
      <CodeMenuDivider />
      <CodeMenuLabel>Sharing</CodeMenuLabel>
      <CodeMenuItem
        icon={<LinkSvg />}
        label={copied ? '✓ Copied' : 'Copy URL'}
        onClick={onCopyURL}
      />
      <CodeMenuItem icon={<ExternalSvg />} label="Open on web" onClick={onOpenWeb} />
      <CodeMenuDivider />
      <CodeMenuItem icon={<ForgetSvg />} label="Delete room" onClick={onForget} muted />
    </div>
  );
}

function LockClosedSvg() {
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
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function UnlockSvg() {
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
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2" />
    </svg>
  );
}

function CodeMenuLabel({ children }: { children: React.ReactNode }) {
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
function CodeMenuItem({
  icon,
  label,
  onClick,
  muted = false,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  muted?: boolean;
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
        background: hover && !disabled ? 'rgba(255,255,255,0.06)' : 'transparent',
        border: 'none',
        borderRadius: 6,
        color: disabled
          ? 'var(--ink-40)'
          : muted
            ? 'var(--ink-40)'
            : hover
              ? 'var(--ink)'
              : 'var(--ink-90)',
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
function CodeMenuDivider() {
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
function LinkSvg() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}
function ExternalSvg() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6M10 14L21 3" />
    </svg>
  );
}
function ForgetSvg() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function CodeIcon() {
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
      <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
    </svg>
  );
}

function ResizeHandleRoomList({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
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

function CodeRoomsEmptyState() {
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
        CODE ROOMS
      </div>
      <p style={{ fontSize: 14, color: 'var(--ink-60)', margin: 0, textAlign: 'center', maxWidth: 360 }}>
        Pick a recent room or create a new one. Same URL — share with anyone, real-time collab.
      </p>
    </div>
  );
}

// ─── Recent rooms cache ────────────────────────────────────────────────────
//
// Editor backend ещё не имеет ListMyRooms RPC (Phase 7) — без него юзер
// случайно жмёт BACK и теряет URL. Локальный LRU-кэш сохраняет последние
// 10 комнат в localStorage; на landing'е показываем «Recent» список с
// одним кликом обратно. Поле title пока пусто — обновляется когда юзер
// открывает room (мы фетчим getRoom в RoomView, можем дополнить).
const RECENT_KEY = 'hone:editor:recent-rooms';
const RECENT_MAX = 10;

interface RecentEntry {
  id: string;
  language?: number; // Language enum
  openedAt: number;
}

function loadRecent(): RecentEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e): e is RecentEntry => !!e && typeof e === 'object' && typeof (e as RecentEntry).id === 'string')
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function rememberEditorRoom(id: string, language?: number) {
  if (typeof window === 'undefined') return;
  try {
    const cur = loadRecent();
    const existing = cur.findIndex((e) => e.id === id);
    if (existing !== -1) {
      // Уже в списке — НЕ переставляем в начало, оставляем порядок как был.
      // Юзер просил: какие открывал недавно, в том порядке и пусть лежат.
      return;
    }
    cur.unshift({ id, language, openedAt: Date.now() });
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_MAX)));
  } catch {
    /* ignore quota */
  }
}

function forgetEditorRoom(id: string) {
  if (typeof window === 'undefined') return;
  // Local list очищаем СРАЗУ — UX не должен ждать сети.
  try {
    const next = loadRecent().filter((e) => e.id !== id);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  // Server-side hard-delete. Backend DELETE /api/v1/editor/room/{id} был
  // добавлен (cmd/monolith/services/editor.go editorDeleteHandler).
  // 404 = уже не существует / не owner — игнорируем (UX-эквивалент успеха).
  void (async () => {
    try {
      const { API_BASE_URL, DEV_BEARER_TOKEN } = await import('../api/config');
      const { useSessionStore } = await import('../stores/session');
      const token = useSessionStore.getState().accessToken ?? DEV_BEARER_TOKEN;
      const headers: Record<string, string> = {};
      if (token) headers.authorization = `Bearer ${token}`;
      try {
        const did = window.localStorage.getItem('hone:device-id');
        if (did) headers['x-device-id'] = did;
      } catch {
        /* ignore */
      }
      await fetch(`${API_BASE_URL}/api/v1/editor/room/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers,
      });
    } catch {
      /* network blip — server-side row останется до TTL-cron'а */
    }
  })();
}

// ─── Single room view ──────────────────────────────────────────────────────

function RoomView({ roomId }: { roomId: string; onBack?: () => void }) {
  const parsedId = useMemo(() => extractRoomId(roomId), [roomId]);
  const [room, setRoom] = useState<EditorRoom | null>(null);
  const [loadError, setLoadError] = useState<{ code: Code | null; msg: string } | null>(null);
  const [wsStatus, setWsStatus] = useState<EditorWsStatus>('connecting');
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [outputTab, setOutputTab] = useState<'stdout' | 'stderr'>('stdout');
  const [panelOpen, setPanelOpen] = useState(false);
  // livePeers — реальное число online-клиентов в комнате (через awareness).
  // room.participants — это history (кто КОГДА-ЛИБО заходил), а UX'у нужно
  // «сколько сейчас тут». awareness.states.size учитывает и self.
  const [livePeers, setLivePeers] = useState(1);

  const ydocRef = useRef<Y.Doc | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sendRef = useRef<((payload: Uint8Array) => void) | null>(null);
  const sendAwarenessRef = useRef<((payload: Uint8Array) => void) | null>(null);
  const wsCloseRef = useRef<(() => void) | null>(null);
  const runningRef = useRef(false);

  const myUserId = useSessionStore((s) => s.userId);

  // Load room meta.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    getRoom(parsedId)
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

  // Init Y.Doc + WebSocket + CodeMirror + Awareness.
  useEffect(() => {
    if (!room) return;
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const ytext = ydoc.getText('code');

    // Local-first persistence: y-indexeddb сохраняет код в IndexedDB
    // браузера. При offline'е, app crash'е, или backend down — данные не
    // теряются. На rejoin (даже без бэка) код восстанавливается из локального
    // storage. WS reconnect'ится → Yjs CRDT merge'ит local + remote updates
    // автоматически, без конфликтов.
    const persistence = new IndexeddbPersistence(`hone:editor:${room.id}`, ydoc);

    // Awareness — track карет/selection других участников. Бэкенд relay'ит
    // payload через 'presence' envelope (см. editor/ports/ws.go InPresence).
    const awareness = new Awareness(ydoc);
    // Берём короткое имя из participants (сами себя), плюс детерминированный
    // цвет от userId — каждый юзер видит соседей одним и тем же цветом.
    const me = room.participants.find((p) => p.userId === myUserId);
    const myName = me?.username || (myUserId ?? '').slice(0, 6) || 'guest';
    const myColor = userColor(myUserId ?? room.id);
    awareness.setLocalStateField('user', { name: myName, color: myColor });

    // Local Y.Doc updates → push.
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      // Игнорируем updates от 'remote' (WS) и от persistence (IndexedDB
      // restore on mount) — иначе зацикливание.
      if (origin === 'remote' || origin === persistence) return;
      sendRef.current?.(update);
    };
    ydoc.on('update', onUpdate);

    // Local awareness changes → push в presence-канал. Throttle уже даёт
    // y-protocols (выпускает change-event только когда state реально меняется).
    const onAwareness = (
      diff: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (origin === 'remote') return;
      const changedClients = diff.added.concat(diff.updated, diff.removed);
      if (changedClients.length === 0) return;
      const enc = encodeAwarenessUpdate(awareness, changedClients);
      sendAwarenessRef.current?.(enc);
    };
    awareness.on('update', onAwareness);

    // Track live peer count via awareness 'change' event. Fires when any
    // participant joins/leaves or updates their state. Includes self.
    const onAwarenessChange = () => {
      setLivePeers(awareness.getStates().size);
    };
    awareness.on('change', onAwarenessChange);
    setLivePeers(awareness.getStates().size); // initial

    // WebSocket.
    const handle = connectEditorWs({
      roomId: room.id,
      onStatus: setWsStatus,
      onEnvelope: (env) => {
        if (env.kind === 'snapshot' || env.kind === 'op') {
          const data = env.data as { payload?: string };
          if (data?.payload) {
            const bytes = b64ToBytes(data.payload);
            Y.applyUpdate(ydoc, bytes, 'remote');
          }
        } else if (env.kind === 'presence') {
          // Бэкенд envelope.data — это `env.Data` rawJSON наш payload, но
          // backend заворачивает в `{user_id, data}`. Берём data как есть.
          const data = env.data as { data?: { update?: string }; update?: string } | undefined;
          const b64 = data?.data?.update ?? data?.update;
          if (typeof b64 === 'string') {
            try {
              applyAwarenessUpdate(awareness, b64ToBytes(b64), 'remote');
            } catch {
              /* malformed remote awareness — ignore */
            }
          }
        }
      },
    });
    wsCloseRef.current = handle.close;
    sendRef.current = (update: Uint8Array) => {
      handle.send({ kind: 'op', data: { payload: bytesToB64(update) } });
    };

    sendAwarenessRef.current = (update: Uint8Array) => {
      // Backend ws.go ловит kind='presence', envelope.data — opaque, мы
      // кладём { update: base64 } и backend re-broadcast'ит как
      // { user_id, data } (см. editor/ports/ws.go InPresence handling).
      handle.send({ kind: 'presence', data: { update: bytesToB64(update) } });
    };

    // CodeMirror setup. yCollab(ytext, awareness) — теперь рисует чужие
    // карет/selection с цветом из awareness state.
    const langCompartment = new Compartment();
    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        history(),
        indentOnInput(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        oneDark,
        // Hone Goland/VSCode-like override поверх oneDark — больше
        // контраста, привычные цвета для keywords/types/strings.
        syntaxHighlighting(honeCodeHighlight),
        langCompartment.of(langExt(room.language)),
        yCollab(ytext, awareness),
        // Prec.highest: oneDarkTheme регистрирует свой `.cm-gutters` с
        // background чуть-чуть светлее чем чисто чёрный (#282c34) — наш
        // override без Prec.highest терялся в порядке merge'а из-за того
        // что oneDark Bundle внутри использует тот же facet с равной
        // priority, и фактический "победитель" определялся implementation
        // detail'ом CM6 facet-сортировки. Web frontend (editorThemeWeb)
        // не использует oneDark вообще → у него gutter был корректным.
        Prec.highest(honeEditorTheme()),
      ],
    });
    const mount = document.getElementById('hone-cm-mount');
    if (!mount) return;
    const view = new EditorView({ state, parent: mount });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
      awareness.off('update', onAwareness);
      awareness.off('change', onAwarenessChange);
      awareness.destroy();
      ydoc.off('update', onUpdate);
      // WS close с задержкой 60ms чтобы send-buffer ушёл на сервер ДО close.
      const closeHandle = wsCloseRef.current;
      window.setTimeout(() => {
        try { closeHandle?.(); } catch { /* ignore */ }
        try { ydoc.destroy(); } catch { /* ignore */ }
        try { void persistence.destroy(); } catch { /* ignore */ }
      }, 60);
      ydocRef.current = null;
      wsCloseRef.current = null;
      sendRef.current = null;
      sendAwarenessRef.current = null;
    };
  }, [room, myUserId]);

  // shareURL вычисляется в CodeRoomRow (sidebar) для Copy URL / Open on web —
  // эти actions перенесены туда из top-bar.

  // handleFormat — re-indent + trim trailing whitespace через CM6 transactions.
  // Не настоящий gofmt/prettier (для них нужен server-side runner с
  // соответствующими тулзами), но даёт юзеру чистый indent + удаляет
  // trailing spaces. Реальный formatter — отдельный backend ticket
  // (Judge0 умеет запускать произвольные команды; добавим
  // /api/v1/editor/format endpoint в следующей итерации).
  const handleFormat = () => {
    const view = viewRef.current;
    if (!view) return;
    const { state } = view;
    // Trim trailing whitespace per-line.
    const changes: Array<{ from: number; to: number; insert: string }> = [];
    for (let i = 1; i <= state.doc.lines; i++) {
      const line = state.doc.line(i);
      const trimmed = line.text.replace(/[ \t]+$/, '');
      if (trimmed !== line.text) {
        changes.push({ from: line.from, to: line.to, insert: trimmed });
      }
    }
    if (changes.length > 0) {
      view.dispatch({ changes });
    }
  };

  const handleRun = async () => {
    if (!room) return;
    if (runningRef.current) return;
    const view = viewRef.current;
    if (!view) return;
    const code = view.state.doc.toString();
    runningRef.current = true;
    setRunning(true);
    setRunError(null);
    setPanelOpen(true);
    try {
      const res = await runCode(room.id, code, room.language);
      setRunResult(res);
      // Auto-focus stderr when it has content and stdout doesn't.
      if (res.stderr && !res.stdout) setOutputTab('stderr');
      else setOutputTab('stdout');
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      let label: string;
      switch (ce.code) {
        case Code.Unavailable:
          label = 'Sandbox not configured.';
          break;
        case Code.ResourceExhausted:
          label = 'Slow down — limit reached.';
          break;
        case Code.PermissionDenied:
          label = 'You are not a participant.';
          break;
        default:
          label = ce.rawMessage || ce.message;
      }
      setRunResult(null);
      setRunError(label);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  // ⌘↵ / Ctrl+Enter — run. ⌘⇧F — format.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleRun();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        handleFormat();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // handleRun closes over room/view refs — viewRef is a ref (stable), room is in state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  // handleShare / handleOpenWeb / handleInvite — переехали в three-dots
  // меню sidebar row'а (см. CodeRoomRow ниже). Здесь top-bar только
  // FORMAT + RUN.

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 80,
        paddingBottom: 120,
        background: '#000',
      }}
    >
      {/* Минимальный glass-chip top-bar в стиле SharedBoards. Back-arrow
          слева, метаданные капсулой, actions справа — все на blur-стекле,
          ничего не диктует layout (position: absolute). */}
      {/* Top: только FORMAT + RUN. BACK / INVITE / ? / Open on web /
          COPY URL ушли — back через ESC или click sidebar; invite не
          нужен (URL → достаточно); Open on web / COPY URL — в three-dots
          меню sidebar row'а; ? удалён. */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          right: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          zIndex: 25,
        }}
      >
        {room && (
          <>
            <button
              onClick={handleFormat}
              title="Format / re-indent (⌘⇧F)"
              className="focus-ring mono"
              style={{
                padding: '7px 14px',
                fontSize: 11,
                letterSpacing: '.14em',
                background: 'rgba(20,20,22,0.78)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: 'var(--ink-60)',
                borderRadius: 999,
                cursor: 'pointer',
                transition: 'color 160ms ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--ink)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--ink-60)';
              }}
            >
              {'{ } FORMAT'}
            </button>
            <button
              onClick={() => void handleRun()}
              disabled={running}
              title="Run code (⌘↵)"
              className="focus-ring"
              style={{
                padding: '7px 14px',
                fontSize: 12,
                fontWeight: 500,
                background: 'rgba(255,255,255,0.92)',
                color: '#000',
                border: 'none',
                borderRadius: 999,
                cursor: running ? 'default' : 'pointer',
                opacity: running ? 0.6 : 1,
              }}
            >
              {running ? '⏵ RUNNING…' : '▶ RUN'}
            </button>
          </>
        )}
      </div>

      {/* LIVE chip + participants — снизу-справа, как в Boards. */}
      {room && !loadError && (
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
          <span style={{ color: 'var(--ink-40)' }}>
            {languageLabel(room.language)}
          </span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>
            {livePeers} participant
            {livePeers === 1 ? '' : 's'}
          </span>
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
      )}

      <div id="hone-cm-mount" style={{ position: 'absolute', inset: 0, paddingTop: 60, overflow: 'auto', background: '#000' }} />

      {panelOpen && (
        <RunOutputPanel
          running={running}
          result={runResult}
          error={runError}
          activeTab={outputTab}
          onTabChange={setOutputTab}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {loadError && (
        <div
          className="mono"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            color: 'var(--ink-40)',
          }}
        >
          {loadErrorLabel(loadError)}
        </div>
      )}
    </div>
  );
}

// ─── Run output panel ──────────────────────────────────────────────────────
//
// Slides up from the bottom. Two tabs (stdout / stderr), a mono-font header
// with exit code + time_ms, and a close button. Output is ephemeral — nothing
// lives on the server. The panel hides when `onClose` is invoked.
function RunOutputPanel({
  running,
  result,
  error,
  activeTab,
  onTabChange,
  onClose,
}: {
  running: boolean;
  result: RunResult | null;
  error: string | null;
  activeTab: 'stdout' | 'stderr';
  onTabChange: (t: 'stdout' | 'stderr') => void;
  onClose: () => void;
}) {
  const hasStdout = !!result?.stdout;
  const hasStderr = !!result?.stderr;
  const body = activeTab === 'stdout' ? result?.stdout ?? '' : result?.stderr ?? '';

  return (
    <div
      className="slide-from-bottom"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 240,
        background: '#0a0a0a',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        animationDuration: '220ms',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <button
          onClick={() => onTabChange('stdout')}
          className="mono focus-ring"
          style={{
            padding: '4px 10px',
            fontSize: 10,
            letterSpacing: '.14em',
            background: activeTab === 'stdout' ? 'rgba(255,255,255,0.08)' : 'transparent',
            color: activeTab === 'stdout' ? 'var(--ink)' : 'var(--ink-60)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 5,
            cursor: 'pointer',
          }}
        >
          STDOUT
        </button>
        {(hasStderr || (!running && !!error)) && (
          <button
            onClick={() => onTabChange('stderr')}
            className="mono focus-ring"
            style={{
              padding: '4px 10px',
              fontSize: 10,
              letterSpacing: '.14em',
              background: activeTab === 'stderr' ? 'rgba(255,255,255,0.08)' : 'transparent',
              color: activeTab === 'stderr' ? 'var(--red, #ff7070)' : 'var(--ink-60)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 5,
              cursor: 'pointer',
            }}
          >
            STDERR
          </button>
        )}
        <div style={{ flex: 1 }} />
        {running && (
          <span
            className="mono"
            style={{ fontSize: 10, letterSpacing: '.16em', color: 'var(--ink-60)' }}
          >
            running…
          </span>
        )}
        {!running && result && (
          <span
            className="mono"
            style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--ink-60)' }}
          >
            exit {result.exitCode} · {result.timeMs}ms
            {result.status ? ` · ${result.status.toLowerCase()}` : ''}
          </span>
        )}
        <button
          onClick={onClose}
          className="mono focus-ring"
          title="Hide output"
          style={{
            padding: '3px 9px',
            fontSize: 10,
            letterSpacing: '.14em',
            background: 'transparent',
            color: 'var(--ink-40)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 5,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>
      <pre
        className="mono"
        style={{
          margin: 0,
          padding: '12px 16px',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          fontSize: 12,
          lineHeight: 1.55,
          color: error
            ? 'var(--red, #ff7070)'
            : activeTab === 'stderr'
              ? 'var(--red, #ff7070)'
              : 'var(--ink)',
        }}
      >
        {running && !result && !error ? '…' : null}
        {error ?? (hasStdout || hasStderr ? body : !running ? '(no output)' : null)}
      </pre>
    </div>
  );
}

function userColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 80%, 65%)`;
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function extractRoomId(input: string): string {
  // Accept either raw UUID or full URL — полезно если юзер вставил ссылку.
  const trimmed = input.trim();
  const m = trimmed.match(/\/editor\/([a-f0-9-]{8,})/i);
  if (m) return m[1]!;
  return trimmed;
}

function loadErrorLabel(err: { code: Code | null; msg: string }): string {
  switch (err.code) {
    case Code.NotFound:
      return 'Room not found.';
    case Code.PermissionDenied:
      return 'You are not a participant.';
    case Code.Unauthenticated:
      return 'Sign in to join the room.';
    default:
      return err.msg;
  }
}
