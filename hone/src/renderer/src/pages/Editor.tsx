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
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { indentOnInput } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { go } from '@codemirror/lang-go';
import { oneDark } from '@codemirror/theme-one-dark';
import { yCollab } from 'y-codemirror.next';

import { BackBtn, GhostBtn, PrimaryBtn } from '../components/primitives/Buttons';
import { WEB_BASE_URL } from '../api/config';
import {
  createRoom,
  getRoom,
  createInvite,
  connectEditorWs,
  runCode,
  b64ToBytes,
  bytesToB64,
  Language,
  type EditorRoom,
  type EditorWsStatus,
  type RoomType,
  type RunResult,
} from '../api/editor';

type Page = { kind: 'list' } | { kind: 'room'; roomId: string };

interface EditorPageProps {
  initialRoomId?: string | null;
  onConsumeInitial?: () => void;
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

export function EditorPage({ initialRoomId, onConsumeInitial }: EditorPageProps = {}) {
  const [page, setPage] = useState<Page>(
    initialRoomId ? { kind: 'room', roomId: initialRoomId } : { kind: 'list' },
  );
  // Single-shot consume: после отрисовки room-view сообщаем родителю что
  // initialRoomId израсходован, чтобы повторное переключение page не
  // вернуло пользователя в ту же комнату принудительно.
  useEffect(() => {
    if (initialRoomId && onConsumeInitial) onConsumeInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (page.kind === 'list') {
    return (
      <RoomsList
        onOpenRoom={(id) => {
          rememberEditorRoom(id);
          setPage({ kind: 'room', roomId: id });
        }}
      />
    );
  }
  return <RoomView roomId={page.roomId} onBack={() => setPage({ kind: 'list' })} />;
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
    const cur = loadRecent().filter((e) => e.id !== id);
    cur.unshift({ id, language, openedAt: Date.now() });
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_MAX)));
  } catch {
    /* ignore quota */
  }
}

function forgetEditorRoom(id: string) {
  if (typeof window === 'undefined') return;
  try {
    const next = loadRecent().filter((e) => e.id !== id);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

// ─── Rooms list (landing) ──────────────────────────────────────────────────

function RoomsList({ onOpenRoom }: { onOpenRoom: (id: string) => void }) {
  const [joinId, setJoinId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>(() => loadRecent());

  const handleCreate = async (type: RoomType, language: Language) => {
    setCreating(true);
    setError(null);
    try {
      const r = await createRoom({ type, language });
      onOpenRoom(r.id);
    } catch (err: unknown) {
      const ce = ConnectError.from(err);
      setError(ce.rawMessage || ce.message);
    } finally {
      setCreating(false);
    }
  };

  const handleForget = (id: string) => {
    forgetEditorRoom(id);
    setRecent(loadRecent());
  };

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ width: 560, maxWidth: '90%' }}>
        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '.24em', color: 'var(--ink-40)' }}
        >
          CODE ROOMS
        </div>
        <h1
          style={{
            margin: '14px 0 8px',
            fontSize: 40,
            fontWeight: 400,
            letterSpacing: '-0.025em',
            lineHeight: 1.05,
          }}
        >
          Write together. Quietly.
        </h1>
        <p style={{ margin: '0 0 32px', fontSize: 14, color: 'var(--ink-60)', lineHeight: 1.6 }}>
          Real-time collab. Ссылку можно открыть в браузере — состояние
          консистентно.
        </p>

        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-40)', marginBottom: 10 }}
        >
          NEW ROOM
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 26 }}>
          {[
            { lang: Language.GO, label: 'Go', type: 'practice' as RoomType },
            { lang: Language.PYTHON, label: 'Python', type: 'practice' as RoomType },
            { lang: Language.JAVASCRIPT, label: 'JavaScript', type: 'practice' as RoomType },
            { lang: Language.TYPESCRIPT, label: 'TypeScript', type: 'practice' as RoomType },
          ].map(({ lang, label, type }) => (
            <button
              key={label}
              disabled={creating}
              onClick={() => void handleCreate(type, lang)}
              className="focus-ring surface lift"
              style={{
                padding: '8px 16px',
                borderRadius: 999,
                background: 'rgba(255,255,255,0.05)',
                color: 'var(--ink)',
                border: '1px solid rgba(255,255,255,0.1)',
                fontSize: 13,
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
              }}
            >
              + {label}
            </button>
          ))}
        </div>

        <div
          className="mono"
          style={{ fontSize: 10, letterSpacing: '.18em', color: 'var(--ink-40)', marginBottom: 10 }}
        >
          JOIN BY ID
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const id = joinId.trim();
            if (id) onOpenRoom(id);
          }}
          style={{ display: 'flex', gap: 8 }}
        >
          <input
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            placeholder="room-id или полный URL…"
            style={{
              flex: 1,
              padding: '9px 12px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--ink)',
              fontSize: 13,
            }}
          />
          <button
            type="submit"
            className="focus-ring lift surface"
            style={{
              padding: '9px 18px',
              borderRadius: 8,
              background: '#fff',
              color: '#000',
              fontSize: 13,
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Join
          </button>
        </form>

        {recent.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <div
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: '.18em',
                color: 'var(--ink-40)',
                marginBottom: 10,
              }}
            >
              RECENT
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {recent.map((r, i) => (
                <li
                  key={r.id}
                  className="row slide-from-bottom"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '10px 12px',
                    margin: '2px 0',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: 8,
                    animationDelay: `${Math.min(i * 30, 200)}ms`,
                    animationDuration: '260ms',
                  }}
                >
                  <button
                    onClick={() => onOpenRoom(r.id)}
                    className="mono"
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      fontSize: 11,
                      color: 'var(--ink-60)',
                      letterSpacing: '0.04em',
                      background: 'transparent',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-60)')}
                    title="Open room"
                  >
                    › {r.id.slice(0, 8)}…{r.id.slice(-4)}
                    <span
                      style={{
                        marginLeft: 12,
                        fontSize: 10,
                        color: 'var(--ink-40)',
                        letterSpacing: '0.08em',
                      }}
                    >
                      {timeAgo(r.openedAt)}
                    </span>
                  </button>
                  <button
                    onClick={() => handleForget(r.id)}
                    className="mono"
                    title="Forget"
                    style={{
                      padding: '3px 8px',
                      fontSize: 9,
                      letterSpacing: '0.14em',
                      color: 'var(--ink-40)',
                      background: 'transparent',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 5,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--ink)';
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--ink-40)';
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p
            className="mono"
            style={{ marginTop: 16, fontSize: 11, color: 'var(--ink-40)' }}
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Single room view ──────────────────────────────────────────────────────

function RoomView({ roomId, onBack }: { roomId: string; onBack: () => void }) {
  const parsedId = useMemo(() => extractRoomId(roomId), [roomId]);
  const [room, setRoom] = useState<EditorRoom | null>(null);
  const [loadError, setLoadError] = useState<{ code: Code | null; msg: string } | null>(null);
  const [wsStatus, setWsStatus] = useState<EditorWsStatus>('connecting');
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [outputTab, setOutputTab] = useState<'stdout' | 'stderr'>('stdout');
  const [panelOpen, setPanelOpen] = useState(false);

  const ydocRef = useRef<Y.Doc | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const sendRef = useRef<((payload: Uint8Array) => void) | null>(null);
  const wsCloseRef = useRef<(() => void) | null>(null);
  const runningRef = useRef(false);

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

  // Init Y.Doc + WebSocket + CodeMirror.
  useEffect(() => {
    if (!room) return;
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const ytext = ydoc.getText('code');

    // Local change → push update to server.
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      // Не ретранслируем apply'и от сервера (origin === 'remote').
      if (origin === 'remote') return;
      sendRef.current?.(update);
    };
    ydoc.on('update', onUpdate);

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
        }
      },
    });
    wsCloseRef.current = handle.close;
    sendRef.current = (update: Uint8Array) => {
      handle.send({ kind: 'op', data: { payload: bytesToB64(update) } });
    };

    // CodeMirror setup.
    const langCompartment = new Compartment();
    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        history(),
        indentOnInput(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        oneDark,
        langCompartment.of(langExt(room.language)),
        yCollab(ytext, null),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { fontFamily: 'var(--font-mono)' },
        }),
      ],
    });
    const mount = document.getElementById('hone-cm-mount');
    if (!mount) return;
    const view = new EditorView({ state, parent: mount });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
      ydoc.off('update', onUpdate);
      ydoc.destroy();
      ydocRef.current = null;
      wsCloseRef.current?.();
      wsCloseRef.current = null;
      sendRef.current = null;
    };
  }, [room]);

  const shareURL = `${WEB_BASE_URL}/editor/${parsedId}`;

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

  // ⌘↵ / Ctrl+Enter hotkey.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleRun();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // handleRun closes over room/view refs — viewRef is a ref (stable), room is in state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(shareURL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore — clipboard permission может быть denied */
    }
  };

  const handleOpenWeb = async () => {
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (bridge) await bridge.shell.openExternal(shareURL);
    else window.open(shareURL, '_blank');
  };

  const handleInvite = async () => {
    if (!room) return;
    try {
      const invite = await createInvite(room.id);
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
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
        gridTemplateRows: 'auto 1fr',
      }}
    >
      <header
        style={{
          padding: '10px 24px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <BackBtn onClick={onBack} />
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-60)' }}>
          {loadError
            ? `error: ${loadErrorLabel(loadError)}`
            : room
              ? `${languageLabel(room.language)} · ${room.participants.length} participant${room.participants.length === 1 ? '' : 's'}`
              : 'loading…'}
        </div>
        {room && (
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '.18em',
              color: wsStatus === 'open' ? 'var(--ink)' : 'var(--red)',
            }}
          >
            · {wsStatus.toUpperCase()}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {room && (
          <>
            <Participants list={room.participants} />
            <GhostBtn onClick={() => void handleInvite()}>INVITE</GhostBtn>
            <GhostBtn onClick={() => void handleShare()} active={copied}>
              {copied ? '✓ COPIED' : 'COPY URL'}
            </GhostBtn>
            <PrimaryBtn
              onClick={() => void handleRun()}
              disabled={running}
              title="Run code (⌘↵)"
            >
              {running ? '⏵ RUNNING…' : '▶ RUN'}
            </PrimaryBtn>
            <PrimaryBtn onClick={() => void handleOpenWeb()}>Open on web ↗</PrimaryBtn>
          </>
        )}
      </header>

      <div id="hone-cm-mount" style={{ overflow: 'auto', background: '#0a0a0a' }} />

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

function Participants({ list }: { list: EditorRoom['participants'] }) {
  if (list.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {list.slice(0, 4).map((p) => (
        <span
          key={p.userId}
          title={`${p.username} · ${p.role}`}
          className="mono"
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(255,255,255,0.08)',
            color: 'var(--ink)',
            fontSize: 10,
            letterSpacing: '.04em',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          {(p.username || '?').slice(0, 2).toUpperCase()}
        </span>
      ))}
      {list.length > 4 && (
        <span
          className="mono"
          style={{ fontSize: 10, color: 'var(--ink-40)', alignSelf: 'center' }}
        >
          +{list.length - 4}
        </span>
      )}
    </div>
  );
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
